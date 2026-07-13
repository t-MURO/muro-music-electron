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
    },
  },
]);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-audio-seek-"));
const audioPath = path.join(temporaryDirectory, "seek-test.wav");
const htmlPath = path.join(temporaryDirectory, "index.html");

const writeSilentWave = (filePath, durationSeconds = 60) => {
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
  fs.writeFileSync(filePath, buffer);
};

writeSilentWave(audioPath);
fs.writeFileSync(htmlPath, "<!doctype html><html><body>Audio seek smoke test</body></html>");
app.setPath("userData", temporaryDirectory);

const cleanup = () => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
};

const timeout = setTimeout(() => {
  console.error("Audio seek smoke test timed out");
  cleanup();
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
    const audio = new Audio(${JSON.stringify(audioUrl)});
    audio.preload = "metadata";
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
    return { currentTime: audio.currentTime, duration: audio.duration };
  })()`);

  assert.ok(result.duration >= 59.9, `Unexpected duration: ${result.duration}`);
  assert.ok(result.currentTime >= 44.9, `Unexpected seek position: ${result.currentTime}`);

  clearTimeout(timeout);
  window.destroy();
  cleanup();
  console.log("Audio seek smoke test passed.");
  app.quit();
}).catch((error) => {
  clearTimeout(timeout);
  console.error(error);
  cleanup();
  app.exit(1);
});
