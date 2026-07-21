// Minimal SOAP client for UPnP AVTransport and RenderingControl services.
// Requests are plain HTTP POSTs with a SOAPACTION header; responses are
// well-formed machine-generated XML, read with targeted tag extraction.

const XML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&apos;"],
]);

export const escapeXml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => XML_ESCAPES.get(character));

const unescapeXml = (value) =>
  String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

// First occurrence of <tag>...</tag> anywhere in the document (namespace
// prefixes tolerated), unescaped.
export const extractXmlValue = (xml, tag) => {
  const match = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "i")
    .exec(String(xml ?? ""));
  return match ? unescapeXml(match[1].trim()) : null;
};

export const secondsToHms = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

export const hmsToSeconds = (value) => {
  const text = String(value ?? "").trim();
  if (!text || text === "NOT_IMPLEMENTED") return null;
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map((part) => Number.parseFloat(part));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return numbers.reduce((total, part) => total * 60 + part, 0);
};

// DIDL-Lite metadata for SetAVTransportURI so the renderer's display shows
// title/artist/album/artwork instead of a bare URL.
export const buildDidlMetadata = ({ url, contentType, title, artist, album, artUrl, durationSeconds }) => {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? ` duration="${secondsToHms(durationSeconds)}"`
    : "";
  const art = artUrl
    ? `<upnp:albumArtURI>${escapeXml(artUrl)}</upnp:albumArtURI>`
    : "";
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
    'xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">' +
    '<item id="muro-track" parentID="0" restricted="1">' +
    "<upnp:class>object.item.audioItem.musicTrack</upnp:class>" +
    `<dc:title>${escapeXml(title ?? "")}</dc:title>` +
    `<upnp:artist>${escapeXml(artist ?? "")}</upnp:artist>` +
    `<upnp:album>${escapeXml(album ?? "")}</upnp:album>` +
    art +
    `<res protocolInfo="http-get:*:${contentType}:DLNA.ORG_OP=01;DLNA.ORG_CI=0"${duration}>` +
    `${escapeXml(url)}</res>` +
    "</item></DIDL-Lite>"
  );
};

const SOAP_ENVELOPE_OPEN =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
  's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>';
const SOAP_ENVELOPE_CLOSE = "</s:Body></s:Envelope>";

export const buildSoapEnvelope = (serviceType, action, args = {}) => {
  const body = Object.entries(args)
    .map(([name, value]) => `<${name}>${value}</${name}>`)
    .join("");
  return `${SOAP_ENVELOPE_OPEN}<u:${action} xmlns:u="${serviceType}">${body}</u:${action}>${SOAP_ENVELOPE_CLOSE}`;
};

const AV_TRANSPORT_TYPE = "urn:schemas-upnp-org:service:AVTransport:1";
const RENDERING_CONTROL_TYPE = "urn:schemas-upnp-org:service:RenderingControl:1";
const SOAP_TIMEOUT_MS = 8_000;

// A control client bound to one renderer's AVTransport (+ optional
// RenderingControl) control URLs. fetchImpl is injectable for tests.
export const createDlnaClient = ({
  avTransportUrl,
  renderingControlUrl,
  fetchImpl = globalThis.fetch,
}) => {
  const soapRequest = async (controlUrl, serviceType, action, args = {}) => {
    if (!controlUrl) throw new Error(`Renderer does not expose ${serviceType}`);
    const response = await fetchImpl(controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPACTION: `"${serviceType}#${action}"`,
      },
      body: buildSoapEnvelope(serviceType, action, args),
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(SOAP_TIMEOUT_MS)
        : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      const upnpError = extractXmlValue(text, "errorCode");
      const description = extractXmlValue(text, "errorDescription");
      throw new Error(
        `${action} failed (HTTP ${response.status}${upnpError ? `, UPnP ${upnpError}` : ""}${description ? `: ${description}` : ""})`,
      );
    }
    return text;
  };

  const avTransport = (action, args = {}) =>
    soapRequest(avTransportUrl, AV_TRANSPORT_TYPE, action, { InstanceID: 0, ...args });

  return {
    setUri: ({ url, metadata }) =>
      avTransport("SetAVTransportURI", {
        CurrentURI: escapeXml(url),
        CurrentURIMetaData: escapeXml(metadata ?? ""),
      }),
    play: () => avTransport("Play", { Speed: 1 }),
    pause: () => avTransport("Pause"),
    stop: () => avTransport("Stop"),
    seek: (positionSecs) =>
      avTransport("Seek", { Unit: "REL_TIME", Target: secondsToHms(positionSecs) }),
    getTransportInfo: async () => {
      const xml = await avTransport("GetTransportInfo");
      // Busy renderers can answer with an empty state element; report null so
      // callers treat it as "unknown" rather than "stopped".
      return { transportState: extractXmlValue(xml, "CurrentTransportState") || null };
    },
    getMediaInfo: async () => {
      const xml = await avTransport("GetMediaInfo");
      return {
        currentUri: extractXmlValue(xml, "CurrentURI") || null,
        durationSecs: hmsToSeconds(extractXmlValue(xml, "MediaDuration")),
      };
    },
    getPositionInfo: async () => {
      const xml = await avTransport("GetPositionInfo");
      return {
        positionSecs: hmsToSeconds(extractXmlValue(xml, "RelTime")),
        durationSecs: hmsToSeconds(extractXmlValue(xml, "TrackDuration")),
      };
    },
    setVolume: (level) =>
      soapRequest(renderingControlUrl, RENDERING_CONTROL_TYPE, "SetVolume", {
        InstanceID: 0,
        Channel: "Master",
        DesiredVolume: Math.round(Math.max(0, Math.min(1, Number(level) || 0)) * 100),
      }),
    hasVolumeControl: () => Boolean(renderingControlUrl),
  };
};
