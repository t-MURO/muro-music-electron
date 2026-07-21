import dgram from "node:dgram";
import os from "node:os";

// mDNS/DNS-SD discovery for Google Cast devices (_googlecast._tcp.local).
// Implements the small slice of DNS wire format the feature needs: encoding
// one PTR question and decoding PTR/SRV/TXT/A answers with name compression.

export const CAST_SERVICE_NAME = "_googlecast._tcp.local";
const MDNS_ADDRESS = "224.0.0.251";
const MDNS_PORT = 5353;

const DNS_TYPE_A = 1;
const DNS_TYPE_PTR = 12;
const DNS_TYPE_TXT = 16;
const DNS_TYPE_SRV = 33;

const encodeDnsName = (name) => {
  const parts = [];
  for (const label of name.split(".").filter(Boolean)) {
    const encoded = Buffer.from(label, "utf8");
    parts.push(Buffer.from([encoded.length]), encoded);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
};

export const buildPtrQuery = (serviceName = CAST_SERVICE_NAME, { unicastResponse = false } = {}) => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0); // transaction id (0 for mDNS)
  header.writeUInt16BE(0, 2); // flags: standard query
  header.writeUInt16BE(1, 4); // one question
  const question = Buffer.alloc(4);
  question.writeUInt16BE(DNS_TYPE_PTR, 0);
  // Top bit of the class requests a unicast response (QU question).
  question.writeUInt16BE(unicastResponse ? 0x8001 : 0x0001, 2);
  return Buffer.concat([header, encodeDnsName(serviceName), question]);
};

const readDnsName = (buffer, offset) => {
  const labels = [];
  let cursor = offset;
  let jumped = false;
  let next = offset;
  let hops = 0;
  for (;;) {
    if (cursor >= buffer.length) throw new Error("Truncated DNS name");
    const length = buffer[cursor];
    if (length === 0) {
      if (!jumped) next = cursor + 1;
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= buffer.length) throw new Error("Truncated DNS pointer");
      const pointer = ((length & 0x3f) << 8) | buffer[cursor + 1];
      if (!jumped) next = cursor + 2;
      jumped = true;
      cursor = pointer;
      hops += 1;
      if (hops > 32) throw new Error("DNS name pointer loop");
      continue;
    }
    if (length > 63) throw new Error("Invalid DNS label length");
    if (cursor + 1 + length > buffer.length) throw new Error("Truncated DNS label");
    labels.push(buffer.subarray(cursor + 1, cursor + 1 + length).toString("utf8"));
    cursor += 1 + length;
  }
  return { name: labels.join("."), next };
};

const parseRecordData = (buffer, type, dataOffset, dataLength) => {
  if (type === DNS_TYPE_PTR) {
    const parsed = readDnsName(buffer, dataOffset);
    if (parsed.next > dataOffset + dataLength) throw new Error("PTR name exceeds record data");
    return { domain: parsed.name };
  }
  if (type === DNS_TYPE_SRV) {
    if (dataLength < 6) throw new Error("Truncated SRV record");
    const parsedTarget = readDnsName(buffer, dataOffset + 6);
    if (parsedTarget.next > dataOffset + dataLength) throw new Error("SRV name exceeds record data");
    return {
      priority: buffer.readUInt16BE(dataOffset),
      weight: buffer.readUInt16BE(dataOffset + 2),
      port: buffer.readUInt16BE(dataOffset + 4),
      target: parsedTarget.name,
    };
  }
  if (type === DNS_TYPE_TXT) {
    const entries = [];
    let cursor = dataOffset;
    const end = dataOffset + dataLength;
    while (cursor < end) {
      const length = buffer[cursor];
      cursor += 1;
      if (cursor + length > end) break;
      entries.push(buffer.subarray(cursor, cursor + length).toString("utf8"));
      cursor += length;
    }
    return { entries };
  }
  if (type === DNS_TYPE_A) {
    if (dataLength !== 4) throw new Error("Unexpected A record length");
    return {
      address: `${buffer[dataOffset]}.${buffer[dataOffset + 1]}.${buffer[dataOffset + 2]}.${buffer[dataOffset + 3]}`,
    };
  }
  return null;
};

export const parseDnsMessage = (buffer) => {
  if (buffer.length < 12) throw new Error("Truncated DNS header");
  const questionCount = buffer.readUInt16BE(4);
  const answerCount = buffer.readUInt16BE(6);
  const authorityCount = buffer.readUInt16BE(8);
  const additionalCount = buffer.readUInt16BE(10);

  let offset = 12;
  for (let index = 0; index < questionCount; index += 1) {
    const questionEnd = readDnsName(buffer, offset).next + 4;
    if (questionEnd > buffer.length) throw new Error("Truncated DNS question");
    offset = questionEnd;
  }

  const records = [];
  const totalRecords = answerCount + authorityCount + additionalCount;
  if (totalRecords > 4096) throw new Error("DNS record count exceeds sane limit");
  for (let index = 0; index < totalRecords; index += 1) {
    const { name, next } = readDnsName(buffer, offset);
    if (next + 10 > buffer.length) throw new Error("Truncated DNS record");
    const type = buffer.readUInt16BE(next);
    const ttl = buffer.readUInt32BE(next + 4);
    const dataLength = buffer.readUInt16BE(next + 8);
    const dataOffset = next + 10;
    if (dataOffset + dataLength > buffer.length) throw new Error("Truncated DNS record data");
    const data = parseRecordData(buffer, type, dataOffset, dataLength);
    if (data) records.push({ name, type, ttl, ...data });
    offset = dataOffset + dataLength;
  }
  return records;
};

