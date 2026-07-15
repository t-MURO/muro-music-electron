import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-renderer-smoke-"));
const smokeTracks = Array.from({ length: 250 }, (_, index) => ({
  id: `smoke-track-${index}`,
  title: `Smoke Track ${String(index).padStart(3, "0")}`,
  artist: "Muro",
  album: "Sticky Header Test",
  duration: "3:00",
  duration_seconds: 180,
  bitrate: "320 kbps",
  rating: 0,
  source_path: path.join(temporaryDirectory, `track-${index}.mp3`),
  play_count: 0,
}));

app.setPath("userData", temporaryDirectory);

const fail = (message) => {
  console.error(message);
  app.exit(1);
};

const timeout = setTimeout(() => fail("Renderer smoke test timed out"), 10_000);

app.whenReady().then(async () => {
  ipcMain.handle("muro:app-data-dir", () => temporaryDirectory);
  ipcMain.handle("muro:invoke", (_event, command) => {
    if (command === "load_tracks") return { library: smokeTracks, inbox: [] };
    if (command === "load_playlists") return {
      playlists: [{
        id: "smoke-playlist",
        name: "Smoke Playlist",
        track_ids: smokeTracks.map((track) => track.id),
      }],
    };
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
    const result = await window.webContents.executeJavaScript(`(async () => {
      const root = document.getElementById("root");
      const selectAll = document.querySelector('[aria-label="Select all tracks"]');
      const scroller = document.querySelector('[data-track-table-scroll]');
      const headerScroller = document.querySelector('[data-track-table-header-scroll]');
      const searchShortcutHint = document.querySelector('[data-search-shortcut-hint]');
      if (
        selectAll && scroller && headerScroller && searchShortcutHint &&
        scroller.scrollHeight > scroller.clientHeight
      ) {
        const beforeTop = selectAll.getBoundingClientRect().top;
        scroller.scrollTop = 3000;
        scroller.scrollLeft = 180;
        scroller.dispatchEvent(new Event("scroll"));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const afterTop = selectAll.getBoundingClientRect().top;
        const scrolledTop = scroller.scrollTop;
        const scrolledLeft = scroller.scrollLeft;
        const synchronizedHeaderLeft = headerScroller.scrollLeft;
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event("scroll"));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const firstTrackRow = scroller.querySelector('[role="row"]');
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        document.querySelector('[data-testid="delete-track-menu-item"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 40));
        const deleteModalReady = Boolean(
          document.querySelector('[data-delete-tracks-modal]') &&
          document.querySelector('[data-delete-library-only]') &&
          document.querySelector('[data-delete-from-disk]')
        );
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        window.location.hash = "#/playlists/smoke-playlist";
        await new Promise((resolve) => setTimeout(resolve, 60));
        const playlistRemoveReady = Boolean(document.querySelector('[data-remove-from-playlist]'));
        return {
          childCount: root?.childElementCount ?? 0,
          textLength: root?.textContent?.trim().length ?? 0,
          stickyHeaderReady: true,
          beforeTop,
          afterTop,
          scrollTop: scrolledTop,
          scrollLeft: scrolledLeft,
          headerScrollLeft: synchronizedHeaderLeft,
          platform: window.muro?.platform,
          searchShortcut: searchShortcutHint.textContent?.trim(),
          deleteModalReady,
          playlistRemoveReady,
        };
      }
      return {
        childCount: root?.childElementCount ?? 0,
        textLength: root?.textContent?.trim().length ?? 0,
        stickyHeaderReady: false,
      };
    })()`);
    if (result.childCount > 0 && result.textLength > 0 && result.stickyHeaderReady) {
      if (result.scrollTop <= 0) {
        fail("Track table did not scroll during sticky-header test");
        return;
      }
      if (Math.abs(result.afterTop - result.beforeTop) > 1) {
        fail(`Select-all header moved vertically: ${result.beforeTop} -> ${result.afterTop}`);
        return;
      }
      if (Math.abs(result.headerScrollLeft - result.scrollLeft) > 1) {
        fail(`Header horizontal scroll was not synchronized: ${result.headerScrollLeft} != ${result.scrollLeft}`);
        return;
      }
      const expectedSearchShortcut = result.platform === "darwin" ? "⌘F" : "Ctrl F";
      if (result.searchShortcut !== expectedSearchShortcut) {
        fail(`Unexpected search shortcut hint: ${result.searchShortcut} != ${expectedSearchShortcut}`);
        return;
      }
      if (!result.deleteModalReady) {
        fail("Track deletion did not present both library-only and disk choices");
        return;
      }
      if (!result.playlistRemoveReady) {
        fail("Playlist view did not show the remove-from-playlist button");
        return;
      }
      clearTimeout(timeout);
      console.log("Renderer smoke test passed");
      window.destroy();
      app.quit();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  fail("React did not mount any visible application content");
});
