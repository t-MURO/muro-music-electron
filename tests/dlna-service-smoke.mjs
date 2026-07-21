import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDlnaService } from "../electron/dlna/dlnaService.mjs";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muro-dlna-service-"));
const audioPath = path.join(tempDir, "track.flac");
fs.writeFileSync(audioPath, Buffer.from([1, 2, 3]));

const makeMocks = () => {
  const calls = [];
  const clientState = { transportState: "STOPPED", position: 0, duration: 368, uriSet: false };
  const client = {
    setUri: async (payload) => {
      calls.push(["setUri", payload]);
      clientState.uriSet = true;
    },
    play: async () => {
      calls.push(["play"]);
      clientState.transportState = "PLAYING";
    },
    pause: async () => {
      calls.push(["pause"]);
      clientState.transportState = "PAUSED_PLAYBACK";
    },
    stop: async () => {
      calls.push(["stop"]);
      clientState.transportState = "STOPPED";
    },
    seek: async (positionSecs) => {
      calls.push(["seek", positionSecs]);
      clientState.position = positionSecs;
    },
    getTransportInfo: async () => ({ transportState: clientState.transportState }),
    getPositionInfo: async () => ({ positionSecs: clientState.position, durationSecs: clientState.duration }),
    getMediaInfo: async () => ({ currentUri: clientState.uriSet ? "http://set" : null, durationSecs: null }),
    setVolume: async (level) => calls.push(["setVolume", level]),
    hasVolumeControl: () => true,
  };
  const record = {
    id: "uuid-denon",
    name: "Denon",
    model: "Denon AVR-S760H",
    host: "192.168.1.9",
    port: 60006,
    avTransportUrl: "http://192.168.1.9:60006/av",
    renderingControlUrl: "http://192.168.1.9:60006/rc",
  };
  const discovery = {
    start: async () => ({ devices: [record], scanning: true, error: null }),
    stop: () => {},
    getDevices: () => ({
      devices: [{ id: record.id, name: record.name, model: record.model, host: record.host, port: record.port }],
      scanning: true,
      error: null,
    }),
    getDeviceRecord: (id) => (id === record.id ? record : null),
    isRunning: () => true,
  };
  const mediaServer = {
    sessionActive: false,
    start: async () => ({ port: 45001 }),
    stop: async () => {},
    beginSession() {
      this.sessionActive = true;
      return "session";
    },
    endSession() {
      this.sessionActive = false;
    },
    revokeAuthorizations: () => calls.push(["revoke"]),
    authorizeFile: (filePath, kind) => ({ token: "tok", path: `/${kind}/session/tok-${path.basename(filePath)}` }),
    urlFor: (pathname) => `http://192.168.1.2:45001${pathname}`,
    getLanAddress: () => "192.168.1.2",
    isRunning: () => true,
  };
  return { calls, client, clientState, discovery, mediaServer };
};

const events = [];
const sender = { isDestroyed: () => false };
const mocks = makeMocks();
const service = createDlnaService({
  emit: (_sender, name, payload) => events.push([name, payload]),
  clientFactory: () => mocks.client,
  discoveryFactory: () => mocks.discovery,
  mediaServerFactory: () => mocks.mediaServer,
});

try {
  const snapshot = await service.commands.dlna_start_discovery({}, sender);
  assert.equal(snapshot.devices.length, 1);

  await assert.rejects(
    () => service.commands.dlna_connect({ deviceId: "missing" }, sender),
    /DLNA_DEVICE_NOT_FOUND/,
  );

  const connected = await service.commands.dlna_connect({ deviceId: "uuid-denon" }, sender);
  assert.equal(connected.state, "connected");
  assert.equal(connected.deviceName, "Denon");
  assert.ok(mocks.mediaServer.sessionActive);

  await assert.rejects(
    () => service.commands.dlna_load_track({ trackId: "t", sourcePath: "/x/track.xyz", title: "A" }),
    /DLNA_UNSUPPORTED_FORMAT/,
  );
  await assert.rejects(
    () => service.commands.dlna_load_track({ trackId: "t", sourcePath: path.join(tempDir, "gone.flac"), title: "A" }),
    /DLNA_LOAD_FAILED/,
  );

  const loaded = await service.commands.dlna_load_track({
    trackId: "track-1",
    sourcePath: audioPath,
    title: "Rise Again",
    artist: "Boston 168",
    album: "303 Regiment",
    durationSeconds: 368,
    startPositionSecs: 30,
  });
  assert.equal(loaded.state, "playing");
  assert.equal(loaded.track.trackId, "track-1");
  const setUriCall = mocks.calls.find(([name]) => name === "setUri")[1];
  assert.equal(setUriCall.url, "http://192.168.1.2:45001/media/session/tok-track.flac");
  assert.ok(setUriCall.metadata.includes("Rise Again"));
  assert.ok(setUriCall.metadata.includes("audio/flac"));
  assert.deepEqual(mocks.calls.find(([name]) => name === "seek"), ["seek", 30]);

  const paused = await service.commands.dlna_pause();
  assert.equal(paused.state, "paused");
  const resumed = await service.commands.dlna_play();
  assert.equal(resumed.state, "playing");

  await service.commands.dlna_set_volume({ volume: 0.4 });
  assert.deepEqual(mocks.calls.at(-1), ["setVolume", 0.4]);

  const result = await service.commands.dlna_disconnect();
  assert.equal(result.trackId, "track-1");
  assert.equal(mocks.mediaServer.sessionActive, false);
  assert.equal((await service.commands.dlna_get_state()).state, "idle");
  assert.ok(mocks.calls.some(([name]) => name === "stop"));

  await assert.rejects(() => service.commands.dlna_play(), /DLNA_SESSION_ENDED/);

  console.log("DLNA service smoke test passed.");
} finally {
  service.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
