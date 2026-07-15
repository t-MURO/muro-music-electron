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
  artists: "Muro",
  album: `Smoke Album ${String(Math.floor(index / 10)).padStart(2, "0")}`,
  track_number: (index % 10) + 1,
  track_total: 10,
  year: 2000 + Math.floor(index / 10),
  date_added: `2026-06-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
  genre: index % 2 === 0 ? "Electronic" : "House",
  duration: "3:00",
  duration_seconds: 180,
  bitrate: "320 kbps",
  key: ["8A", "8A", "9A", "7A", "8B", "2B"][index % 6],
  bpm: 120 + (index % 8),
  rating: 0,
  source_path: path.join(temporaryDirectory, `track-${index}.mp3`),
  play_count: 0,
}));

app.setPath("userData", temporaryDirectory);

const fail = (message) => {
  console.error(message);
  app.exit(1);
};

const timeout = setTimeout(() => fail("Renderer smoke test timed out"), 25_000);

app.whenReady().then(async () => {
  ipcMain.handle("muro:app-data-dir", () => temporaryDirectory);
  ipcMain.handle("muro:window-is-maximized", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  );
  ipcMain.handle("muro:window-control", (event, action) => {
    const testWindow = BrowserWindow.fromWebContents(event.sender);
    if (!testWindow) return false;
    if (action === "toggleMaximize") {
      if (testWindow.isMaximized()) testWindow.unmaximize();
      else testWindow.maximize();
      return testWindow.isMaximized();
    }
    if (action === "minimize") testWindow.minimize();
    if (action === "close") testWindow.close();
    return false;
  });
  ipcMain.handle("muro:invoke", (_event, command, args = {}) => {
    if (command === "load_tracks") return { library: smokeTracks, inbox: [] };
    if (command === "load_playlists") return {
      playlists: [{
        id: "smoke-playlist",
        name: "Smoke Playlist",
        track_ids: smokeTracks.map((track) => track.id),
      }],
    };
    if (command === "load_recently_played") return [];
    if (command === "playback_get_state") return {
      is_playing: false,
      current_position: 0,
      duration: 0,
      volume: 1,
      current_track: null,
    };
    if (
      command === "playback_play_file" ||
      command === "playback_set_seek_mode" ||
      command === "generate_track_waveform"
    ) return command === "generate_track_waveform" ? [] : undefined;
    if (command === "delete_tracks") return {
      deletedTrackIds: [],
      failures: (args.trackIds ?? []).map((trackId) => ({
        trackId,
        path: "smoke.mp3",
        message: "Simulated locked file",
      })),
    };
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
      const windowChrome = document.querySelector('[data-window-chrome]');
      const windowBrand = document.querySelector('[data-window-brand]');
      const windowControls = document.querySelector(
        window.muro?.platform === "darwin" ? '[data-window-controls="mac"]' : '[data-window-controls="desktop"]'
      );
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
        firstTrackRow?.dispatchEvent(new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        firstTrackRow?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const tableFocusedAfterClick = document.activeElement === scroller;
        scroller.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const selectedAfterArrowDown = scroller.querySelector('[data-track-selected="true"]')
          ?.getAttribute("data-track-index");
        scroller.dispatchEvent(new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 60));
        const playingAfterSpace = scroller.querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        document.querySelector('[data-panel-view="mix"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const mixSuggestions = Array.from(document.querySelectorAll('[data-mix-suggestion]'));
        const mixSuggestionCount = mixSuggestions.length;
        const firstMixReason = mixSuggestions[0]?.getAttribute("data-mix-reason");
        const camelotSegmentCount = document.querySelectorAll('[data-camelot-code]').length;
        const compatibleCamelotCount = document.querySelectorAll('[data-camelot-compatible="true"]').length;
        const currentCamelotCode = document.querySelector('[data-camelot-current="true"]')
          ?.getAttribute("data-camelot-code");
        document.querySelector('[data-camelot-code="9A"]')?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 60));
        const selectedCamelotCode = document.querySelector('[data-camelot-selected="true"]')
          ?.getAttribute("data-camelot-code");
        const filteredMixSuggestions = Array.from(document.querySelectorAll('[data-mix-suggestion]'));
        const wheelFilteredTo9A = filteredMixSuggestions.length > 0 && filteredMixSuggestions.every(
          (suggestion) => suggestion.getAttribute("data-mix-code") === "9A"
        );
        filteredMixSuggestions[0]?.querySelector('[data-mix-play-next]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        document.querySelector('[data-panel-view="queue"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const queuedFromMix = document.querySelectorAll('[data-queue-track]').length === 1;
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const contextMenuOpened = Boolean(document.querySelector('[data-popover]'));
        document.querySelector('[data-popover]')?.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        const contextMenuStayedOpenInside = Boolean(document.querySelector('[data-popover]'));
        headerScroller.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 180));
        const contextMenuClosedOutside = !document.querySelector('[data-popover]');
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
        const initialLibraryPreference = Boolean(
          document.querySelector('[data-delete-library-only][data-delete-preferred="true"]')
        );
        document.querySelector('[data-delete-from-disk]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        document.querySelector('[data-testid="delete-track-menu-item"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 40));
        const preferredDiskButton = document.querySelector(
          '[data-delete-from-disk][data-delete-preferred="true"]'
        );
        const rememberedDiskPreference = Boolean(
          preferredDiskButton && document.activeElement === preferredDiskButton
        );
        let persistedDeleteMode = null;
        try {
          persistedDeleteMode = JSON.parse(localStorage.getItem("muro-settings") ?? "null")
            ?.state?.lastDeleteMode ?? null;
        } catch {}
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        window.location.hash = "#/playlists/smoke-playlist";
        await new Promise((resolve) => setTimeout(resolve, 60));
        const playlistRemoveReady = Boolean(document.querySelector('[data-remove-from-playlist]'));
        window.location.hash = "#/settings";
        await new Promise((resolve) => setTimeout(resolve, 60));
        document.querySelector('[data-settings-tab="analysis"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const notationSelect = document.querySelector('[data-analysis-notation]');
        const notationOptions = notationSelect instanceof HTMLSelectElement
          ? Array.from(notationSelect.options, (option) => option.value)
          : [];
        const analysisNotationSettingsReady =
          notationOptions.includes("standard") &&
          notationOptions.includes("custom") &&
          notationOptions.includes("combined") &&
          notationOptions.includes("djCombined");
        window.location.hash = "#/collection/albums";
        await new Promise((resolve) => setTimeout(resolve, 100));
        const albumsViewReady = Boolean(document.querySelector("[data-albums-view]"));
        const albumCardCount = document.querySelectorAll("[data-album-card]").length;
        const albumSort = document.querySelector("[data-album-sort]");
        const albumSortOptions = albumSort instanceof HTMLSelectElement
          ? Array.from(albumSort.options, (option) => option.value)
          : [];
        document.querySelector(".album-card-open")?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const albumDetailReady = Boolean(document.querySelector("[data-album-detail]"));
        const albumDetailTrackCount = document.querySelectorAll("[data-album-track]").length;
        document.querySelector(".album-back-button")?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        document.querySelector('[aria-label="List view"]')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const albumListReady = Boolean(document.querySelector(".album-collection--list"));
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
          initialLibraryPreference,
          rememberedDiskPreference,
          persistedDeleteMode,
          playlistRemoveReady,
          windowChromeReady: Boolean(windowChrome && windowBrand && windowControls),
          windowChromeDragRegion: windowChrome
            ? getComputedStyle(windowChrome).getPropertyValue("-webkit-app-region")
            : "",
          tableFocusedAfterClick,
          selectedAfterArrowDown,
          playingAfterSpace,
          mixSuggestionCount,
          firstMixReason,
          camelotSegmentCount,
          compatibleCamelotCount,
          currentCamelotCode,
          selectedCamelotCode,
          wheelFilteredTo9A,
          queuedFromMix,
          analysisNotationSettingsReady,
          contextMenuOpened,
          contextMenuStayedOpenInside,
          contextMenuClosedOutside,
          albumsViewReady,
          albumCardCount,
          albumSortOptions,
          albumDetailReady,
          albumDetailTrackCount,
          albumListReady,
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
      if (
        !result.initialLibraryPreference ||
        !result.rememberedDiskPreference ||
        result.persistedDeleteMode !== "disk"
      ) {
        fail("Track deletion did not remember and focus the last selected choice");
        return;
      }
      if (
        result.mixSuggestionCount < 3 ||
        result.firstMixReason !== "Same key" ||
        !result.queuedFromMix
      ) {
        fail(
          `Camelot suggestions failed: count=${result.mixSuggestionCount}, ` +
          `reason=${result.firstMixReason}, queued=${result.queuedFromMix}`
        );
        return;
      }
      if (
        result.camelotSegmentCount !== 24 ||
        result.compatibleCamelotCount !== 4 ||
        result.currentCamelotCode !== "8A" ||
        result.selectedCamelotCode !== "9A" ||
        !result.wheelFilteredTo9A
      ) {
        fail(
          `Camelot wheel failed: segments=${result.camelotSegmentCount}, ` +
          `compatible=${result.compatibleCamelotCount}, current=${result.currentCamelotCode}, ` +
          `selected=${result.selectedCamelotCode}, filtered=${result.wheelFilteredTo9A}`
        );
        return;
      }
      if (!result.analysisNotationSettingsReady) {
        fail("Key notation modes are not visible in the Key Analysis settings tab");
        return;
      }
      if (
        !result.albumsViewReady ||
        result.albumCardCount !== 25 ||
        !result.albumSortOptions.includes("title") ||
        !result.albumSortOptions.includes("artist") ||
        !result.albumSortOptions.includes("year") ||
        !result.albumSortOptions.includes("recent") ||
        !result.albumDetailReady ||
        result.albumDetailTrackCount !== 10 ||
        !result.albumListReady
      ) {
        fail(
          `Album view failed: view=${result.albumsViewReady}, cards=${result.albumCardCount}, ` +
          `detail=${result.albumDetailReady}, tracks=${result.albumDetailTrackCount}, list=${result.albumListReady}`
        );
        return;
      }
      if (
        !result.contextMenuOpened ||
        !result.contextMenuStayedOpenInside ||
        !result.contextMenuClosedOutside
      ) {
        fail(
          `Context-menu dismissal failed: opened=${result.contextMenuOpened}, ` +
          `inside=${result.contextMenuStayedOpenInside}, outside=${result.contextMenuClosedOutside}`
        );
        return;
      }
      if (!result.playlistRemoveReady) {
        fail("Playlist view did not show the remove-from-playlist button");
        return;
      }
      if (!result.windowChromeReady || result.windowChromeDragRegion !== "drag") {
        fail("Custom window chrome is missing or is not draggable");
        return;
      }
      if (
        !result.tableFocusedAfterClick ||
        result.selectedAfterArrowDown !== "1" ||
        result.playingAfterSpace !== "1"
      ) {
        fail(
          `Table keyboard navigation failed: focus=${result.tableFocusedAfterClick}, ` +
          `selected=${result.selectedAfterArrowDown}, playing=${result.playingAfterSpace}`
        );
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
