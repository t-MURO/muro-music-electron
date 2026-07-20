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
    corsEnabled: true,
  },
}]);

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const rendererSmokeUrl = process.env.MURO_RENDERER_SMOKE_URL?.trim() || null;
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
  sample_rate_hz: 44_100,
  bit_depth: 24,
  file_size_bytes: 10 * 1024 * 1024,
  key: ["8A", "8A", "9A", "7A", "8B", "2B"][index % 6],
  bpm: index === 1 ? 0 : 120 + (index % 8),
  rating: 0,
  comment: `Smoke comment ${index}`,
  disc_number: (index % 2) + 1,
  last_played_at: `2026-07-${String((index % 19) + 1).padStart(2, "0")}T18:30:00.000Z`,
  source_path: path.join(temporaryDirectory, `track-${index}.wav`),
  play_count: index,
}));
const smokeArtistProfile = {
  profileVersion: 2,
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
  imageProvider: "wikimedia-commons",
  imageAttribution: "Smoke Photographer",
  imageLicense: "CC BY-SA 4.0",
  wikimediaCommonsUrl: "https://commons.wikimedia.org/wiki/File:Muro_artist_portrait.jpg",
  musicBrainzId: "11111111-1111-4111-8111-111111111111",
  musicBrainzUrl: "https://musicbrainz.org/artist/11111111-1111-4111-8111-111111111111",
  wikipediaUrl: "https://en.wikipedia.org/wiki/Muro_(musician)",
  lastFmAttempted: true,
  lastFmUrl: "https://www.last.fm/music/Muro",
  similarArtists: [{
    name: "Similar Muro",
    musicBrainzId: "55555555-5555-4555-8555-555555555555",
    url: "https://www.last.fm/music/Similar+Muro",
  }],
  theAudioDbId: "654321",
  theAudioDbUrl: "https://www.theaudiodb.com/artist/654321",
  fanartUrl: "https://fanart.tv/artist/11111111-1111-4111-8111-111111111111/",
  fetchedAt: "2026-07-15T12:00:00.000Z",
  cacheState: "fresh",
};
let artistProfileScanCount = 0;
let manualCoverFetchCount = 0;
let artistImageSaveCount = 0;
const shownItemPaths = [];
const ratingUpdates = [];
for (let index = 0; index < 5; index += 1) {
  writeSilentWave(smokeTracks[index].source_path);
}

app.setPath("userData", temporaryDirectory);

const fail = (message) => {
  console.error(message);
  app.exit(1);
};

