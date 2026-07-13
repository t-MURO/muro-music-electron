import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-renderer-smoke-"));

app.setPath("userData", temporaryDirectory);

const fail = (message) => {
  console.error(message);
  app.exit(1);
};

const timeout = setTimeout(() => fail("Renderer smoke test timed out"), 10_000);

app.whenReady().then(async () => {
  ipcMain.handle("muro:app-data-dir", () => temporaryDirectory);
  ipcMain.handle("muro:invoke", (_event, command) => {
    if (command === "load_tracks") return { library: [], inbox: [] };
    if (command === "load_playlists") return { playlists: [] };
    if (command === "load_recently_played") return [];
    throw new Error(`Unexpected renderer smoke command: ${command}`);
  });

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(appRoot, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("console-message", (...args) => {
    const details = args.at(-1);
    if (details && typeof details === "object" && "message" in details) {
      console.error(`Renderer console: ${details.message}`);
      return;
    }
    console.error("Renderer console:", ...args.slice(1));
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`Preload error in ${preloadPath}:`, error);
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    fail(`Renderer failed to load (${code}): ${description}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    fail(`Renderer process exited: ${details.reason}`);
  });

  await window.loadFile(path.join(appRoot, "dist", "index.html"));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await window.webContents.executeJavaScript(`(() => {
      const root = document.getElementById("root");
      return {
        childCount: root?.childElementCount ?? 0,
        textLength: root?.textContent?.trim().length ?? 0,
      };
    })()`);
    if (result.childCount > 0 && result.textLength > 0) {
      clearTimeout(timeout);
      console.log("Renderer smoke test passed");
      window.destroy();
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      app.quit();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  fail("React did not mount any visible application content");
});
