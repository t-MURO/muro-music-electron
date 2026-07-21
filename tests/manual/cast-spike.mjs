// Milestone-0 physical-device spike from CHROMECAST_FEATURE.md.
// Run manually on a network with a Cast device:
//   node tests/manual/cast-spike.mjs [path-to-mp3]
//
// Discovers devices, connects to the first one, launches the Default Media
// Receiver, serves the given MP3 over the tokenized LAN server, plays it for
// a few seconds, seeks, prints receiver statuses, then stops and cleans up.
// The receiver's volume is intentionally left untouched.

import { createCastDiscovery } from "../../electron/cast/castDiscovery.mjs";
import { createCastClientAdapter } from "../../electron/cast/castClientAdapter.mjs";
import { createCastMediaServer } from "../../electron/cast/castMediaServer.mjs";

const audioPath = process.argv[2] ?? "C:/Users/Tadeo/Music/Music/Boston 168/303 Regiment/Rise Again.mp3";
const DISCOVERY_WINDOW_MS = 8_000;
const PLAY_OBSERVATION_MS = 6_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (step, detail = "") => console.log(`[spike] ${step}${detail ? `: ${detail}` : ""}`);

const watchdog = setTimeout(() => {
  console.error("[spike] TIMEOUT after 90s — likely stalled on firewall or device handshake");
  process.exit(2);
}, 90_000);

const discovery = createCastDiscovery({});
const server = createCastMediaServer();
const adapter = createCastClientAdapter();
let exitCode = 0;

try {
  log("discovering", `${DISCOVERY_WINDOW_MS / 1000}s window on _googlecast._tcp`);
  await discovery.start();
  await sleep(DISCOVERY_WINDOW_MS);
  const { devices, error } = discovery.getDevices();
  discovery.stop();

  if (devices.length === 0) {
    log("RESULT", `no cast devices found${error ? ` (discovery error: ${error})` : ""}`);
    process.exit(3);
  }
  for (const device of devices) {
    log("found", `${device.name} (${device.model}) at ${device.host}:${device.port} id=${device.id}`);
  }

  const device = devices[0];
  log("connecting", `${device.name} ${device.host}:${device.port}`);
  adapter.on("error", (err) => log("adapter error", err.message));
  adapter.on("close", () => log("adapter close event"));
  await adapter.connect({ host: device.host, port: device.port });
  log("connected, launching Default Media Receiver");
  const { transportId } = await adapter.launchDefaultReceiver();
  log("receiver launched", `transport=${transportId}`);

  await server.start();
  server.beginSession();
  const media = server.authorizeFile(audioPath, "media");
  const url = server.urlFor(media.path, { preferHost: device.host });
  if (!url) throw new Error("No LAN address reachable by the device");
  log("serving", url.replace(/\/media\/.*$/, "/media/<tokens>"));

  log("loading track", audioPath);
  const loadStatus = await adapter.loadMedia({
    contentId: url,
    contentType: "audio/mpeg",
    title: "Muro cast spike",
    artist: "Muro Music",
    album: "Spike",
    autoplay: true,
  });
  log("load response", `playerState=${loadStatus?.playerState} mediaSessionId=${loadStatus?.mediaSessionId}`);

  for (let tick = 0; tick < PLAY_OBSERVATION_MS / 1000; tick += 1) {
    await sleep(1_000);
    const status = await adapter.getMediaStatus();
    log("status", `playerState=${status?.playerState} position=${status?.currentTime?.toFixed?.(1)}`);
  }

  log("seeking to 60s (exercises HTTP range requests)");
  const seekStatus = await adapter.seek(60);
  await sleep(2_000);
  const afterSeek = await adapter.getMediaStatus();
  log("after seek", `playerState=${afterSeek?.playerState ?? seekStatus?.playerState} position=${afterSeek?.currentTime?.toFixed?.(1)}`);

  const playing = (afterSeek?.playerState === "PLAYING" || afterSeek?.playerState === "BUFFERING");
  const seeked = (afterSeek?.currentTime ?? 0) >= 58;
  log("RESULT", playing && seeked
    ? `SUCCESS — "${device.name}" played the local MP3 and honored the seek`
    : `PARTIAL — playerState=${afterSeek?.playerState} position=${afterSeek?.currentTime}`);
  if (!playing || !seeked) exitCode = 4;
} catch (spikeError) {
  console.error(`[spike] FAILED: ${spikeError.message}`);
  exitCode = 1;
} finally {
  try {
    await adapter.stopReceiverApp();
  } catch {}
  adapter.close();
  discovery.stop();
  await server.stop();
  clearTimeout(watchdog);
  log("cleaned up (receiver app stopped)");
  process.exit(exitCode);
}
