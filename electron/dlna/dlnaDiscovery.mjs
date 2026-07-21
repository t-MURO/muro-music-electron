import dgram from "node:dgram";
import os from "node:os";
import { extractXmlValue, readDlnaXmlResponse } from "./dlnaClient.mjs";

// SSDP discovery of UPnP MediaRenderer devices. M-SEARCH queries go out of
// every IPv4 interface (multi-homed machines route multicast arbitrarily
// otherwise); responders are then described by fetching their LOCATION XML.

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
export const MEDIA_RENDERER_TARGET = "urn:schemas-upnp-org:device:MediaRenderer:1";

const QUERY_INTERVAL_MS = 5_000;
const STALE_DEVICE_MS = 30_000;
const DESCRIPTION_TIMEOUT_MS = 5_000;

export const buildMSearch = (searchTarget = MEDIA_RENDERER_TARGET) =>
  Buffer.from(
    [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      "MX: 2",
      `ST: ${searchTarget}`,
      "",
      "",
    ].join("\r\n"),
  );

export const parseSsdpResponse = (text) => {
  const source = String(text ?? "");
  if (!/^HTTP\/1\.1\s+200/i.test(source)) return null;
  const header = (name) =>
    new RegExp(`^${name}:\\s*(.+)$`, "im").exec(source)?.[1]?.trim() ?? null;
  const location = header("LOCATION");
  if (!location) return null;
  return {
    st: header("ST"),
    usn: header("USN"),
    location,
    server: header("SERVER"),
  };
};

// The stable device identity is the uuid portion of the USN.
export const usnUuid = (usn) => /uuid:([^:\s]+)/i.exec(String(usn ?? ""))?.[1] ?? null;

const normalizedHostname = (value) => String(value ?? "").replace(/^\[|\]$/g, "").toLowerCase();

// An SSDP response is unauthenticated UDP. Only follow a description URL
// hosted by the machine that sent the packet, otherwise any LAN peer could
// turn discovery into a request to localhost, a router, or an internet host.
export const isTrustedDescriptionLocation = (location, remoteAddress) => {
  try {
    const url = new URL(location);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password
      && normalizedHostname(url.hostname) === normalizedHostname(remoteAddress);
  } catch {
    return false;
  }
};

// Pull the AVTransport / RenderingControl control URLs out of a device
// description. Renderers are often embedded devices (the HEOS MediaRenderer
// lives inside a Denon AiosDevice), so services are matched document-wide.
export const parseDeviceDescription = (xml, locationUrl) => {
  const source = String(xml ?? "");
  const base = extractXmlValue(source, "URLBase") ?? locationUrl;
  const location = new URL(locationUrl);

  const resolveUrl = (value) => {
    if (!value) return null;
    try {
      const resolved = new URL(value, base);
      if (
        (resolved.protocol !== "http:" && resolved.protocol !== "https:")
        || resolved.username
        || resolved.password
        || normalizedHostname(resolved.hostname) !== normalizedHostname(location.hostname)
      ) {
        return null;
      }
      return resolved.toString();
    } catch {
      return null;
    }
  };

  const services = [...source.matchAll(/<service(?:\s[^>]*)?>([\s\S]*?)<\/service>/gi)]
    .map((match) => ({
      serviceType: extractXmlValue(match[1], "serviceType") ?? "",
      controlUrl: resolveUrl(extractXmlValue(match[1], "controlURL")),
    }));

  const findService = (fragment) =>
    services.find((service) => service.serviceType.includes(fragment))?.controlUrl ?? null;

  return {
    friendlyName: extractXmlValue(source, "friendlyName") ?? "",
    manufacturer: extractXmlValue(source, "manufacturer") ?? "",
    modelName: extractXmlValue(source, "modelName") ?? "",
    avTransportUrl: findService(":service:AVTransport:"),
    renderingControlUrl: findService(":service:RenderingControl:"),
  };
};

