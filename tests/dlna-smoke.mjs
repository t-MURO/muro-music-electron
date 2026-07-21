import assert from "node:assert/strict";
import {
  buildDidlMetadata,
  buildSoapEnvelope,
  createDlnaClient,
  escapeXml,
  extractXmlValue,
  hmsToSeconds,
  readDlnaXmlResponse,
  secondsToHms,
} from "../electron/dlna/dlnaClient.mjs";
import {
  buildMSearch,
  parseSsdpResponse,
  parseDeviceDescription,
  isTrustedDescriptionLocation,
  usnUuid,
  MEDIA_RENDERER_TARGET,
} from "../electron/dlna/dlnaDiscovery.mjs";
import {
  dlnaContentTypeFor,
  isDlnaFinishedTransition,
  normalizeTransportStatus,
} from "../electron/dlna/dlnaState.mjs";

// --- time helpers -----------------------------------------------------------

assert.equal(secondsToHms(0), "0:00:00");
assert.equal(secondsToHms(62), "0:01:02");
assert.equal(secondsToHms(3723), "1:02:03");
assert.equal(hmsToSeconds("0:01:02"), 62);
assert.equal(hmsToSeconds("1:02:03"), 3723);
assert.equal(hmsToSeconds("00:06:08.000"), 368);
assert.equal(hmsToSeconds("NOT_IMPLEMENTED"), null);
assert.equal(hmsToSeconds(""), null);

// --- XML helpers ------------------------------------------------------------

assert.equal(escapeXml(`a<b>&"c"'d'`), "a&lt;b&gt;&amp;&quot;c&quot;&apos;d&apos;");
assert.equal(extractXmlValue("<u:Res><CurrentTransportState>PLAYING</CurrentTransportState></u:Res>", "CurrentTransportState"), "PLAYING");
assert.equal(extractXmlValue("<x:TrackDuration>0:06:08</x:TrackDuration>", "TrackDuration"), "0:06:08");
assert.equal(extractXmlValue("<a>1</a>", "b"), null);
assert.equal(extractXmlValue("<RelTime></RelTime>", "RelTime"), "");

// --- DIDL metadata ----------------------------------------------------------

const didl = buildDidlMetadata({
  url: "http://192.168.1.2:1234/media/s/t",
  contentType: "audio/flac",
  title: 'Träume & "Echos" <live>',
  artist: "Boston 168",
  album: "303 Regiment",
  artUrl: "http://192.168.1.2:1234/artwork/s/a",
  durationSeconds: 368,
});
assert.ok(didl.includes("object.item.audioItem.musicTrack"));
assert.ok(didl.includes("Träume &amp; &quot;Echos&quot; &lt;live&gt;"));
assert.ok(didl.includes('duration="0:06:08"'));
assert.ok(didl.includes("http-get:*:audio/flac:DLNA.ORG_OP=01"));
assert.ok(didl.includes("<upnp:albumArtURI>http://192.168.1.2:1234/artwork/s/a</upnp:albumArtURI>"));

// --- SOAP envelope and client parsing ---------------------------------------

const envelope = buildSoapEnvelope("urn:schemas-upnp-org:service:AVTransport:1", "Seek", {
  InstanceID: 0,
  Unit: "REL_TIME",
  Target: "0:01:00",
});
assert.ok(envelope.includes('<u:Seek xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">'));
assert.ok(envelope.includes("<Target>0:01:00</Target>"));

const soapCalls = [];
const fakeFetch = async (url, options) => {
  const action = /#(\w+)"$/.exec(options.headers.SOAPACTION)?.[1];
  soapCalls.push({ url, action });
  const bodies = {
    GetTransportInfo: "<CurrentTransportState>PLAYING</CurrentTransportState>",
    GetPositionInfo: "<RelTime>0:01:02</RelTime><TrackDuration>0:06:08</TrackDuration>",
    GetMediaInfo: "<CurrentURI>http://x/y</CurrentURI><MediaDuration>0:06:08</MediaDuration>",
  };
  return {
    ok: true,
    status: 200,
    text: async () => `<s:Envelope><s:Body><u:${action}Response>${bodies[action] ?? ""}</u:${action}Response></s:Body></s:Envelope>`,
  };
};
const client = createDlnaClient({
  avTransportUrl: "http://device/av",
  renderingControlUrl: "http://device/rc",
  fetchImpl: fakeFetch,
});
assert.deepEqual(await client.getTransportInfo(), { transportState: "PLAYING" });
assert.deepEqual(await client.getPositionInfo(), { positionSecs: 62, durationSecs: 368 });
assert.deepEqual(await client.getMediaInfo(), { currentUri: "http://x/y", durationSecs: 368 });
await client.seek(62);
await client.setVolume(0.5);
assert.equal(soapCalls.at(-1).url, "http://device/rc");
assert.equal(soapCalls.at(-1).action, "SetVolume");

