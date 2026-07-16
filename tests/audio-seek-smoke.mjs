import assert from "node:assert/strict";
import { app, BrowserWindow, protocol } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalFileResponse } from "../electron/fileProtocol.mjs";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "muro-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-audio-seek-"));
const audioPath = path.join(temporaryDirectory, "seek-test.wav");
const htmlPath = path.join(temporaryDirectory, "index.html");

const writeToneWave = (filePath, durationSeconds = 60) => {
  const sampleRate = 44_100;
  const channelCount = 1;
  const bytesPerSample = 2;
  const dataSize = sampleRate * durationSeconds * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let sample = 0; sample < sampleRate * durationSeconds; sample += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * sample) / sampleRate) * 12_000);
    buffer.writeInt16LE(value, 44 + sample * bytesPerSample);
  }
  fs.writeFileSync(filePath, buffer);
};

writeToneWave(audioPath);
fs.writeFileSync(htmlPath, "<!doctype html><html><body>Audio seek smoke test</body></html>");
app.setPath("userData", temporaryDirectory);

const timeout = setTimeout(() => {
  console.error("Audio seek smoke test timed out");
  app.exit(1);
}, 15_000);

app.whenReady().then(async () => {
  protocol.handle("muro-file", (request) => {
    const url = new URL(request.url);
    return createLocalFileResponse(request, decodeURIComponent(url.pathname.slice(1)));
  });

  const window = new BrowserWindow({ show: false });
  await window.loadFile(htmlPath);

  const audioUrl = `muro-file://local/${encodeURIComponent(audioPath)}`;
  const result = await window.webContents.executeJavaScript(`(async () => {
    const response = await fetch(${JSON.stringify(audioUrl)});
    if (!response.ok) throw new Error(\`audio fetch failed (HTTP \${response.status})\`);
    const encoded = await response.arrayBuffer();
    const fetchedBytes = encoded.byteLength;
    const decodeContext = new OfflineAudioContext(1, 1, 11025);
    const decoded = await decodeContext.decodeAudioData(encoded);
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "metadata";
    audio.src = ${JSON.stringify(audioUrl)};
    await new Promise((resolve, reject) => {
      audio.addEventListener("loadedmetadata", resolve, { once: true });
      audio.addEventListener("error", () => reject(new Error(audio.error?.message ?? "load failed")), { once: true });
      audio.load();
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("seeked event timed out")), 5000);
      audio.addEventListener("seeked", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      audio.currentTime = 45;
    });
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    const mutedOutput = context.createGain();
    mutedOutput.gain.value = 0;
    source.connect(analyser);
    analyser.connect(mutedOutput);
    mutedOutput.connect(context.destination);
    await context.resume();
    await audio.play();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    const graphPeak = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
    audio.pause();
    await context.close();
    return {
      currentTime: audio.currentTime,
      duration: audio.duration,
      decodedDuration: decoded.duration,
      decodedSampleRate: decoded.sampleRate,
      fetchedBytes,
      graphPeak,
    };
  })()`);

  assert.ok(result.fetchedBytes > 44, `Unexpected fetched byte count: ${result.fetchedBytes}`);
  assert.equal(result.decodedSampleRate, 11025);
  assert.ok(result.decodedDuration >= 59.9, `Unexpected decoded duration: ${result.decodedDuration}`);
  assert.ok(result.duration >= 59.9, `Unexpected duration: ${result.duration}`);
  assert.ok(result.currentTime >= 44.9, `Unexpected seek position: ${result.currentTime}`);
  assert.ok(result.graphPeak > 0.1, `Web Audio graph was silent (peak: ${result.graphPeak})`);

  clearTimeout(timeout);
  window.destroy();
  console.log("Audio seek smoke test passed.");
  app.quit();
}).catch((error) => {
  clearTimeout(timeout);
  console.error(error);
  app.exit(1);
});