export const parseTxtEntries = (entries) => {
  const values = {};
  for (const entry of entries ?? []) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    values[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return values;
};

// Merge one mDNS response into device records keyed by stable device id.
export const collectCastRecords = (records) => {
  const services = new Map();
  const addresses = new Map();

  for (const record of records) {
    if (record.type === DNS_TYPE_A) {
      addresses.set(record.name.toLowerCase(), record.address);
    }
  }

  const serviceFor = (instanceName) => {
    const key = instanceName.toLowerCase();
    if (!services.has(key)) services.set(key, { instanceName });
    return services.get(key);
  };

  for (const record of records) {
    if (record.type === DNS_TYPE_PTR && record.name.toLowerCase() === CAST_SERVICE_NAME) {
      serviceFor(record.domain);
    }
    if (record.type === DNS_TYPE_SRV && record.name.toLowerCase().endsWith(`.${CAST_SERVICE_NAME}`)) {
      const service = serviceFor(record.name);
      service.port = record.port;
      service.target = record.target;
    }
    if (record.type === DNS_TYPE_TXT && record.name.toLowerCase().endsWith(`.${CAST_SERVICE_NAME}`)) {
      const service = serviceFor(record.name);
      service.txt = parseTxtEntries(record.entries);
    }
  }

  const devices = [];
  for (const service of services.values()) {
    if (!service.port) continue;
    const host = service.target ? addresses.get(service.target.toLowerCase()) : undefined;
    if (!host) continue;
    const txt = service.txt ?? {};
    const instanceLabel = service.instanceName.replace(`.${CAST_SERVICE_NAME}`, "");
    devices.push({
      id: txt.id || instanceLabel,
      name: txt.fn || instanceLabel,
      model: txt.md || "",
      host,
      port: service.port,
    });
  }
  return devices;
};

const QUERY_INTERVAL_MS = 5_000;
const STALE_DEVICE_MS = 30_000;

// Discovery lifecycle. Two sockets are used: one bound to the mDNS port to
// hear multicast announcements (best effort, may fail when another responder
// owns the port exclusively) and one on an ephemeral port whose queries
// solicit unicast responses (RFC 6762 legacy unicast behavior).
export const createCastDiscovery = ({ onUpdate, now = Date.now } = {}) => {
  const devices = new Map();
  let sockets = [];
  let queryTimer = null;
  let running = false;
  let failureMessage = null;

  const snapshot = () => ({
    devices: [...devices.values()]
      .map(({ lastSeenAt, ...device }) => device)
      .sort((left, right) => left.name.localeCompare(right.name)),
    scanning: running,
    error: failureMessage,
  });

  const notify = () => onUpdate?.(snapshot());

  const handleResponse = (buffer) => {
    let found;
    try {
      found = collectCastRecords(parseDnsMessage(buffer));
    } catch {
      return; // Not every packet on the mDNS port is well-formed or relevant.
    }
    let changed = false;
    for (const device of found) {
      const existing = devices.get(device.id);
      if (
        !existing ||
        existing.host !== device.host ||
        existing.port !== device.port ||
        existing.name !== device.name
      ) {
        changed = true;
      }
      devices.set(device.id, { ...device, lastSeenAt: now() });
    }
    if (changed) notify();
  };

  const pruneStale = () => {
    let changed = false;
    for (const [id, device] of devices) {
      if (now() - device.lastSeenAt > STALE_DEVICE_MS) {
        devices.delete(id);
        changed = true;
      }
    }
    if (changed) notify();
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

  const openSocket = ({ bindPort, bindAddress, multicastMemberships, multicastInterface }) =>
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
      socket.on("message", handleResponse);
      socket.bind(bindPort, bindAddress, () => {
        try {
          for (const membershipAddress of multicastMemberships ?? []) {
            try {
              socket.addMembership(MDNS_ADDRESS, membershipAddress);
            } catch {
              // Membership per interface is best effort.
            }
          }
          if (multicastInterface) socket.setMulticastInterface(multicastInterface);
          socket.setMulticastTTL(255);
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

  const sendQueries = () => {
    for (const { socket, unicastResponse } of sockets) {
      const query = buildPtrQuery(CAST_SERVICE_NAME, { unicastResponse });
      socket.send(query, MDNS_PORT, MDNS_ADDRESS, () => {
        // Send errors are non-fatal; the periodic query retries.
      });
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

    // Multi-homed machines (VPN adapters, virtual switches) must query out of
    // every interface: the OS would otherwise route the multicast query out of
    // a single arbitrary one, which may not be the LAN the receiver is on.
    const interfaceAddresses = localIPv4Addresses();
    const listener = await openSocket({
      bindPort: MDNS_PORT,
      multicastMemberships: interfaceAddresses.length > 0 ? interfaceAddresses : [undefined],
    });
    const querySockets = await Promise.all(
      interfaceAddresses.map((address) =>
        openSocket({ bindPort: 0, bindAddress: address, multicastInterface: address }),
      ),
    );
    sockets = [
      listener ? { socket: listener, unicastResponse: false } : null,
      ...querySockets.map((socket) => (socket ? { socket, unicastResponse: true } : null)),
    ].filter(Boolean);

    if (sockets.length === 0) {
      running = false;
      failureMessage = "Could not open a local network socket for Cast discovery";
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
    for (const { socket } of sockets) {
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
    isRunning: () => running,
  };
};