const failingClient = createDlnaClient({
  avTransportUrl: "http://device/av",
  fetchImpl: async () => ({
    ok: false,
    status: 500,
    text: async () => "<errorCode>701</errorCode><errorDescription>Transition not available</errorDescription>",
  }),
});
await assert.rejects(() => failingClient.play(), /UPnP 701.*Transition not available/);
await assert.rejects(() => failingClient.setVolume(1), /does not expose/);
await assert.rejects(
  () => readDlnaXmlResponse({ text: async () => "x".repeat(32) }, 16),
  /exceeds the allowed size/,
);

// --- SSDP -------------------------------------------------------------------

const search = buildMSearch().toString("utf8");
assert.ok(search.startsWith("M-SEARCH * HTTP/1.1"));
assert.ok(search.includes(`ST: ${MEDIA_RENDERER_TARGET}`));

const ssdpResponse = [
  "HTTP/1.1 200 OK",
  "CACHE-CONTROL: max-age=180",
  "LOCATION: http://192.168.1.9:60006/upnp/desc/aios_device/aios_device.xml",
  "SERVER: LINUX UPnP/1.0 Denon-Heos/fc5f31",
  `ST: ${MEDIA_RENDERER_TARGET}`,
  "USN: uuid:0e92156d-1949-1446-0080-000678a5ec5a::urn:schemas-upnp-org:device:MediaRenderer:1",
  "",
  "",
].join("\r\n");
const parsed = parseSsdpResponse(ssdpResponse);
assert.equal(parsed.location, "http://192.168.1.9:60006/upnp/desc/aios_device/aios_device.xml");
assert.equal(usnUuid(parsed.usn), "0e92156d-1949-1446-0080-000678a5ec5a");
assert.equal(parseSsdpResponse("NOTIFY * HTTP/1.1\r\nNT: upnp:rootdevice\r\n\r\n"), null);
assert.equal(
  isTrustedDescriptionLocation("http://192.168.1.9:60006/device.xml", "192.168.1.9"),
  true,
);
assert.equal(
  isTrustedDescriptionLocation("http://127.0.0.1:8080/private", "192.168.1.9"),
  false,
);
assert.equal(
  isTrustedDescriptionLocation("file:///C:/Windows/win.ini", "192.168.1.9"),
  false,
);

// --- device description with embedded renderer (HEOS-style) -----------------

const description = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-denon-com:device:AiosDevice:1</deviceType>
    <friendlyName>Denon</friendlyName>
    <manufacturer>Denon</manufacturer>
    <modelName>Denon AVR-S760H</modelName>
    <deviceList>
      <device>
        <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
        <friendlyName>Denon Renderer</friendlyName>
        <serviceList>
          <service>
            <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
            <controlURL>/upnp/control/renderer_dvc/AVTransport</controlURL>
          </service>
          <service>
            <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
            <controlURL>/upnp/control/renderer_dvc/RenderingControl</controlURL>
          </service>
        </serviceList>
      </device>
    </deviceList>
  </device>
</root>`;
const parsedDescription = parseDeviceDescription(description, "http://192.168.1.9:60006/upnp/desc/aios_device/aios_device.xml");
assert.equal(parsedDescription.friendlyName, "Denon");
assert.equal(parsedDescription.modelName, "Denon AVR-S760H");
assert.equal(parsedDescription.avTransportUrl, "http://192.168.1.9:60006/upnp/control/renderer_dvc/AVTransport");
assert.equal(parsedDescription.renderingControlUrl, "http://192.168.1.9:60006/upnp/control/renderer_dvc/RenderingControl");

const hostileDescription = description.replace(
  "/upnp/control/renderer_dvc/AVTransport",
  "http://127.0.0.1:8080/private",
);
assert.equal(
  parseDeviceDescription(hostileDescription, "http://192.168.1.9:60006/device.xml").avTransportUrl,
  null,
);

// --- state normalization and finish detection -------------------------------

assert.equal(dlnaContentTypeFor("x.m4a"), "audio/mp4");
assert.equal(dlnaContentTypeFor("x.aiff"), "audio/aiff");
assert.equal(dlnaContentTypeFor("x.xyz"), null);

const nearEnd = normalizeTransportStatus({ transportState: "PLAYING", positionSecs: 365, durationSecs: 368 });
const stopped = normalizeTransportStatus({ transportState: "STOPPED", positionSecs: 0, durationSecs: 368 });
const midTrack = normalizeTransportStatus({ transportState: "PLAYING", positionSecs: 100, durationSecs: 368 });
assert.equal(nearEnd.playerState, "playing");
assert.equal(stopped.playerState, "idle");
assert.equal(isDlnaFinishedTransition(nearEnd, stopped), true);
assert.equal(isDlnaFinishedTransition(midTrack, stopped), false); // user/device stop mid-track
assert.equal(isDlnaFinishedTransition(stopped, stopped), false);

console.log("DLNA smoke test passed.");