const timeout = setTimeout(() => fail("Renderer smoke test timed out"), 60_000);

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
  ipcMain.handle("muro:show-item-in-folder", (_event, filePath) => {
    shownItemPaths.push(filePath);
  });
  ipcMain.handle("muro:invoke", (event, command, args = {}) => {
    if (command === "load_tracks") return { library: smokeTracks, inbox: [] };
    if (command === "load_playlists") return {
      playlists: [
        {
          id: "smoke-playlist",
          name: "Smoke Playlist",
          folder_id: "smoke-folder",
          sort_order: 0,
          track_ids: smokeTracks.map((track) => track.id),
        },
        {
          id: "smoke-empty-playlist",
          name: "Empty Mix",
          folder_id: null,
          sort_order: 0,
          track_ids: [],
        },
        {
          id: "smoke-drag-playlist",
          name: "Drag Target",
          folder_id: null,
          sort_order: 1,
          track_ids: [],
        },
        {
          id: "smoke-next-playlist",
          name: "Next Context",
          folder_id: null,
          sort_order: 2,
          track_ids: ["smoke-track-0", "smoke-track-10", "smoke-track-20"],
        },
        {
          id: "smoke-nested-playlist",
          name: "Nested Playlist",
          folder_id: "smoke-nested-folder",
          sort_order: 0,
          track_ids: [],
        },
      ],
      folders: [
        {
          id: "smoke-folder",
          name: "Smoke Sets",
          parent_id: null,
          sort_order: 0,
        },
        {
          id: "smoke-nested-folder",
          name: "Nested Sets",
          parent_id: "smoke-folder",
          sort_order: 0,
        },
      ],
    };
    if (command === "load_recently_played") return [];
    if (command === "load_cached_artist_profiles") return [smokeArtistProfile];
    if (command === "get_artist_profile") return smokeArtistProfile;
    if (command === "search_artist_images") return [
      {
        id: "commons-current",
        provider: "wikimedia-commons",
        imageUrl: "https://upload.wikimedia.org/muro-commons.jpg",
        sourceUrl: smokeArtistProfile.wikimediaCommonsUrl,
        attribution: "Smoke Photographer",
        license: "CC BY-SA 4.0",
        current: true,
      },
      {
        id: "fanart-alternate",
        provider: "fanart.tv",
        imageUrl: "https://assets.fanart.tv/muro-alternate.jpg",
        sourceUrl: smokeArtistProfile.fanartUrl,
        attribution: "Fanart.tv contributor",
        width: 1000,
        height: 1000,
      },
    ];
    if (command === "set_artist_image") {
      artistImageSaveCount += 1;
      return {
        ...smokeArtistProfile,
        imagePath: path.join(appRoot, "src", "assets", "app-logo.png"),
        imageUrl: args.candidate?.imageUrl ?? null,
        imageProvider: args.candidate?.provider ?? null,
        imageAttribution: args.candidate?.attribution ?? null,
        imageLicense: args.candidate?.license ?? null,
        imageSelection: "manual",
      };
    }
    if (command === "scan_artist_profiles") {
      artistProfileScanCount += 1;
      return { checked: 0, updated: 0, failed: 0, queued: 0, remaining: 0, totalArtists: 1 };
    }
    if (command === "fetch_track_cover_art") {
      manualCoverFetchCount += 1;
      return {
        fullPath: smokeTracks[0].source_path,
        thumbPath: smokeTracks[0].source_path,
        sourceUrl: "https://coverartarchive.org/release/smoke/front",
      };
    }
    if (command === "search_track_metadata") {
      return [{
        id: "smoke-recording:smoke-release",
        score: 100,
        recordingId: "99999999-9999-4999-8999-999999999999",
        releaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        releaseGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Smoke Track Zero",
        artist: "Muro",
        album: "Smoke Album 00",
        albumArtist: "Muro",
        year: 2000,
        country: "DE",
        status: "Official",
        genre: "House",
        albumMatch: true,
      }];
    }
    if (command === "search_album_metadata") {
      return [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        score: 100,
        title: "Smoke Album 00",
        artist: "Muro",
        releaseGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        year: 2000,
        country: "DE",
        status: "Official",
        barcode: "1234567890123",
        trackCount: 10,
        disambiguation: null,
      }];
    }
    if (command === "load_album_metadata") {
      return {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Smoke Album 00",
        artist: "Muro",
        releaseGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        year: 2000,
        country: "DE",
        status: "Official",
        label: "Smoke Label",
        genre: "Electronic",
        discTotal: 1,
        tracks: smokeTracks.slice(0, 10).map((track, index) => ({
          id: `release-track-${index}`,
          recordingId: `recording-${index}`,
          title: track.title,
          artist: track.artist,
          trackNumber: index + 1,
          trackTotal: 10,
          discNumber: 1,
          discTotal: 1,
        })),
      };
    }
    if (command === "test_get_cover_counts") {
      return { manualCoverFetchCount, artistImageSaveCount };
    }
    if (command === "scan_technical_metadata") {
      return { checked: 0, updated: 0, failed: 0, remaining: 0 };
    }
    if (command === "reorder_playlists" || command === "delete_playlist") return undefined;
    if (command === "update_track_metadata") {
      ratingUpdates.push(args);
      return undefined;
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
    if (command === "add_tracks_to_playlist") return undefined;
    if (command === "test_emit_media_control") {
      event.sender.send("muro:event", "muro://media-control", args.payload ?? args.action);
      return undefined;
    }
    if (command === "test_emit_transition_state") {
      event.sender.send("muro:event", "muro://transition-state", args);
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
      const root = document.getElementById("root");
      const selectAll = document.querySelector('[aria-label="Select all tracks"]');
      const scroller = document.querySelector('[data-track-table-scroll]');
      const headerScroller = document.querySelector('[data-track-table-header-scroll]');
      const searchShortcutHint = document.querySelector('[data-search-shortcut-hint]');
      const appShellGrid = document.querySelector('[data-app-shell-grid]');
      const appShellTransition = appShellGrid ? getComputedStyle(appShellGrid) : null;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const sidebarAnimationReady = Boolean(
        appShellTransition && (
          reducedMotion
            ? appShellTransition.transitionDuration === "0s"
            : appShellTransition.transitionProperty.includes("grid-template-columns") &&
              appShellTransition.transitionDuration !== "0s"
        )
      );
      const sidebarResizeHandle = document.querySelector('[role="separator"]');
      sidebarResizeHandle?.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 200,
      }));
      const resizeTransitionDisabled = Boolean(
        document.documentElement.dataset.panelResizing === "true" &&
        appShellGrid &&
        getComputedStyle(appShellGrid).transitionDuration === "0s"
      );
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      const libraryHeader = document.querySelector('.library-command-bar');
      const libraryHeaderButtons = [...(libraryHeader?.querySelectorAll('button') ?? [])];
      const libraryTitleRegionReady = (
        libraryHeader?.querySelector('[data-library-title]')?.getBoundingClientRect().width ?? 0
      ) >= (window.innerWidth <= 1180 ? 110 : 240);
      const libraryHeaderControlsReady = Boolean(
        libraryHeader?.querySelector('[data-library-columns]') &&
        libraryHeader?.querySelector('[title="Toggle compact table"]') &&
        !libraryHeader?.querySelector('[title="Filter the current library view"]') &&
        !libraryHeader?.querySelector('[title="Cycle title sorting"]') &&
        !libraryHeaderButtons.some((button) => button.textContent?.trim() === "Add Music")
      );
      const compactTableButton = libraryHeader?.querySelector('[title="Toggle compact table"]');
      compactTableButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const compactFirstRow = scroller?.querySelector('[data-track-index="0"]');
      const compactSecondRow = scroller?.querySelector('[data-track-index="1"]');
      const compactFirstRect = compactFirstRow?.getBoundingClientRect();
      const compactSecondRect = compactSecondRow?.getBoundingClientRect();
      const compactRowHeight = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--table-row-height')
      );
      const compactRowsAligned = Boolean(
        compactFirstRect &&
        compactSecondRect &&
        Math.abs(compactFirstRect.height - compactRowHeight) < 1 &&
        Math.abs(compactSecondRect.height - compactRowHeight) < 1 &&
        Math.abs(compactSecondRect.top - compactFirstRect.bottom) < 1
      );
      compactTableButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const requestedColumnLabels = [
        "Album Artist",
        "Genre",
        "Play Count",
        "Last Played",
        "File Path",
        "Disc #",
        "Comment",
        "Sample Rate",
        "Bit Depth",
        "File Size",
      ];
      const toggleRequestedColumns = () => {
        const labels = [...document.querySelectorAll('[data-columns-list] label')];
        for (const labelText of requestedColumnLabels) {
          const label = labels.find((item) => item.textContent?.trim() === labelText);
          label?.querySelector('input')?.click();
        }
      };
      libraryHeader?.querySelector('[data-library-columns]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const columnsList = document.querySelector('[data-columns-list]');
      const availableColumnLabels = [
        ...(columnsList?.querySelectorAll('label') ?? []),
      ].map((label) => label.textContent?.trim());
      const requestedColumnsAvailable = requestedColumnLabels.every(
        (label) => availableColumnLabels.includes(label)
      );
      const columnsMenuScrollable = Boolean(
        columnsList &&
        getComputedStyle(columnsList).overflowY === "auto" &&
        columnsList.scrollHeight > columnsList.clientHeight
      );
      toggleRequestedColumns();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 180));
      const firstExtendedRow = scroller?.querySelector('[data-track-index="0"]');
      const requestedColumnValuesReady = Boolean(
        requestedColumnLabels.length === 10 &&
        document.querySelector('[role="columnheader"][data-column-key="artists"]') &&
        document.querySelector('[role="columnheader"][data-column-key="genre"]') &&
        document.querySelector('[role="columnheader"][data-column-key="playCount"]') &&
        document.querySelector('[role="columnheader"][data-column-key="lastPlayedAt"]') &&
        document.querySelector('[role="columnheader"][data-column-key="sourcePath"]') &&
        document.querySelector('[role="columnheader"][data-column-key="discNumber"]') &&
        document.querySelector('[role="columnheader"][data-column-key="comment"]') &&
        document.querySelector('[role="columnheader"][data-column-key="sampleRate"]') &&
        document.querySelector('[role="columnheader"][data-column-key="bitDepth"]') &&
        document.querySelector('[role="columnheader"][data-column-key="fileSize"]') &&
        firstExtendedRow?.querySelector('[data-column-key="artists"]')?.textContent?.trim() === "Muro" &&
        firstExtendedRow?.querySelector('[data-column-key="genre"]')?.textContent?.trim() === "Electronic" &&
        firstExtendedRow?.querySelector('[data-column-key="playCount"]')?.textContent?.trim() === "0" &&
        firstExtendedRow?.querySelector('[data-column-key="lastPlayedAt"]')?.textContent?.includes("2026") &&
        firstExtendedRow?.querySelector('[data-column-key="sourcePath"]')?.textContent?.includes("track-0.wav") &&
        firstExtendedRow?.querySelector('[data-column-key="discNumber"]')?.textContent?.trim() === "1" &&
        firstExtendedRow?.querySelector('[data-column-key="comment"]')?.textContent?.trim() === "Smoke comment 0" &&
        firstExtendedRow?.querySelector('[data-column-key="sampleRate"]')?.textContent?.trim() === "44.1 kHz" &&
        firstExtendedRow?.querySelector('[data-column-key="bitDepth"]')?.textContent?.trim() === "24-bit" &&
        firstExtendedRow?.querySelector('[data-column-key="fileSize"]')?.textContent?.trim() === "10.0 MB"
      );
      libraryHeader?.querySelector('[data-library-columns]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      toggleRequestedColumns();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 180));
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
        document.querySelector('[data-playlist-folder-import]') &&
        document.querySelector('[data-playlist-folder-create]')
      );
      const collectionSection = document.querySelector('[data-sidebar-section="collection"]');
      const playlistSection = document.querySelector('[data-sidebar-section="playlists"]');
      const playlistsUnderCollection = Boolean(
        collectionSection &&
        playlistSection &&
        collectionSection.contains(playlistSection)
      );
      document.querySelector('[aria-label="Collapse queue"]')?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const expandQueueButton = document.querySelector('[aria-label="Expand queue"]');
      const collapsedQueuePanel = expandQueueButton?.closest('aside');
      const collapsedQueueControlsReady = Boolean(
        expandQueueButton &&
        collapsedQueuePanel?.querySelectorAll('button').length === 1 &&
        collapsedQueuePanel?.querySelectorAll('svg').length === 1
      );
      expandQueueButton?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
        firstTrackRow?.querySelector('[data-column-key="album"]')?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 240,
          clientY: 180,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const tableAlbumMetadataMenuReady = Boolean(
          document.querySelector('[data-testid="search-album-metadata-menu-item"]')?.textContent?.includes("Search for album metadata")
        );
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 180));
        const ratingCell = firstTrackRow?.querySelector('[data-rating-cell]');
        const ratingControl = ratingCell?.querySelector('[role="slider"]');
        const thirdRatingStar = ratingCell?.querySelector('[data-rating-star="3"]');
        const ratingCellRect = ratingCell?.getBoundingClientRect();
        const ratingStarRects = [...(ratingCell?.querySelectorAll('[data-rating-star]') ?? [])]
          .map((element) => element.getBoundingClientRect());
        const ratingFitsCell = Boolean(
          ratingCellRect &&
          ratingStarRects.length === 5 &&
          ratingStarRects.every((rect) =>
            rect.left >= ratingCellRect.left && rect.right <= ratingCellRect.right
          )
        );
        const thirdRatingRect = thirdRatingStar?.getBoundingClientRect();
        if (thirdRatingStar && thirdRatingRect) {
          thirdRatingStar.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: thirdRatingRect.right - 1,
          }));
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const ratingSetToThree = ratingControl?.getAttribute("aria-valuenow") === "3";
        if (thirdRatingStar && thirdRatingRect) {
          thirdRatingStar.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: thirdRatingRect.left + 1,
          }));
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const threeStarRatingClearsToZero = ratingControl?.getAttribute("aria-valuenow") === "0";
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
        document.querySelector('[data-selection-edit]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const editCoverField = document.querySelector('[data-cover-art-field]');
        editCoverField?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        const fetchCoverMenuItem = document.querySelector('[data-testid="fetch-cover-art-menu-item"]');
        const manualCoverMenuReady = Boolean(fetchCoverMenuItem);
        fetchCoverMenuItem?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const coverCounts = await window.muro.invoke("test_get_cover_counts");
        const manualCoverFetchReady = Boolean(
          coverCounts.manualCoverFetchCount === 1 &&
          editCoverField?.querySelector("img")
        );
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent?.trim() === "Cancel")
          ?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
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
        const firstMixSuggestionStyle = mixSuggestions[0]
          ? getComputedStyle(mixSuggestions[0])
          : null;
        const firstMixCover = mixSuggestions[0]?.querySelector('[data-mix-suggestion-cover]');
        const firstMixAction = mixSuggestions[0]?.querySelector('[data-mix-suggestion-actions] button');
        const compactMixSuggestionsReady = Boolean(
          firstMixSuggestionStyle &&
          parseFloat(firstMixSuggestionStyle.paddingTop) <= 6 &&
          (firstMixCover?.getBoundingClientRect().height ?? 0) <= 32 &&
          (firstMixAction?.getBoundingClientRect().height ?? 0) <= 24
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
        const playlistDropTargetReady = Boolean(
          document.querySelector('[data-playlist-target="smoke-playlist"]') &&
          document.querySelector('[data-playlist-target="smoke-empty-playlist"]') &&
          document.querySelector('[data-playlist-target="smoke-drag-playlist"]')
        );
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        document.querySelector('[data-testid="add-to-playlist-menu-item"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 40));
        const playlistChoicesReady = Boolean(
          document.querySelector('[data-playlist-choices]') &&
          document.querySelector('[data-playlist-choice="smoke-playlist"]') &&
          document.querySelector('[data-playlist-choice="smoke-empty-playlist"]')
        );
        document.querySelector('[data-playlist-choice="smoke-empty-playlist"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const emptyPlaylistCount = Number(
          document.querySelector('[data-playlist-id="smoke-empty-playlist"] .sidebar-count')
            ?.textContent?.replace(/[^0-9]/g, "") ?? 0
        );
        const contextAddToPlaylistReady = playlistChoicesReady && emptyPlaylistCount > 0;
        const dragPlaylistTarget = document.querySelector(
          '[data-playlist-target="smoke-drag-playlist"]'
        );
        let dragAddToPlaylistReady = false;
        if (firstTrackRow && dragPlaylistTarget) {
          const originalElementFromPoint = document.elementFromPoint.bind(document);
          document.elementFromPoint = () => dragPlaylistTarget;
          firstTrackRow.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 100,
            clientY: 100,
          }));
          window.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            buttons: 1,
            clientX: 120,
            clientY: 120,
          }));
          window.dispatchEvent(new MouseEvent("mouseup", {
            bubbles: true,
            button: 0,
            clientX: 120,
            clientY: 120,
          }));
          document.elementFromPoint = originalElementFromPoint;
          await new Promise((resolve) => setTimeout(resolve, 100));
          const dragPlaylistCount = Number(
            document.querySelector('[data-playlist-id="smoke-drag-playlist"] .sidebar-count')
              ?.textContent?.replace(/[^0-9]/g, "") ?? 0
          );
          dragAddToPlaylistReady = dragPlaylistCount > 0;
        }
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
        firstTrackRow?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const showInFinderItem = document.querySelector('[data-testid="show-in-finder-menu-item"]');
        const expectedShowInFolderLabel =
          window.muro?.platform === "darwin" ? "Show in Finder" : "Show in folder";
        const showInFinderReady = Boolean(
          showInFinderItem?.textContent?.includes(expectedShowInFolderLabel)
        );
        showInFinderItem?.click();
        await new Promise((resolve) => setTimeout(resolve, 40));
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const searchMetadataItem = document.querySelector('[data-testid="search-metadata-menu-item"]');
        const searchMetadataMenuReady = Boolean(
          searchMetadataItem?.textContent?.includes("Search for metadata")
        );
        searchMetadataItem?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const metadataSearchReady = Boolean(
          document.querySelector("[data-metadata-search-modal]") &&
          document.querySelector("[data-metadata-candidate]") &&
          document.querySelector("[data-apply-metadata]")
        );
        const metadataFieldRows = document.querySelectorAll("[data-metadata-field]");
        const metadataTitleCheckbox = document.querySelector('[data-metadata-field="title"] input');
        const metadataArtistCheckbox = document.querySelector('[data-metadata-field="artist"] input');
        document.querySelector("[data-metadata-clear]")?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const applyMetadataButton = document.querySelector("[data-apply-metadata]");
        const applyDisabledAfterClear = applyMetadataButton?.disabled === true;
        document.querySelector("[data-metadata-select-all]")?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const metadataFieldSelectionReady = Boolean(
          metadataFieldRows.length === 6 &&
          metadataTitleCheckbox?.checked &&
          metadataArtistCheckbox?.disabled &&
          applyDisabledAfterClear &&
          applyMetadataButton?.disabled === false
        );
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent?.trim() === "Cancel")
          ?.click();
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
        const nestedPlaylistFolderReady = Boolean(
          document.querySelector('[data-playlist-folder="smoke-nested-folder"]') &&
          document.querySelector('[data-playlist-folder-parent="smoke-nested-folder"]')
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

        const reorderSource = document.querySelector('[data-playlist-id="smoke-empty-playlist"]');
        const reorderTarget = document.querySelector('[data-playlist-id="smoke-drag-playlist"]');
        let playlistReorderReady = false;
        if (reorderSource && reorderTarget) {
          const dataTransfer = new DataTransfer();
          reorderSource.dispatchEvent(new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const targetBounds = reorderTarget.getBoundingClientRect();
          reorderTarget.dispatchEvent(new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientY: targetBounds.bottom - 1,
            dataTransfer,
          }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          reorderTarget.dispatchEvent(new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientY: targetBounds.bottom - 1,
            dataTransfer,
          }));
          reorderSource.dispatchEvent(new DragEvent("dragend", {
            bubbles: true,
            dataTransfer,
          }));
          await new Promise((resolve) => setTimeout(resolve, 100));
          const updatedSource = document.querySelector('[data-playlist-id="smoke-empty-playlist"]');
          const updatedTarget = document.querySelector('[data-playlist-id="smoke-drag-playlist"]');
          playlistReorderReady = Boolean(
            updatedSource &&
            updatedTarget &&
            (updatedTarget.compareDocumentPosition(updatedSource) & Node.DOCUMENT_POSITION_FOLLOWING)
          );
        }

        const firstBulkPlaylist = document.querySelector('[data-playlist-id="smoke-empty-playlist"]');
        const secondBulkPlaylist = document.querySelector('[data-playlist-id="smoke-drag-playlist"]');
        firstBulkPlaylist?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        secondBulkPlaylist?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        secondBulkPlaylist?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 190,
          clientY: 230,
        }));
        await new Promise((resolve) => setTimeout(resolve, 60));
        const bulkMoveButton = document.querySelector(
          '[data-playlist-move-folder="smoke-nested-folder"]'
        );
        const initialBulkDeleteButton = document.querySelector('[data-playlist-delete]');
        const bulkPlaylistMenuReady = Boolean(
          bulkMoveButton && initialBulkDeleteButton?.textContent?.includes("Delete 2 playlists")
        );
        bulkMoveButton?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const bulkPlaylistMoveReady = Boolean(
          document.querySelector('[data-playlist-id="smoke-empty-playlist"]')
            ?.getAttribute("data-playlist-folder-parent") === "smoke-nested-folder" &&
          document.querySelector('[data-playlist-id="smoke-drag-playlist"]')
            ?.getAttribute("data-playlist-folder-parent") === "smoke-nested-folder"
        );

        const movedFirstPlaylist = document.querySelector('[data-playlist-id="smoke-empty-playlist"]');
        const movedSecondPlaylist = document.querySelector('[data-playlist-id="smoke-drag-playlist"]');
        movedFirstPlaylist?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        movedSecondPlaylist?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        movedSecondPlaylist?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 190,
          clientY: 230,
        }));
        await new Promise((resolve) => setTimeout(resolve, 60));
        const bulkDeleteButton = document.querySelector('[data-playlist-delete]');
        bulkDeleteButton?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const bulkPlaylistDeleteReady = Boolean(
          !document.querySelector('[data-playlist-id="smoke-empty-playlist"]') &&
          !document.querySelector('[data-playlist-id="smoke-drag-playlist"]')
        );

        window.location.hash = "#/playlists/smoke-playlist";
        await new Promise((resolve) => setTimeout(resolve, 60));
        const playlistRemoveReady = Boolean(document.querySelector('[data-remove-from-playlist]'));
        window.location.hash = "#/settings";
        await new Promise((resolve) => setTimeout(resolve, 60));
        document.querySelector('[data-settings-tab="application"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const lastFmApiKeyInput = document.querySelector("[data-lastfm-api-key]");
        const theAudioDbApiKeyInput = document.querySelector("[data-theaudiodb-api-key]");
        const fanartApiKeyInput = document.querySelector("[data-fanart-api-key]");
        const artistInformationSettingsReady = Boolean(
          document.querySelector("[data-artist-information-settings]") &&
          lastFmApiKeyInput instanceof HTMLInputElement &&
          lastFmApiKeyInput.type === "password" &&
          theAudioDbApiKeyInput instanceof HTMLInputElement &&
          theAudioDbApiKeyInput.type === "password" &&
          fanartApiKeyInput instanceof HTMLInputElement &&
          fanartApiKeyInput.type === "password"
        );
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
        const djMixFeatureGateReady =
          defaultOff &&
          Boolean(document.querySelector("[data-dj-mix-settings]")) &&
          mixBarOptions.join(",") === "4,8,16,32";
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
        const djMixManualSurfaceReady = Boolean(document.querySelector("[data-selection-mix]"));
        document.querySelector('[data-panel-view="mix"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const mixWithCurrentButtons = Array.from(
          document.querySelectorAll("[data-mix-with-current]"),
        );
        const mixWithCurrentActionReady = mixWithCurrentButtons.length > 0
          && mixWithCurrentButtons.every(
            (button) => button instanceof HTMLButtonElement
              && !button.disabled
              && button.textContent?.includes("Mix"),
          );
        await window.muro.invoke("test_emit_transition_state", {
          status: "active",
          progress: 0.42,
          from_id: "smoke-track-0",
          to_id: "smoke-track-2",
          to_title: "Smoke Track 002",
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const mixIndicator = document.querySelector('[data-mix-indicator="active"]');
        const mixProgress = document.querySelector("[data-mix-progress]");
        const mixIndicatorReady = Boolean(
          mixIndicator?.textContent?.includes("Mixing") &&
          mixIndicator?.textContent?.includes("42%") &&
          mixIndicator?.textContent?.includes("Smoke Track 002") &&
          mixProgress?.getAttribute("aria-valuenow") === "42"
        );
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
        const firstAlbumCard = document.querySelector("[data-album-card]");
        firstAlbumCard?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 220,
          clientY: 180,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const albumCardContextMenuReady = Boolean(
          Array.from(document.querySelectorAll("[data-popover]"), (node) => node.textContent ?? "")
            .some((text) => text.includes("10 selected") && text.includes("Add to playlist"))
        );
        const searchAlbumMetadataItem = document.querySelector('[data-testid="search-album-metadata-menu-item"]');
        const albumMetadataMenuReady = Boolean(
          searchAlbumMetadataItem?.textContent?.includes("Search for album metadata")
        );
        searchAlbumMetadataItem?.click();
        await new Promise((resolve) => setTimeout(resolve, 160));
        const albumMetadataModalReady = Boolean(
          document.querySelector("[data-album-metadata-modal]") &&
          document.querySelector("[data-album-metadata-candidate]") &&
          document.querySelectorAll("[data-album-metadata-field]").length === 12 &&
          document.querySelectorAll('[data-album-track-match="matched"]').length === 10 &&
          document.querySelector("[data-apply-album-metadata]")?.textContent?.includes("10 tracks")
        );
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent?.trim() === "Cancel")
          ?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        document.querySelector(".album-card-open")?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const albumDetailReady = Boolean(document.querySelector("[data-album-detail]"));
        const albumDetailTrackCount = document.querySelectorAll("[data-album-track]").length;
        document.querySelector("[data-album-track]")?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 260,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const albumTrackContextMenuReady = Boolean(
          Array.from(document.querySelectorAll("[data-popover]"), (node) => node.textContent ?? "")
            .some((text) => text.includes("Play next") && text.includes("Add to playlist"))
        );
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        document.querySelector(".album-back-button")?.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        document.querySelector('[aria-label="List view"]')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const albumListReady = Boolean(document.querySelector(".album-collection--list"));
        document.querySelector(".album-collection--list [data-album-card]")?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 240,
          clientY: 200,
        }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const albumListMetadataMenuReady = Boolean(
          document.querySelector('[data-testid="search-album-metadata-menu-item"]')
        );
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 180));
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
          document.querySelector(".artist-detail-photo-credit")?.textContent?.includes("Smoke Photographer") &&
          document.querySelector(".artist-detail-similar")?.textContent?.includes("Similar Muro") &&
          document.querySelector(".artist-detail-sources")?.textContent?.includes("Wikimedia Commons") &&
          document.querySelector(".artist-detail-sources")?.textContent?.includes("Last.fm") &&
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
        document.querySelector('[title="Search for another artist picture"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const artistImageChooserReady = Boolean(
          document.querySelector("[data-artist-image-modal]") &&
          document.querySelectorAll("[data-artist-image-candidate]").length === 2 &&
          document.querySelector('[data-artist-image-candidate="wikimedia-commons"]') &&
          document.querySelector('[data-artist-image-candidate="fanart.tv"]')
        );
        document.querySelector('[data-artist-image-candidate="fanart.tv"] [role="radio"]')?.click();
        document.querySelector("[data-apply-artist-image]")?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const artistImageCounts = await window.muro.invoke("test_get_cover_counts");
        const artistImageApplied = Boolean(
          !document.querySelector("[data-artist-image-modal]") &&
          artistImageCounts.artistImageSaveCount === 1 &&
          document.querySelector(".artist-detail-photo img")?.getAttribute("src")?.includes("app-logo.png")
        );

        window.location.hash = "#/";
        await new Promise((resolve) => setTimeout(resolve, 100));
        const tableArtistLink = document.querySelector('[data-track-index="0"] [data-track-artist-link="true"]');
        tableArtistLink?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const tableArtistNavigationReady =
          window.location.hash.includes("/collection/artists") &&
          window.location.hash.includes("value=Muro") &&
          document.querySelector("h2")?.textContent?.trim() === "Muro";

        window.location.hash = "#/";
        await new Promise((resolve) => setTimeout(resolve, 100));
        const tableAlbumLink = document.querySelector('[data-track-index="0"] [data-track-album-link="true"]');
        tableAlbumLink?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const tableAlbumNavigationReady =
          window.location.hash.includes("/collection/albums") &&
          window.location.hash.includes("album=") &&
          Boolean(document.querySelector("[data-album-detail]"));

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
        await new Promise((resolve) => setTimeout(resolve, 300));
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
        document.querySelector('[data-panel-view="queue"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 40));
        document.querySelector('[aria-label="Clear queue"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 40));
        window.location.hash = "#/playlists/smoke-next-playlist";
        await new Promise((resolve) => setTimeout(resolve, 100));
        document.querySelector('[data-track-index="0"]')?.dispatchEvent(new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        document.querySelector('button[title="Next"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const nextUsesCurrentList = Boolean(
          document.querySelector('[data-track-index="1"][data-track-playing="true"]') &&
          document.querySelector('[data-track-index="1"]')?.textContent?.includes("Smoke Track 010")
        );
        window.location.hash = "#/";
        await new Promise((resolve) => setTimeout(resolve, 100));
        document.querySelector('[data-now-playing-link]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 140));
        const revealedPlayingTrack = document.querySelector(
          '[data-track-index="1"][data-track-playing="true"][data-track-selected="true"]',
        );
        const nowPlayingReturnsToSource = Boolean(
          window.location.hash.includes("/playlists/smoke-next-playlist") &&
          revealedPlayingTrack?.textContent?.includes("Smoke Track 010") &&
          document.activeElement?.matches('[data-track-table-scroll]')
        );
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
          sidebarAnimationReady,
          resizeTransitionDisabled,
          libraryHeaderControlsReady,
          libraryTitleRegionReady,
          compactRowsAligned,
          requestedColumnsAvailable,
          requestedColumnValuesReady,
          columnsMenuScrollable,
          deleteModalReady,
          initialLibraryPreference,
          rememberedDiskPreference,
          persistedDeleteMode,
          playlistRemoveReady,
          playlistFolderReady,
          nestedPlaylistFolderReady,
          playlistTransferControlsReady,
          playlistsUnderCollection,
          collapsedQueueControlsReady,
          playlistExportMoveMenuReady,
          playlistReorderReady,
          bulkPlaylistMenuReady,
          bulkPlaylistMoveReady,
          bulkPlaylistDeleteReady,
          windowChromeReady: Boolean(windowChrome && windowBrand && windowControls),
          windowChromeDragRegion: windowChrome
            ? getComputedStyle(windowChrome).getPropertyValue("-webkit-app-region")
            : "",
          historyBackInitiallyDisabled,
          historyForwardInitiallyDisabled,
          tableFocusedAfterClick,
          selectedAfterArrowDown,
          selectionBarReady,
          manualCoverMenuReady,
          manualCoverFetchReady,
          rowThumbnailReady,
          ratingFitsCell,
          tableAlbumMetadataMenuReady,
          ratingSetToThree,
          threeStarRatingClearsToZero,
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
          compactMixSuggestionsReady,
          mixExpanded,
          camelotSegmentCount,
          compatibleCamelotCount,
          camelotColorsReady,
          currentCamelotCode,
          selectedCamelotCode,
          wheelFilteredTo9A,
          queuedFromMix,
          playlistDropTargetReady,
          contextAddToPlaylistReady,
          dragAddToPlaylistReady,
          artistInformationSettingsReady,
          djMixFeatureGateReady,
          djMixManualSurfaceReady,
          mixWithCurrentActionReady,
          mixIndicatorReady,
          analysisNotationSettingsReady,
          contextMenuOpened,
          contextMenuStayedOpenInside,
          contextMenuClosedOutside,
          showInFinderReady,
          searchMetadataMenuReady,
          metadataSearchReady,
          metadataFieldSelectionReady,
          albumsViewReady,
          albumCardCount,
          albumSortOptions,
          albumDetailReady,
          albumDetailTrackCount,
          albumCardContextMenuReady,
          albumMetadataMenuReady,
          albumMetadataModalReady,
          albumTrackContextMenuReady,
          albumListReady,
          albumListMetadataMenuReady,
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
          artistImageChooserReady,
          artistImageApplied,
          tableArtistNavigationReady,
          tableAlbumNavigationReady,
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
          nextUsesCurrentList,
          nowPlayingReturnsToSource,
        };
      }
      return {
        childCount: root?.childElementCount ?? 0,
        textLength: root?.textContent?.trim().length ?? 0,
        stickyHeaderReady: false,
      };
    })()`);
    if (result.childCount > 0 && result.textLength > 0 && result.stickyHeaderReady) {
      if (
        !result.bulkPlaylistMenuReady ||
        !result.bulkPlaylistMoveReady ||
        !result.bulkPlaylistDeleteReady
      ) {
        fail(
          `Bulk playlist actions failed: menu=${result.bulkPlaylistMenuReady}, ` +
          `move=${result.bulkPlaylistMoveReady}, delete=${result.bulkPlaylistDeleteReady}`
        );
        return;
      }
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
      if (!result.libraryHeaderControlsReady) {
        fail("Library header controls do not match the simplified layout");
        return;
      }
      if (!result.libraryTitleRegionReady) {
        fail("Library header title region did not expand for longer names");
        return;
      }
      if (!result.compactRowsAligned) {
        fail("Compact table rows are not aligned with their virtualized offsets");
        return;
      }
      if (
        !result.requestedColumnsAvailable ||
        !result.requestedColumnValuesReady ||
        !result.columnsMenuScrollable
      ) {
        fail(
          `Extended columns failed: available=${result.requestedColumnsAvailable}, ` +
          `values=${result.requestedColumnValuesReady}, scrollable=${result.columnsMenuScrollable}`
        );
        return;
      }
      if (!result.sidebarAnimationReady || !result.resizeTransitionDisabled) {
        fail(
          `Sidebar animation failed: animated=${result.sidebarAnimationReady}, ` +
          `resizeDisabled=${result.resizeTransitionDisabled}`
        );
        return;
      }
      if (!result.collapsedQueueControlsReady) {
        fail("Collapsed queue sidebar still shows an extra control under Expand");
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
        !result.compactMixSuggestionsReady ||
        !result.mixExpanded ||
        !result.queuedFromMix
      ) {
        fail(
          `Camelot suggestions failed: count=${result.mixSuggestionCount}, ` +
          `reason=${result.firstMixReason}, filters=${result.mixFiltersReady}, ` +
          `unknownBpmFallback=${result.unknownBpmFallbackReady}, ` +
          `scores=${result.mixScoresReady}, compact=${result.compactMixSuggestionsReady}, ` +
          `expanded=${result.mixExpanded}, queued=${result.queuedFromMix}`
        );
        return;
      }
      if (
        !result.playlistDropTargetReady ||
        !result.contextAddToPlaylistReady ||
        !result.dragAddToPlaylistReady
      ) {
        fail(
          `Adding tracks to playlists failed: dropTarget=${result.playlistDropTargetReady}, ` +
          `contextMenu=${result.contextAddToPlaylistReady}, drag=${result.dragAddToPlaylistReady}`
        );
        return;
      }
      if (
        !result.rowThumbnailReady ||
        !result.ratingFitsCell ||
        !result.ratingSetToThree ||
        !result.threeStarRatingClearsToZero ||
        !ratingUpdates.some((update) => update.updates?.rating === 3) ||
        !ratingUpdates.some((update) => update.updates?.rating === 0) ||
        !result.selectedRowUsesGreyHighlight ||
        !result.playingRowUsesRedHighlight
      ) {
        fail(
          `Track row selection UI failed: thumbnail=${result.rowThumbnailReady}, ` +
          `ratingFits=${result.ratingFitsCell}, ratingSet=${result.ratingSetToThree}, ` +
          `ratingCleared=${result.threeStarRatingClearsToZero}, ratingUpdates=${JSON.stringify(ratingUpdates)}, ` +
          `selectedGrey=${result.selectedRowUsesGreyHighlight}, ` +
          `playingRed=${result.playingRowUsesRedHighlight}`
        );
        return;
      }
      if (!result.albumCardContextMenuReady || !result.albumTrackContextMenuReady) {
        fail(
          `Album context menus failed: card=${result.albumCardContextMenuReady}, ` +
          `track=${result.albumTrackContextMenuReady}`
        );
        return;
      }
      if (!result.albumMetadataMenuReady || !result.albumMetadataModalReady) {
        fail(
          `Album metadata search failed: menu=${result.albumMetadataMenuReady}, ` +
          `modal=${result.albumMetadataModalReady}`
        );
        return;
      }
      if (!result.tableAlbumMetadataMenuReady || !result.albumListMetadataMenuReady) {
        fail(
          `Album metadata surfaces failed: table=${result.tableAlbumMetadataMenuReady}, ` +
          `list=${result.albumListMetadataMenuReady}`
        );
        return;
      }
      if (!result.nextUsesCurrentList) {
        fail("Next did not advance within the current playlist when the queue was empty");
        return;
      }
      if (!result.nowPlayingReturnsToSource) {
        fail("Now-playing link did not return to and reveal the current track's source list");
        return;
      }
      if (!result.showInFinderReady || shownItemPaths.at(-1) !== smokeTracks[0].source_path) {
        fail(
          `Show in Finder failed: item=${result.showInFinderReady}, ` +
          `revealed=${shownItemPaths.at(-1)}, expected=${smokeTracks[0].source_path}`
        );
        return;
      }
      if (!result.tableArtistNavigationReady || !result.tableAlbumNavigationReady) {
        fail(
          `Table metadata navigation failed: artist=${result.tableArtistNavigationReady}, ` +
          `album=${result.tableAlbumNavigationReady}`
        );
        return;
      }
      if (!result.manualCoverMenuReady || !result.manualCoverFetchReady) {
        fail(
          `Manual cover fetch failed: menu=${result.manualCoverMenuReady}, ` +
          `fetch=${result.manualCoverFetchReady}`
        );
        return;
      }
      if (
        !result.searchMetadataMenuReady ||
        !result.metadataSearchReady ||
        !result.metadataFieldSelectionReady
      ) {
        fail(
          `Metadata search failed: menu=${result.searchMetadataMenuReady}, ` +
          `modal=${result.metadataSearchReady}, fields=${result.metadataFieldSelectionReady}`
        );
        return;
      }
      if (!result.artistImageChooserReady || !result.artistImageApplied) {
        fail(
          `Artist picture chooser failed: chooser=${result.artistImageChooserReady}, ` +
          `applied=${result.artistImageApplied}, saves=${artistImageSaveCount}`
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
      if (!result.mixIndicatorReady) {
        fail("Active mix progress indicator ignored its transition state or feature gate");
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
        !result.albumCardContextMenuReady ||
        !result.albumTrackContextMenuReady ||
        !result.albumListReady
      ) {
        fail(
          `Album view failed: view=${result.albumsViewReady}, cards=${result.albumCardCount}, ` +
          `detail=${result.albumDetailReady}, tracks=${result.albumDetailTrackCount}, ` +
          `cardMenu=${result.albumCardContextMenuReady}, trackMenu=${result.albumTrackContextMenuReady}, ` +
          `list=${result.albumListReady}`
        );
        return;
      }
      if (
        !result.contextMenuOpened ||
        !result.contextMenuStayedOpenInside ||
        !result.contextMenuClosedOutside ||
        !result.showInFinderReady ||
        shownItemPaths.at(-1) !== smokeTracks[0].source_path
      ) {
        fail(
          `Context-menu dismissal failed: opened=${result.contextMenuOpened}, ` +
          `inside=${result.contextMenuStayedOpenInside}, outside=${result.contextMenuClosedOutside}, ` +
          `showInFinder=${result.showInFinderReady}, revealed=${shownItemPaths.at(-1)}`
        );
        return;
      }
      if (!result.playlistRemoveReady) {
        fail("Playlist view did not show the remove-from-playlist button");
        return;
      }
      if (
        !result.playlistFolderReady ||
        !result.nestedPlaylistFolderReady ||
        !result.playlistTransferControlsReady ||
        !result.playlistsUnderCollection ||
        !result.playlistExportMoveMenuReady ||
        !result.playlistReorderReady
      ) {
        fail(
          `Playlist organization failed: folder=${result.playlistFolderReady}, ` +
          `nested=${result.nestedPlaylistFolderReady}, controls=${result.playlistTransferControlsReady}, ` +
          `underCollection=${result.playlistsUnderCollection}, ` +
          `menu=${result.playlistExportMoveMenuReady}, reorder=${result.playlistReorderReady}`
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
