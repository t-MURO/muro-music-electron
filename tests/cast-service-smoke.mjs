import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCastService } from "../electron/cast/castService.mjs";
import {
  castContentTypeFor,
  isFinishedTransition,
  normalizeMediaStatus,
} from "../electron/cast/castState.mjs";

// --- castState units --------------------------------------------------------

assert.equal(castContentTypeFor("C:/music/track.MP3"), "audio/mpeg");
assert.equal(castContentTypeFor("/music/track.flac"), "audio/flac");
assert.equal(castContentTypeFor("/music/track.aiff"), null);
assert.equal(castContentTypeFor("/music/track.m4a"), null);

const playing = normalizeMediaStatus({
  mediaSessionId: 7,
  playerState: "PLAYING",
  currentTime: 12.5,
  media: { duration: 200 },
});
assert.equal(playing.playerState, "playing");
assert.equal(playing.position, 12.5);
assert.equal(playing.duration, 200);

const finished = normalizeMediaStatus({ mediaSessionId: 7, playerState: "IDLE", idleReason: "FINISHED" });
assert.equal(isFinishedTransition(playing, finished), true);
// Re-delivered FINISHED status must not advance again.
assert.equal(isFinishedTransition(finished, finished), false);
// User stop / errors do not advance.
const cancelled = normalizeMediaStatus({ mediaSessionId: 7, playerState: "IDLE", idleReason: "CANCELLED" });
assert.equal(isFinishedTransition(playing, cancelled), false);

// --- castService flows with mocked dependencies -----------------------------

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muro-cast-service-"));
const audioPath = path.join(tempDir, "track.mp3");
fs.writeFileSync(audioPath, Buffer.from([1, 2, 3]));

const makeMocks = () => {
  const calls = [];
  const adapterHandlers = new Map();
  const adapter = {
    loadGate: null,
    connect: async (target) => calls.push(["connect", target]),
    launchDefaultReceiver: async () => calls.push(["launch"]),
    loadMedia: async (payload) => {
      calls.push(["loadMedia", payload]);
      if (adapter.loadGate) await adapter.loadGate;
      return { mediaSessionId: 1, playerState: "PLAYING", currentTime: payload.currentTime, media: { duration: 180 } };
    },
    play: async () => ({ mediaSessionId: 1, playerState: "PLAYING", currentTime: 5, media: { duration: 180 } }),
    pause: async () => {
      calls.push(["pause"]);
      return { mediaSessionId: 1, playerState: "PAUSED", currentTime: 5, media: { duration: 180 } };
    },
    seek: async (position) => ({ mediaSessionId: 1, playerState: "PLAYING", currentTime: position, media: { duration: 180 } }),
    getMediaStatus: async () => null,
    setVolume: async (level) => calls.push(["setVolume", level]),
    stopReceiverApp: async () => calls.push(["stopReceiverApp"]),
    close: () => calls.push(["adapterClose"]),
    hasMediaSession: () => true,
    on: (event, listener) => {
      adapterHandlers.set(event, listener);
      return () => adapterHandlers.delete(event);
    },
  };
  const discovery = {
    started: false,
    start: async function start() {
      this.started = true;
      return this.getDevices();
    },
    stop() {
      this.started = false;
    },
    getDevices: () => ({
      devices: [{ id: "device-1", name: "Küche", model: "Nest Audio", host: "192.168.1.30", port: 8009 }],
      scanning: true,
      error: null,
    }),
    isRunning: () => true,
  };
  const mediaServer = {
    sessionActive: false,
    start: async () => ({ port: 45000 }),
    stop: async () => calls.push(["serverStop"]),
    beginSession: function beginSession() {
      this.sessionActive = true;
      return "session-token";
    },
    endSession: function endSession() {
      this.sessionActive = false;
    },
    revokeAuthorizations: () => calls.push(["revoke"]),
    authorizeFile: (filePath, kind) => ({ token: "tok", path: `/${kind}/session-token/tok-${path.basename(filePath)}` }),
    urlFor: (pathname) => `http://192.168.1.20:45000${pathname}`,
    getLanAddress: () => "192.168.1.20",
    isRunning: () => true,
  };
  return { calls, adapter, adapterHandlers, discovery, mediaServer };
};

const events = [];
const sender = { isDestroyed: () => false };
const mocks = makeMocks();
const service = createCastService({
  emit: (_sender, name, payload) => events.push([name, payload]),
  adapterFactory: () => mocks.adapter,
  discoveryFactory: () => mocks.discovery,
  mediaServerFactory: () => mocks.mediaServer,
});