export const createDlnaDiscovery = ({ onUpdate, fetchImpl = globalThis.fetch, now = Date.now } = {}) => {
  const devices = new Map(); // uuid -> full record incl. control URLs
  const describedLocations = new Map(); // location -> uuid | null (fetch once)
  let sockets = [];
  let queryTimer = null;
  let running = false;
  let failureMessage = null;

  const snapshot = () => ({
    devices: [...devices.values()]
      .map(({ id, name, model, host, port }) => ({ id, name, model, host, port }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    scanning: running,
    error: failureMessage,
  });

  const notify = () => onUpdate?.(snapshot());

  const describeDevice = async (response, remoteAddress) => {
    if (!isTrustedDescriptionLocation(response.location, remoteAddress)) return;
    if (describedLocations.has(response.location)) {
      const knownUuid = describedLocations.get(response.location);
      const known = knownUuid ? devices.get(knownUuid) : null;
      if (known) known.lastSeenAt = now();
      return;
    }
    describedLocations.set(response.location, null);
    try {
      const descriptionResponse = await fetchImpl(response.location, {
        redirect: "error",
        signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(DESCRIPTION_TIMEOUT_MS)
          : undefined,
      });
      if (!descriptionResponse.ok) {
        // A transient HTTP failure (e.g. the device answered SSDP but its
        // description endpoint is still booting and returns 503) must not
        // permanently hide the device. Drop the negative-cache entry so the
        // next SSDP response re-fetches, matching the network-error path below.
        describedLocations.delete(response.location);
        return;
      }
      const description = parseDeviceDescription(
        await readDlnaXmlResponse(descriptionResponse),
        response.location,
      );
      // A device that parsed cleanly but exposes no AVTransport is genuinely
      // not a renderer we can drive; keep the permanent negative cache so we
      // do not re-fetch its description on every SSDP burst.
      if (!description.avTransportUrl) return;
      const locationUrl = new URL(response.location);
      const id = usnUuid(response.usn) ?? response.location;
      describedLocations.set(response.location, id);
      devices.set(id, {
        id,
        name: description.friendlyName || locationUrl.hostname,
        model: [description.manufacturer, description.modelName].filter(Boolean).join(" "),
        host: locationUrl.hostname,
        port: Number(locationUrl.port) || 80,
        avTransportUrl: description.avTransportUrl,
        renderingControlUrl: description.renderingControlUrl,
        lastSeenAt: now(),
      });
      notify();
    } catch {
      describedLocations.delete(response.location); // allow a retry next round
    }
  };

  const handleMessage = (message, remoteInfo) => {
    const response = parseSsdpResponse(message.toString("utf8"));
    if (!response) return;
    const target = `${response.st ?? ""} ${response.usn ?? ""}`;
    if (!target.includes("MediaRenderer")) return;
    void describeDevice(response, remoteInfo?.address);
  };

  const localIPv4Addresses = () => {
    const addresses = [];
    for (const entries of Object.values(os.networkInterfaces() ?? {})) {
      for (const entry of entries ?? []) {
        if ((entry.family === "IPv4" || entry.family === 4) && !entry.internal) {
          addresses.push(entry.address);
        }
      }
    }
    return addresses;
  };

  const openSocket = (address) =>
    new Promise((resolve) => {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      socket.on("error", () => {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        resolve(null);
      });
      socket.on("message", handleMessage);
      socket.bind(0, address, () => {
        try {
          socket.setMulticastInterface(address);
          resolve(socket);
        } catch {
          try {
            socket.close();
          } catch {
            // Ignore double-close.
          }
          resolve(null);
        }
      });
    });

  const pruneStale = () => {
    let changed = false;
    for (const [id, device] of devices) {
      if (now() - device.lastSeenAt > STALE_DEVICE_MS) {
        devices.delete(id);
        for (const [location, uuid] of describedLocations) {
          if (uuid === id) describedLocations.delete(location);
        }
        changed = true;
      }
    }
    if (changed) notify();
  };

  const sendQueries = () => {
    const search = buildMSearch();
    for (const socket of sockets) {
      // SSDP is lossy UDP; send each query twice.
      socket.send(search, SSDP_PORT, SSDP_ADDRESS, () => {});
      socket.send(search, SSDP_PORT, SSDP_ADDRESS, () => {});
    }
    pruneStale();
  };

  const start = async () => {
    if (running) {
      sendQueries();
      notify();
      return snapshot();
    }
    running = true;
    failureMessage = null;

    const addresses = localIPv4Addresses();
    sockets = (await Promise.all(addresses.map(openSocket))).filter(Boolean);
    if (sockets.length === 0) {
      running = false;
      failureMessage = "Could not open a local network socket for device discovery";
      notify();
      return snapshot();
    }

    sendQueries();
    queryTimer = setInterval(sendQueries, QUERY_INTERVAL_MS);
    notify();
    return snapshot();
  };

  const stop = () => {
    if (queryTimer) clearInterval(queryTimer);
    queryTimer = null;
    for (const socket of sockets) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
    sockets = [];
    running = false;
    notify();
  };

  return {
    start,
    stop,
    getDevices: () => snapshot(),
    getDeviceRecord: (id) => devices.get(id) ?? null,
    isRunning: () => running,
  };
};
