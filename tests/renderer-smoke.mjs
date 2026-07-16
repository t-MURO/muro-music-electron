import { app, BrowserWindow, ipcMain, protocol } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalFileResponse } from "../electron/fileProtocol.mjs";

protocol.registerSchemesAsPrivileged([{
  scheme: "muro-file",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
  },
}]);

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const rendererSmokeUrl = process.env.MURO_RENDERER_SMOKE_URL?.trim() || null;
const expectDevSettings = process.env.MURO_RENDERER_SMOKE_EXPECT_DEV === "1";
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-renderer-smoke-"));
const writeSilentWave = (filePath, durationSeconds = 5) => {
  const sampleRate = 8_000;
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
  bpm: index === 1 ? 0 : 120 + (index % 8),
  rating: 0,
  source_path: path.join(temporaryDirectory, `track-${index}.wav`),
  play_count: 0,
}));
const smokeArtistProfile = {
  artistKey: "muro",
  requestedName: "Muro",
  name: "Muro",
  status: "ready",
  type: "Person",
  country: "DE",
  area: "Berlin",
  begin: "1990",
  ended: false,
  genres: ["electronic", "house"],
  description: "Electronic musician",
  biography: "Muro is an electronic musician used by the renderer smoke test.",
  imagePath: null,
  imageUrl: null,
  musicBrainzId: "11111111-1111-4111-8111-111111111111",
  musicBrainzUrl: "https://musicbrainz.org/artist/11111111-1111-4111-8111-111111111111",
  wikipediaUrl: "https://en.wikipedia.org/wiki/Muro_(musician)",
  theAudioDbId: "654321",
  theAudioDbUrl: "https://www.theaudiodb.com/artist/654321",
  fanartUrl: "https://fanart.tv/artist/11111111-1111-4111-8111-111111111111/",
  fetchedAt: "2026-07-15T12:00:00.000Z",
  cacheState: "fresh",
};
let artistProfileScanCount = 0;
for (let index = 0; index < 5; index += 1) {
  writeSilentWave(smokeTracks[index].source_path);
}

app.setPath("userData", temporaryDirectory);

const fail = (message) => {
  console.error(message);
  app.exit(1);
};

const timeout = setTimeout(() => fail("Renderer smoke test timed out"), 25_000);