try {
  // Discovery
  const snapshot = await service.commands.cast_start_discovery({}, sender);
  assert.equal(snapshot.devices.length, 1);
  assert.equal(mocks.discovery.started, true);

  // Connecting to an unknown device fails with a stable code.
  await assert.rejects(
    () => service.commands.cast_connect({ deviceId: "missing" }, sender),
    /CAST_DEVICE_NOT_FOUND/,
  );

  // Happy-path connect
  const connected = await service.commands.cast_connect({ deviceId: "device-1" }, sender);
  assert.equal(connected.state, "connected");
  assert.equal(connected.deviceName, "Küche");
  assert.deepEqual(mocks.calls.filter(([name]) => name === "connect")[0][1], {
    host: "192.168.1.30",
    port: 8009,
  });
  assert.ok(mocks.mediaServer.sessionActive);
  const stateNames = events.filter(([name]) => name === "muro://cast-state").map(([, payload]) => payload.state);
  assert.deepEqual(stateNames.slice(-2), ["connecting", "connected"]);

  // Unsupported format is rejected before touching the receiver.
  await assert.rejects(
    () => service.commands.cast_load_track({ trackId: "t1", sourcePath: "/x/track.aiff", title: "A" }),
    /CAST_UNSUPPORTED_FORMAT/,
  );

  // Missing file is rejected with a load error.
  await assert.rejects(
    () => service.commands.cast_load_track({ trackId: "t1", sourcePath: path.join(tempDir, "gone.mp3"), title: "A" }),
    /CAST_LOAD_FAILED/,
  );

  // Successful load sends tokenized URLs and reaches "playing".
  const loaded = await service.commands.cast_load_track({
    trackId: "track-9",
    sourcePath: audioPath,
    title: "Rise Again",
    artist: "Boston 168",
    album: "303 Regiment",
    durationSeconds: 180,
    startPositionSecs: 30,
  });
  assert.equal(loaded.state, "playing");
  assert.equal(loaded.track.trackId, "track-9");
  const loadCall = mocks.calls.find(([name]) => name === "loadMedia")[1];
  assert.equal(loadCall.contentId, "http://192.168.1.20:45000/media/session-token/tok-track.mp3");
  assert.equal(loadCall.contentType, "audio/mpeg");
  assert.equal(loadCall.currentTime, 30);
  assert.ok(mocks.calls.some(([name]) => name === "revoke"));

  // Transport commands received while a track is loading must run afterward.
  // This is the media-key case: Pause during LOAD should leave the receiver
  // paused, not be overwritten by LOAD's eventual autoplay.
  let releaseLoad;
  mocks.adapter.loadGate = new Promise((resolve) => {
    releaseLoad = resolve;
  });
  const loadCallCount = mocks.calls.filter(([name]) => name === "loadMedia").length;
  const queuedLoad = service.commands.cast_load_track({
    trackId: "track-serialized",
    sourcePath: audioPath,
    title: "Serialized",
    durationSeconds: 180,
  });
  while (mocks.calls.filter(([name]) => name === "loadMedia").length === loadCallCount) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const pauseCallCount = mocks.calls.filter(([name]) => name === "pause").length;
  const queuedPause = service.commands.cast_pause();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mocks.calls.filter(([name]) => name === "pause").length, pauseCallCount);
  releaseLoad();
  await queuedLoad;
  mocks.adapter.loadGate = null;
  await queuedPause;
  assert.equal(mocks.calls.filter(([name]) => name === "pause").length, pauseCallCount + 1);

  // Remote pause via command.
  const paused = await service.commands.cast_pause();
  assert.equal(paused.state, "paused");

  // Receiver-driven finished status advances exactly once.
  const finishedEventsBefore = events.filter(([name, payload]) => name === "muro://cast-media-status" && payload.finished).length;
  mocks.adapterHandlers.get("mediaStatus")({ mediaSessionId: 1, playerState: "PLAYING", currentTime: 179, media: { duration: 180 } });
  mocks.adapterHandlers.get("mediaStatus")({ mediaSessionId: 1, playerState: "IDLE", idleReason: "FINISHED" });
  mocks.adapterHandlers.get("mediaStatus")({ mediaSessionId: 1, playerState: "IDLE", idleReason: "FINISHED" });
  const finishedEvents = events.filter(([name, payload]) => name === "muro://cast-media-status" && payload.finished).length;
  assert.equal(finishedEvents - finishedEventsBefore, 1);

  // Disconnect returns the last remote position and resets to idle.
  await service.commands.cast_load_track({
    trackId: "track-9",
    sourcePath: audioPath,
    title: "Rise Again",
    artist: "Boston 168",
    album: "303 Regiment",
    durationSeconds: 180,
    startPositionSecs: 42,
  });
  const result = await service.commands.cast_disconnect();
  assert.equal(result.lastPositionSecs, 42);
  assert.equal(result.trackId, "track-9");
  assert.ok(mocks.calls.some(([name]) => name === "stopReceiverApp"));
  assert.equal(mocks.mediaServer.sessionActive, false);
  assert.equal((await service.commands.cast_get_state()).state, "idle");

  // Commands without a session fail with a stable code.
  await assert.rejects(() => service.commands.cast_play(), /CAST_SESSION_ENDED/);

  // An unexpected adapter close surfaces as a session-ended error state.
  await service.commands.cast_connect({ deviceId: "device-1" }, sender);
  mocks.adapterHandlers.get("close")();
  const finalState = await service.commands.cast_get_state();
  assert.equal(finalState.state, "error");
  assert.equal(finalState.lastError.code, "CAST_SESSION_ENDED");

  console.log("Cast service smoke test passed.");
} finally {
  service.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
