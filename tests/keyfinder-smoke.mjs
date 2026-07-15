import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKeyFinderService } from "../electron/keyfinder.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const binaryDirectory = path.resolve(
  here,
  "../../neo-key-finder/neo-keyfinder/src-tauri/binaries",
);
let finish;
const finished = new Promise((resolve) => { finish = resolve; });
const events = [];
const sender = {
  isDestroyed: () => false,
  send: (_channel, name, payload) => {
    assert.equal(name, "muro://keyfinder-analysis");
    events.push(payload);
    if (payload.event === "jobFinished") finish(payload);
  },
};
const service = createKeyFinderService({
  binaryDirectories: [binaryDirectory],
  emit: (target, name, payload) => target.send("muro:event", name, payload),
});
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-keyfinder-smoke-"));
const waveformPath = path.join(temporaryDirectory, "waveform.wav");

const sampleRate = 8_000;
const sampleCount = sampleRate;
const pcm = Buffer.alloc(sampleCount * 2);
for (let index = 0; index < sampleCount; index += 1) {
  const envelope = index < sampleCount / 2 ? index / (sampleCount / 2) : (sampleCount - index) / (sampleCount / 2);
  pcm.writeInt16LE(Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 220) * envelope * 28_000), index * 2);
}
const wav = Buffer.alloc(44 + pcm.length);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + pcm.length, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
fs.writeFileSync(waveformPath, wav);

try {
  const health = await service.health();
  assert.equal(health.service, "keyfinder-native");
  assert.equal(health.protocolVersion, 1);

  const waveform = await service.generateWaveform(waveformPath, 64);
  assert.equal(waveform.peaks.length, 64);
  assert.ok(Math.max(...waveform.peaks) > 0.5);

  const started = await service.startAnalysis([{
    id: "missing-track",
    title: "Missing",
    artist: "",
    album: "",
    sourcePath: path.join(here, "does-not-exist.wav"),
    durationSeconds: 60,
  }], sender);
  assert.match(started.jobId, /^job-/);

  const completed = await Promise.race([
    finished,
    new Promise((_, reject) => setTimeout(() => reject(new Error("KeyFinder job timed out")), 10_000)),
  ]);
  assert.equal(completed.payload.total, 1);
  assert.ok(events.some((event) =>
    event.event === "trackUpdated" && event.payload.track.status === "failed"));
} finally {
  service.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("KeyFinder integration smoke test passed");
