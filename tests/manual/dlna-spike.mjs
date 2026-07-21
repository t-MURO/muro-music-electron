// Manual DLNA renderer spike. Run on a network with a UPnP MediaRenderer
// (e.g. a Denon HEOS device):
//   node tests/manual/dlna-spike.mjs [path-to-mp3]
//
// Discovers renderers, drives the first one through SetAVTransportURI /
// Play / position polling / Seek, then stops it. Volume is left untouched.

import { createDlnaDiscovery } from "../../electron/dlna/dlnaDiscovery.mjs";
import { createDlnaClient, buildDidlMetadata } from "../../electron/dlna/dlnaClient.mjs";
import { createLanMediaServer } from "../../electron/lanMediaServer.mjs";

const audioPath = process.argv[2] ?? "C:/Users/Tadeo/Music/Music/Boston 168/303 Regiment/Rise Again.mp3";
const DISCOVERY_WINDOW_MS = 6_000;
const PLAY_OBSERVATION_MS = 6_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (step, detail = "") => console.log(`[spike] ${step}${detail ? `: ${detail}` : ""}`);

const watchdog = setTimeout(() => {
  console.error("[spike] TIMEOUT after 90s");
  process.exit(2);
}, 90_000);

const discovery = createDlnaDiscovery({});
const server = createLanMediaServer({
  onRequest: ({ method, url, range }) =>
    log("server hit", `${method} ${url.replace(/\/(media|artwork)\/[^/]+\/[^/?]+/, "/$1/<tokens>")}${range ? ` range=${range}` : ""}`),
});
let client = null;
let exitCode = 0;

try {
  log("discovering", `${DISCOVERY_WINDOW_MS / 1000}s SSDP window for MediaRenderer devices`);
  await discovery.start();
  await sleep(DISCOVERY_WINDOW_MS);
  const { devices, error } = discovery.getDevices();
  discovery.stop();

  if (devices.length === 0) {
    log("RESULT", `no renderers found${error ? ` (discovery error: ${error})` : ""}`);
    process.exit(3);
  }
  for (const device of devices) {
    log("found", `${device.name} (${device.model}) at ${device.host}:${device.port} id=${device.id}`);
  }

  const record = discovery.getDeviceRecord(devices[0].id);
  log("using", `${record.name} — AVTransport ${record.avTransportUrl}`);
  client = createDlnaClient({
    avTransportUrl: record.avTransportUrl,
    renderingControlUrl: record.renderingControlUrl,
  });

  const initial = await client.getTransportInfo();
  log("transport reachable", `state=${initial.transportState}`);

  await server.start();
  server.beginSession();
  const media = server.authorizeFile(audioPath, "media");
  const url = server.urlFor(media.path, { preferHost: record.host });
  if (!url) throw new Error("No LAN address reachable by the device");
  log("serving", url.replace(/\/media\/.*$/, "/media/<tokens>"));

  log("SetAVTransportURI");
  await client.setUri({
    url,
    metadata: buildDidlMetadata({
      url,
      contentType: "audio/mpeg",
      title: "Muro DLNA spike",
      artist: "Muro Music",
      album: "Spike",
      durationSeconds: 372,
    }),
  });

  // Wait for the renderer to register the URI before asking it to play.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const mediaInfo = await client.getMediaInfo();
    if (mediaInfo.currentUri) {
      log("media registered", `uri set, mediaDuration=${mediaInfo.durationSecs}`);
      break;
    }
    await sleep(300);
  }

  log("Play");
  await client.play();

  let sawPlaying = false;
  let playRetries = 0;
  for (let tick = 0; tick < 10; tick += 1) {
    await sleep(1_000);
    const position = await client.getPositionInfo();
    const transport = await client.getTransportInfo();
    log("status", `state=${transport.transportState} position=${position.positionSecs} duration=${position.durationSecs}`);
    if (transport.transportState === "PLAYING") {
      sawPlaying = true;
      if (tick >= PLAY_OBSERVATION_MS / 1000) break;
    }
    if (!sawPlaying && transport.transportState === "STOPPED" && tick >= 2 && playRetries === 0) {
      playRetries += 1;
      log("still stopped — retrying Play");
      await client.play();
    }
  }

  log("seeking to 60s (exercises HTTP range requests)");
  await client.seek(60);
  await sleep(2_500);
  const [afterSeekPos, afterSeekTransport] = await Promise.all([
    client.getPositionInfo(),
    client.getTransportInfo(),
  ]);
  log("after seek", `state=${afterSeekTransport.transportState} position=${afterSeekPos.positionSecs}`);

  const playing = afterSeekTransport.transportState === "PLAYING"
    || afterSeekTransport.transportState === "TRANSITIONING";
  const seeked = (afterSeekPos.positionSecs ?? 0) >= 55;
  log("RESULT", playing && seeked
    ? `SUCCESS — "${record.name}" played the local MP3 and honored the seek`
    : `PARTIAL — state=${afterSeekTransport.transportState} position=${afterSeekPos.positionSecs}`);
  if (!playing || !seeked) exitCode = 4;
} catch (spikeError) {
  console.error(`[spike] FAILED: ${spikeError.message}`);
  exitCode = 1;
} finally {
  try {
    await client?.stop();
  } catch {}
  discovery.stop();
  await server.stop();
  clearTimeout(watchdog);
  log("cleaned up (renderer stopped)");
  process.exit(exitCode);
}