app.whenReady().then(async () => {
  protocol.handle("muro-file", (request) => {
    const url = new URL(request.url);
    return createLocalFileResponse(request, decodeURIComponent(url.pathname.slice(1)));
  });
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
  ipcMain.handle("muro:invoke", (event, command, args = {}) => {
    if (command === "load_tracks") return { library: smokeTracks, inbox: [] };
    if (command === "load_playlists") return {
      playlists: [{
        id: "smoke-playlist",
        name: "Smoke Playlist",
        folder_id: "smoke-folder",
        track_ids: smokeTracks.map((track) => track.id),
      }],
      folders: [{ id: "smoke-folder", name: "Smoke Sets" }],
    };
    if (command === "load_recently_played") return [];
    if (command === "load_cached_artist_profiles") return [smokeArtistProfile];
    if (command === "get_artist_profile") return smokeArtistProfile;
    if (command === "scan_artist_profiles") {
      artistProfileScanCount += 1;
      return { checked: 0, updated: 0, failed: 0, queued: 0, remaining: 0, totalArtists: 1 };
    }
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
    if (command === "playback_toggle") return false;
    if (command === "test_emit_media_control") {
      event.sender.send("muro:event", "muro://media-control", args.payload ?? args.action);
      return undefined;
    }
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

  if (rendererSmokeUrl) await window.loadURL(rendererSmokeUrl);
  else await window.loadFile(path.join(appRoot, "dist", "index.html"));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const expectDevSettings = ${JSON.stringify(expectDevSettings)};
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
      const historyBackInitiallyDisabled = Boolean(
        document.querySelector("[data-history-back]")?.disabled
      );
      const historyForwardInitiallyDisabled = Boolean(
        document.querySelector("[data-history-forward]")?.disabled
      );
      const playlistTransferControlsReady = Boolean(
        document.querySelector('[data-playlist-import]') &&
        document.querySelector('[data-playlist-folder-create]')
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
        const selectionBarReady = Boolean(
          document.querySelector('[data-selection-bar]') &&
          document.querySelector('[data-selection-play-next]') &&
          document.querySelector('[data-selection-analyze]') &&
          document.querySelector('[data-selection-edit]') &&
          document.querySelector('[data-selection-delete]')
        );
        const rowThumbnailReady = Boolean(
          firstTrackRow?.querySelector('[data-track-thumbnail]') &&
          document.querySelector('[aria-label="Select all tracks"]')
        );
        const selectedTrackRow = scroller.querySelector('[data-track-selected="true"]');
        const selectedRowColor = selectedTrackRow
          ? getComputedStyle(selectedTrackRow).backgroundColor
          : "";
        const selectedRowUsesGreyHighlight = selectedRowColor.startsWith("rgba(148, 163, 184,");
        const keyColumnColorReady = selectedTrackRow
          ?.querySelector('[data-track-key-color]')
          ?.getAttribute('data-track-key-color') === "#E9AEE1";
        scroller.dispatchEvent(new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 60));
        const playingTrackRow = scroller.querySelector('[data-track-playing="true"]');
        const playingAfterSpace = playingTrackRow?.getAttribute("data-track-index");
        const playingRowColor = playingTrackRow
          ? getComputedStyle(playingTrackRow).backgroundColor
          : "";
        const playingRowUsesRedHighlight = playingRowColor.startsWith("rgba(239, 51, 64,");
        const mediaSessionPlayingReady = Boolean(
          navigator.mediaSession?.metadata?.title === "Smoke Track 001" &&
          navigator.mediaSession.playbackState === "playing"
        );
        scroller.dispatchEvent(new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 60));
        const pausedAfterSecondSpace = document.querySelector(".player-bar-play-button")
          ?.getAttribute("title") === "Play";
        const pausedRowColor = playingTrackRow
          ? getComputedStyle(playingTrackRow).backgroundColor
          : "";
        const pausedRowUsesGreyHighlight = pausedRowColor.startsWith("rgba(148, 163, 184,");
        const mediaSessionPausedReady = navigator.mediaSession?.playbackState === "paused";
        await window.muro.invoke("test_emit_media_control", { action: "next" });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const mediaNextTrackIndex = scroller.querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        await window.muro.invoke("test_emit_media_control", { action: "previous" });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const mediaPreviousTrackIndex = scroller.querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "next", source: "global-shortcut" },
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "toggle", source: "global-shortcut" },
        });
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "pause", source: "media-session" },
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const mediaPausedAfterSkip = Boolean(
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "2" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Play"
        );
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "next", source: "global-shortcut" },
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
        const mediaNextAfterPauseIndex = scroller.querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "toggle", source: "global-shortcut" },
        });
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "pause", source: "media-session" },
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "toggle", source: "global-shortcut" },
        });
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "play", source: "media-session" },
        });
        await new Promise((resolve) => setTimeout(resolve, 350));
        const mediaResumeTrackIndex = scroller.querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        const mediaResumeButtonTitle = document.querySelector(".player-bar-play-button")
          ?.getAttribute("title");
        const mediaResumePlaybackState = navigator.mediaSession?.playbackState;
        const mediaResumeNotifications = Array.from(
          document.querySelectorAll(".fixed.bottom-4.right-4 p"),
          (node) => node.textContent?.trim(),
        );
        const mediaResumedAfterPause = Boolean(
          mediaResumeTrackIndex === "3" &&
          mediaResumeButtonTitle === "Pause" &&
          mediaResumePlaybackState === "playing"
        );
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "previous", source: "global-shortcut" },
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "previous", source: "global-shortcut" },
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
        const mediaPreviousAfterResumeIndex = scroller
          .querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        document.querySelector('[data-panel-view="mix"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const mixSuggestions = Array.from(document.querySelectorAll('[data-mix-suggestion]'));
        const mixSuggestionCount = mixSuggestions.length;
        const firstMixReason = mixSuggestions[0]?.getAttribute("data-mix-reason");
        const mixFiltersReady = Boolean(
          document.querySelector('[data-mix-filter-bpm]') &&
          document.querySelector('[data-mix-filter-rating]') &&
          document.querySelector('[data-mix-filter-genre]') &&
          document.querySelector('[data-mix-sort]')
        );
        const bpmFilter = document.querySelector('[data-mix-filter-bpm]');
        const unknownBpmFallbackReady =
          bpmFilter instanceof HTMLSelectElement &&
          bpmFilter.value === "any" &&
          mixSuggestionCount > 0;
        const mixScoresReady = mixSuggestions.length > 0 && mixSuggestions.every(
          (suggestion) => Number(suggestion.getAttribute("data-mix-score")) > 0
        );
        const mixExpandButton = document.querySelector('[data-mix-expand]');
        mixExpandButton?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const appGrid = document.querySelector('[style*="--queue-width"]');
        const expandedQueueWidth = appGrid
          ? parseFloat(getComputedStyle(appGrid).getPropertyValue("--queue-width"))
          : 0;
        const mixExpanded = expandedQueueWidth >= 480;
        document.querySelector('[data-mix-expand]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const camelotSegmentCount = document.querySelectorAll('[data-camelot-code]').length;
        const compatibleCamelotCount = document.querySelectorAll('[data-camelot-compatible="true"]').length;
        const camelotColorsReady =
          document.querySelector('[data-camelot-code="10A"]')?.getAttribute('data-camelot-fill') === "#BFCDFF" &&
          document.querySelector('[data-camelot-code="10B"]')?.getAttribute('data-camelot-fill') === "#9AADFF";
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
        const playlistFolderReady = Boolean(
          document.querySelector('[data-playlist-folder="smoke-folder"]') &&
          document.querySelector('[data-playlist-folder-parent="smoke-folder"]')
        );
        const nestedPlaylist = document.querySelector('[data-playlist-folder-parent="smoke-folder"]');
        nestedPlaylist?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 180,
          clientY: 220,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const playlistMenuTexts = Array.from(
          document.querySelectorAll('[data-popover]'),
          (node) => node.textContent ?? "",
        );
        const playlistExportMoveMenuReady = playlistMenuTexts.some((text) =>
          text.includes("Export playlist") &&
          text.includes("Move to") &&
          text.includes("Playlists")
        );
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 180));
        window.location.hash = "#/playlists/smoke-playlist";
        await new Promise((resolve) => setTimeout(resolve, 60));
        const playlistRemoveReady = Boolean(document.querySelector('[data-remove-from-playlist]'));
        window.location.hash = "#/settings";
        await new Promise((resolve) => setTimeout(resolve, 60));
        document.querySelector('[data-settings-tab="application"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const theAudioDbApiKeyInput = document.querySelector("[data-theaudiodb-api-key]");
        const fanartApiKeyInput = document.querySelector("[data-fanart-api-key]");
        const artistInformationSettingsReady = Boolean(
          document.querySelector("[data-artist-information-settings]") &&
          theAudioDbApiKeyInput instanceof HTMLInputElement &&
          theAudioDbApiKeyInput.type === "password" &&
          fanartApiKeyInput instanceof HTMLInputElement &&
          fanartApiKeyInput.type === "password"
        );
        let djMixFeatureGateReady = false;
        if (expectDevSettings) {
          document.querySelector('[data-settings-tab="dev"]')?.click();
          await new Promise((resolve) => setTimeout(resolve, 60));
          const featureToggle = document.querySelector("[data-dj-mix-feature-toggle]");
          const defaultOff = featureToggle instanceof HTMLInputElement && !featureToggle.checked;
          featureToggle?.click();
          await new Promise((resolve) => setTimeout(resolve, 60));
          const mixBars = document.querySelector("[data-mix-bars]");
          const mixBarOptions = mixBars instanceof HTMLSelectElement
            ? Array.from(mixBars.options, (option) => Number(option.value))
            : [];
          djMixFeatureGateReady =
            defaultOff &&
            Boolean(document.querySelector("[data-dj-mix-settings]")) &&
            mixBarOptions.join(",") === "4,8,16,32";
        } else {
          djMixFeatureGateReady =
            !document.querySelector("[data-dj-mix-feature-toggle]") &&
            !document.querySelector("[data-dj-mix-settings]");
        }
        window.location.hash = "#/";
        await new Promise((resolve) => setTimeout(resolve, 100));
        const mixRows = document.querySelectorAll('[data-track-index]');
        mixRows[0]?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        mixRows[1]?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const djMixManualSurfaceReady = expectDevSettings
          ? Boolean(document.querySelector("[data-selection-mix]"))
          : !document.querySelector("[data-selection-mix]");
        document.querySelector('[data-panel-view="mix"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const mixWithCurrentButtons = Array.from(
          document.querySelectorAll("[data-mix-with-current]"),
        );
        const mixWithCurrentActionReady = expectDevSettings
          ? mixWithCurrentButtons.length > 0 && mixWithCurrentButtons.every(
            (button) => button instanceof HTMLButtonElement
              && !button.disabled
              && button.textContent?.includes("Mix"),
          )
          : mixWithCurrentButtons.length === 0;
        document.querySelector('[data-panel-view="queue"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 40));
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
        const historyBackButton = document.querySelector("[data-history-back]");
        const historyForwardButton = document.querySelector("[data-history-forward]");
        const historyButtonsReady = Boolean(historyBackButton && historyForwardButton);
        const historyBackEnabled = historyBackButton instanceof HTMLButtonElement && !historyBackButton.disabled;
        historyBackButton?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const historyBackReachedAlbumDetail = Boolean(document.querySelector("[data-album-detail]"));
        const historyForwardEnabledAfterBack =
          historyForwardButton instanceof HTMLButtonElement && !historyForwardButton.disabled;
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowRight",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const keyboardForwardReachedAlbumList = Boolean(document.querySelector(".album-collection--list"));
        window.dispatchEvent(new MouseEvent("mouseup", {
          button: 3,
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const mouseBackReachedAlbumDetail = Boolean(document.querySelector("[data-album-detail]"));
        window.dispatchEvent(new MouseEvent("mouseup", {
          button: 4,
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const mouseForwardReachedAlbumList = Boolean(document.querySelector(".album-collection--list"));
        document.querySelector(".album-card-open")?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const albumMetadataLinksReady = Boolean(
          document.querySelector("[data-album-artist]") &&
          document.querySelector("[data-album-genre]")
        );
        document.querySelector("[data-album-artist]")?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const albumArtistNavigationReady =
          window.location.hash.includes("/collection/artists") &&
          window.location.hash.includes("value=Muro") &&
          document.querySelector("h2")?.textContent?.trim() === "Muro";
        const albumArtistProfileReady = Boolean(
          document.querySelector('[data-artist-detail="Muro"][data-artist-status="ready"]') &&
          document.querySelector(".artist-detail-biography")?.textContent?.includes("renderer smoke test") &&
          document.querySelector(".artist-detail-sources")?.textContent?.includes("TheAudioDB") &&
          document.querySelector(".artist-detail-sources")?.textContent?.includes("Fanart.tv")
        );

        window.location.hash = "#/collection/artists";
        await new Promise((resolve) => setTimeout(resolve, 100));
        const artistCards = document.querySelectorAll("[data-artist-card]");
        const artistCard = document.querySelector('[data-artist-card="Muro"]');
        const artistIndexReady =
          Boolean(document.querySelector("[data-artist-index]")) &&
          artistCards.length === 1 &&
          artistCard?.getAttribute("data-artist-profile-cached") === "true" &&
          artistCard?.textContent?.includes("250 tracks") &&
          artistCard?.textContent?.includes("25 albums");
        artistCard?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const artistDetailReady = Boolean(
          document.querySelector('[data-artist-detail="Muro"][data-artist-status="ready"]') &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "250"
        );

        window.location.hash = "#/collection/genres";
        await new Promise((resolve) => setTimeout(resolve, 100));
        const genreItems = document.querySelectorAll('[data-collection-index="genres"] [data-collection-value]');
        const electronicGenre = document.querySelector('[data-collection-value="Electronic"]');
        const houseGenre = document.querySelector('[data-collection-value="House"]');
        const genreIndexReady =
          genreItems.length === 2 &&
          electronicGenre?.getAttribute("data-collection-count") === "125" &&
          houseGenre?.getAttribute("data-collection-count") === "125";
        electronicGenre?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const genreDrilldownReady =
          window.location.hash.includes("/collection/genres") &&
          window.location.hash.includes("value=Electronic") &&
          document.querySelector("h2")?.textContent?.trim() === "Electronic" &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "125";
        window.history.back();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const genreHistoryReady = Boolean(document.querySelector('[data-collection-index="genres"]'));

        window.location.hash = "#/collection/keys";
        await new Promise((resolve) => setTimeout(resolve, 100));
        const keyItems = document.querySelectorAll('[data-collection-index="keys"] [data-collection-value]');
        const camelot8A = document.querySelector('[data-collection-index="keys"] [data-collection-value="8A"]');
        const keyIndexReady =
          keyItems.length === 5 &&
          camelot8A?.getAttribute("data-collection-count") === "84" &&
          camelot8A?.getAttribute("data-collection-color") === "#E9AEE1";
        camelot8A?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const keyDrilldownReady =
          window.location.hash.includes("/collection/keys") &&
          window.location.hash.includes("value=8A") &&
          document.querySelector("h2")?.textContent?.trim() === "8A" &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "84";
        const removedCollectionLinksReady =
          !document.querySelector('[data-collection-facet="bpm"]') &&
          !document.querySelector('[data-collection-facet="formats"]');

        document.querySelector('[data-smart-crate-create]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const smartCrateModalReady = Boolean(
          document.querySelector('[data-smart-crate-modal]') &&
          document.querySelector('[data-smart-crate-rule]') &&
          document.querySelector('[data-smart-crate-add-rule]')
        );
        const smartCrateName = document.querySelector('[data-smart-crate-name]');
        if (smartCrateName instanceof HTMLInputElement) {
          const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          valueSetter?.call(smartCrateName, "Warm-up House");
          smartCrateName.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
        document.querySelector('[data-smart-crate-save]')?.click();
        await new Promise((resolve) => setTimeout(resolve, expectDevSettings ? 300 : 100));
        const smartCrateItem = document.querySelector('[data-smart-crate-id]');
        const smartCrateCreated = Boolean(
          smartCrateItem &&
          window.location.hash.includes("/smart-crates/") &&
          document.querySelector("h2")?.textContent?.trim() === "Warm-up House"
        );
        const smartCrateMatchedTracks = Number(
          smartCrateItem?.querySelector(".sidebar-count")?.textContent?.replace(/[^0-9]/g, "") ?? 0
        );
        let persistedSmartCrateCount = 0;
        try {
          persistedSmartCrateCount = JSON.parse(localStorage.getItem("muro-smart-crates") ?? "null")
            ?.state?.smartCrates?.length ?? 0;
        } catch {}
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
          playlistFolderReady,
          playlistTransferControlsReady,
          playlistExportMoveMenuReady,
          windowChromeReady: Boolean(windowChrome && windowBrand && windowControls),
          windowChromeDragRegion: windowChrome
            ? getComputedStyle(windowChrome).getPropertyValue("-webkit-app-region")
            : "",
          historyBackInitiallyDisabled,
          historyForwardInitiallyDisabled,
          tableFocusedAfterClick,
          selectedAfterArrowDown,
          selectionBarReady,
          rowThumbnailReady,
          selectedRowUsesGreyHighlight,
          keyColumnColorReady,
          playingRowUsesRedHighlight,
          playingAfterSpace,
          pausedAfterSecondSpace,
          pausedRowUsesGreyHighlight,
          mediaSessionPlayingReady,
          mediaSessionPausedReady,
          mediaNextTrackIndex,
          mediaPreviousTrackIndex,
          mediaPausedAfterSkip,
          mediaNextAfterPauseIndex,
          mediaResumedAfterPause,
          mediaResumeTrackIndex,
          mediaResumeButtonTitle,
          mediaResumePlaybackState,
          mediaResumeNotifications,
          mediaPreviousAfterResumeIndex,
          mixSuggestionCount,
          firstMixReason,
          mixFiltersReady,
          unknownBpmFallbackReady,
          mixScoresReady,
          mixExpanded,
          camelotSegmentCount,
          compatibleCamelotCount,
          camelotColorsReady,
          currentCamelotCode,
          selectedCamelotCode,
          wheelFilteredTo9A,
          queuedFromMix,
          artistInformationSettingsReady,
          djMixFeatureGateReady,
          djMixManualSurfaceReady,
          mixWithCurrentActionReady,
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
          historyButtonsReady,
          historyBackEnabled,
          historyBackReachedAlbumDetail,
          historyForwardEnabledAfterBack,
          keyboardForwardReachedAlbumList,
          mouseBackReachedAlbumDetail,
          mouseForwardReachedAlbumList,
          albumMetadataLinksReady,
          albumArtistNavigationReady,
          albumArtistProfileReady,
          artistIndexReady,
          artistDetailReady,
          genreIndexReady,
          genreDrilldownReady,
          genreHistoryReady,
          keyIndexReady,
          keyDrilldownReady,
          removedCollectionLinksReady,
          smartCrateModalReady,
          smartCrateCreated,
          smartCrateMatchedTracks,
          persistedSmartCrateCount,
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
        !result.mixFiltersReady ||
        !result.unknownBpmFallbackReady ||
        !result.mixScoresReady ||
        !result.mixExpanded ||
        !result.queuedFromMix
      ) {
        fail(
          `Camelot suggestions failed: count=${result.mixSuggestionCount}, ` +
          `reason=${result.firstMixReason}, filters=${result.mixFiltersReady}, ` +
          `unknownBpmFallback=${result.unknownBpmFallbackReady}, ` +
          `scores=${result.mixScoresReady}, expanded=${result.mixExpanded}, queued=${result.queuedFromMix}`
        );
        return;
      }
      if (
        !result.rowThumbnailReady ||
        !result.selectedRowUsesGreyHighlight ||
        !result.playingRowUsesRedHighlight
      ) {
        fail(
          `Track row selection UI failed: thumbnail=${result.rowThumbnailReady}, ` +
          `selectedGrey=${result.selectedRowUsesGreyHighlight}, ` +
          `playingRed=${result.playingRowUsesRedHighlight}`
        );
        return;
      }
      if (!result.pausedAfterSecondSpace || !result.pausedRowUsesGreyHighlight) {
        fail(
          `Pressing Space again did not pause cleanly: ` +
          `paused=${result.pausedAfterSecondSpace}, greyRow=${result.pausedRowUsesGreyHighlight}`
        );
        return;
      }
      if (!result.mediaSessionPlayingReady || !result.mediaSessionPausedReady) {
        fail(
          `Media Session integration failed: ` +
          `playing=${result.mediaSessionPlayingReady}, paused=${result.mediaSessionPausedReady}`
        );
        return;
      }
      if (result.mediaNextTrackIndex !== "2" || result.mediaPreviousTrackIndex !== "1") {
        fail(
          `Media next/previous failed: next=${result.mediaNextTrackIndex}, ` +
          `previous=${result.mediaPreviousTrackIndex}`
        );
        return;
      }
      if (
        !result.mediaPausedAfterSkip ||
        result.mediaNextAfterPauseIndex !== "3" ||
        !result.mediaResumedAfterPause ||
        result.mediaPreviousAfterResumeIndex !== "1"
      ) {
        fail(
          `Media controls failed after skip/pause: paused=${result.mediaPausedAfterSkip}, ` +
          `next=${result.mediaNextAfterPauseIndex}, resumed=${result.mediaResumedAfterPause}, ` +
          `track=${result.mediaResumeTrackIndex}, button=${result.mediaResumeButtonTitle}, ` +
          `state=${result.mediaResumePlaybackState}, previous=${result.mediaPreviousAfterResumeIndex}, ` +
          `notifications=${result.mediaResumeNotifications}`
        );
        return;
      }
      if (!result.keyColumnColorReady || !result.camelotColorsReady) {
        fail(
          `Camelot colors failed: column=${result.keyColumnColorReady}, ` +
          `wheel=${result.camelotColorsReady}`
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
      if (!result.artistInformationSettingsReady) {
        fail("Artist information provider settings are not visible in the Application settings tab");
        return;
      }
      if (!result.djMixFeatureGateReady) {
        fail("Experimental DJ mix feature-gate settings failed");
        return;
      }
      if (!result.djMixManualSurfaceReady) {
        fail("Experimental DJ mix selection controls ignored the feature gate");
        return;
      }
      if (!result.mixWithCurrentActionReady) {
        fail("Mix Next did not expose the current-track mix action behind the feature gate");
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
      if (
        !result.playlistFolderReady ||
        !result.playlistTransferControlsReady ||
        !result.playlistExportMoveMenuReady
      ) {
        fail(
          `Playlist organization failed: folder=${result.playlistFolderReady}, ` +
          `controls=${result.playlistTransferControlsReady}, menu=${result.playlistExportMoveMenuReady}`
        );
        return;
      }
      if (
        !result.genreIndexReady ||
        !result.genreDrilldownReady ||
        !result.genreHistoryReady ||
        !result.keyIndexReady ||
        !result.keyDrilldownReady ||
        !result.removedCollectionLinksReady
      ) {
        fail(
          `Collection indexes failed: genres=${result.genreIndexReady}, ` +
          `genreDrilldown=${result.genreDrilldownReady}, genreHistory=${result.genreHistoryReady}, ` +
          `keys=${result.keyIndexReady}, keyDrilldown=${result.keyDrilldownReady}, ` +
          `removedLinks=${result.removedCollectionLinksReady}`
        );
        return;
      }
      if (!result.windowChromeReady || result.windowChromeDragRegion !== "drag") {
        fail("Custom window chrome is missing or is not draggable");
        return;
      }
      if (!result.historyBackInitiallyDisabled || !result.historyForwardInitiallyDisabled) {
        fail("Navigation history controls were not disabled at the initial history boundary");
        return;
      }
      if (
        !result.historyButtonsReady ||
        !result.historyBackEnabled ||
        !result.historyBackReachedAlbumDetail ||
        !result.historyForwardEnabledAfterBack ||
        !result.keyboardForwardReachedAlbumList ||
        !result.mouseBackReachedAlbumDetail ||
        !result.mouseForwardReachedAlbumList
      ) {
        fail(
          `Navigation history failed: buttons=${result.historyButtonsReady}, ` +
          `backEnabled=${result.historyBackEnabled}, back=${result.historyBackReachedAlbumDetail}, ` +
          `forwardEnabled=${result.historyForwardEnabledAfterBack}, ` +
          `keyboardForward=${result.keyboardForwardReachedAlbumList}, ` +
          `mouseBack=${result.mouseBackReachedAlbumDetail}, mouseForward=${result.mouseForwardReachedAlbumList}`
        );
        return;
      }
      if (
        !result.tableFocusedAfterClick ||
        result.selectedAfterArrowDown !== "1" ||
        !result.selectionBarReady ||
        result.playingAfterSpace !== "1"
      ) {
        fail(
          `Table keyboard navigation failed: focus=${result.tableFocusedAfterClick}, ` +
          `selected=${result.selectedAfterArrowDown}, selectionBar=${result.selectionBarReady}, ` +
          `playing=${result.playingAfterSpace}`
        );
        return;
      }
      if (!result.albumMetadataLinksReady || !result.albumArtistNavigationReady) {
        fail(
          `Album metadata navigation failed: links=${result.albumMetadataLinksReady}, ` +
          `artist=${result.albumArtistNavigationReady}`
        );
        return;
      }
      if (!result.albumArtistProfileReady || !result.artistIndexReady || !result.artistDetailReady) {
        fail(
          `Artist profiles failed: albumLink=${result.albumArtistProfileReady}, ` +
          `index=${result.artistIndexReady}, detail=${result.artistDetailReady}`
        );
        return;
      }
      if (
        !result.smartCrateModalReady ||
        !result.smartCrateCreated ||
        result.smartCrateMatchedTracks <= 0 ||
        result.persistedSmartCrateCount !== 1
      ) {
        fail(
          `Smart Crate failed: modal=${result.smartCrateModalReady}, ` +
          `created=${result.smartCrateCreated}, matches=${result.smartCrateMatchedTracks}, ` +
          `persisted=${result.persistedSmartCrateCount}`
        );
        return;
      }
      if (artistProfileScanCount < 1) {
        fail("Periodic artist profile scan did not start");
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
