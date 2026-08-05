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
const autoMixQueueSmokeOnly = process.env.MURO_AUTO_MIX_QUEUE_SMOKE === "1";
const artistSeparatorSmokeOnly = process.env.MURO_ARTIST_SEPARATOR_SMOKE === "1";
const libraryExportSmokeOnly = process.env.MURO_LIBRARY_EXPORT_SMOKE === "1";
const settingsSmokeOnly = process.env.MURO_SETTINGS_SMOKE === "1";
const startupLoadingSmoke = !autoMixQueueSmokeOnly
  && !artistSeparatorSmokeOnly
  && !libraryExportSmokeOnly
  && !settingsSmokeOnly;
let releaseStartupTrackLoad = () => undefined;
const startupTrackLoadGate = new Promise((resolve) => {
  releaseStartupTrackLoad = resolve;
});
let holdStartupTrackLoad = startupLoadingSmoke;
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
const smokeNow = Date.now();
const smokeMuroArtistId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const smokeGuestArtistId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const smokeTracks = Array.from({ length: 250 }, (_, index) => ({
  id: `smoke-track-${index}`,
  title: `Smoke Track ${String(index).padStart(3, "0")}`,
  artist: artistSeparatorSmokeOnly && index === 249
    ? "Muro & Guest feat. DJ Test"
    : !artistSeparatorSmokeOnly && index === 5
      ? "Muro feat. Guest Alias"
      : "Muro",
  artist_credits: !artistSeparatorSmokeOnly
    ? index === 5
      ? [{
        artistId: smokeMuroArtistId,
        name: "Muro",
        creditedName: "Muro",
        joinPhrase: " feat. ",
      }, {
        artistId: smokeGuestArtistId,
        name: "Guest Artist",
        creditedName: "Guest Alias",
        joinPhrase: "",
      }]
      : [{
        artistId: smokeMuroArtistId,
        name: "Muro",
        creditedName: "Muro",
        joinPhrase: "",
      }]
    : undefined,
  artists: artistSeparatorSmokeOnly && index === 249
    ? "Various Artists & Muro"
    : "Muro",
  album: `Smoke Album ${String(Math.floor(index / 10)).padStart(2, "0")}`,
  track_number: (index % 10) + 1,
  track_total: 10,
  year: 2000 + Math.floor(index / 10),
  date_added: new Date(smokeNow - index * 86_400_000).toISOString(),
  genre: index % 2 === 0 ? "Electronic" : "House",
  duration: "3:00",
  duration_seconds: 180,
  bitrate: "320 kbps",
  sample_rate_hz: 44_100,
  bit_depth: 24,
  file_size_bytes: 10 * 1024 * 1024,
  key: ["8A", "8A", "9A", "7A", "8B", "2B"][index % 6],
  bpm: index === 1 ? 0 : 120 + (index % 8),
  beat_grid_json: autoMixQueueSmokeOnly
    ? JSON.stringify({
        version: 1,
        bpm: 120 + (index % 8),
        firstBeatSec: 0,
        firstDownbeatSec: 0,
        confidence: 0.95,
        analyzedAt: 1_753_228_800,
      })
    : null,
  rating: 0,
  label: index % 2 === 0 ? "Muro Records" : "Night Shift Music",
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
let braveCoverFallbackEnabled = false;
let braveCoverCacheCount = 0;
let selectedBraveCoverId = null;
let artistImageSaveCount = 0;
let artistImageSearchArgs = null;
let artistImageSaveArgs = null;
let organizedLibraryExportArgs = null;
let organizedLibraryReloaded = false;
let itunesLibraryExportArgs = null;
const settingsWatchedFolders = [
  path.join(temporaryDirectory, "watched-one"),
  path.join(temporaryDirectory, "watched-two"),
];
let settingsWatchedFolderSelection = 0;
let loadTracksInvocationCount = 0;
let libraryStructureValidationCount = 0;
let libraryStructureRepairArgs = null;
const shownItemPaths = [];
let nativeDraggedFilePaths = [];
const copiedCoverPaths = [];
const ratingUpdates = [];
for (let index = 0; index < 5; index += 1) {
  writeSilentWave(smokeTracks[index].source_path);
}

app.setPath("userData", temporaryDirectory);

const fail = (message) => {
  console.error(message);
  app.exit(1);
};

const timeout = setTimeout(
  () => fail(
    autoMixQueueSmokeOnly
      ? "Auto-mix queue smoke test timed out because the renderer became unresponsive"
      : artistSeparatorSmokeOnly
        ? "Artist separator renderer smoke test timed out"
        : libraryExportSmokeOnly
          ? "Organized library export renderer smoke test timed out"
          : settingsSmokeOnly
            ? "Settings organization renderer smoke test timed out"
            : "Renderer smoke test timed out"
  ),
  autoMixQueueSmokeOnly || artistSeparatorSmokeOnly || libraryExportSmokeOnly || settingsSmokeOnly
    ? 30_000
    : 120_000,
);

app.whenReady().then(async () => {
  protocol.handle("muro-file", (request) => {
    const url = new URL(request.url);
    return createLocalFileResponse(request, decodeURIComponent(url.pathname.slice(1)));
  });
  ipcMain.handle("muro:app-data-dir", () => temporaryDirectory);
  ipcMain.handle("muro:open-dialog", () => {
    if (libraryExportSmokeOnly) return temporaryDirectory;
    if (settingsSmokeOnly) {
      const selected = settingsWatchedFolders[
        Math.min(settingsWatchedFolderSelection, settingsWatchedFolders.length - 1)
      ];
      settingsWatchedFolderSelection += 1;
      return selected;
    }
    return null;
  });
  ipcMain.handle("muro:save-dialog", (_event, options = {}) => {
    if (settingsSmokeOnly && options.defaultPath === "Muro Music Library.xml") {
      return path.join(temporaryDirectory, "Muro Music Library.xml");
    }
    return null;
  });
  ipcMain.handle("muro:clipboard-has-image", () => false);
  ipcMain.handle("muro:cache-clipboard-cover-art", () => null);
  ipcMain.handle("muro:copy-image-to-clipboard", (_event, filePath) => {
    copiedCoverPaths.push(filePath);
    return true;
  });
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
  ipcMain.on("muro:start-file-drag", (_event, filePaths) => {
    nativeDraggedFilePaths = Array.isArray(filePaths) ? [...filePaths] : [];
  });
  ipcMain.handle("muro:invoke", (event, command, args = {}) => {
    if (command === "migrate_artist_credits") {
      return {
        skipped: false,
        tracksChecked: smokeTracks.length,
        setsCreated: 0,
        setsReplaced: 0,
        creditsCreated: 0,
      };
    }
    if (command === "load_tracks") {
      loadTracksInvocationCount += 1;
      const useExportedPaths = organizedLibraryExportArgs?.useAsCurrentLibrary === true;
      if (useExportedPaths) organizedLibraryReloaded = true;
      const snapshot = {
        library: useExportedPaths
          ? smokeTracks.map((track) => ({
              ...track,
              source_path: path.join(temporaryDirectory, "Muro Library", path.basename(track.source_path)),
            }))
          : smokeTracks,
        inbox: [],
      };
      if (holdStartupTrackLoad) {
        holdStartupTrackLoad = false;
        return startupTrackLoadGate.then(() => snapshot);
      }
      return snapshot;
    }
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
        {
          id: "smoke-linked-playlist",
          name: "Linked M3U",
          folder_id: null,
          sort_order: 3,
          source_path: path.join(temporaryDirectory, "linked.m3u"),
          source_mtime_ms: null,
          source_size: null,
          source_sync_error: null,
          last_synced_at: null,
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
    if (command === "list_playlist_history") {
      return { entries: [], canUndo: false, canRedo: false };
    }
    if (command === "list_playlist_snapshots" || command === "list_metadata_history") return [];
    if (command === "export_itunes_library") {
      itunesLibraryExportArgs = { ...args };
      return {
        destinationPath: args.destinationPath,
        tracksExported: smokeTracks.length,
        missingTracksReferenced: 0,
        playlistFoldersExported: 2,
        playlistsExported: 5,
        playlistEntriesExported: 253,
        playlistEntriesSkipped: 0,
      };
    }
    if (command === "test_get_itunes_library_export_args") return itunesLibraryExportArgs;
    if (command === "load_cached_artist_profiles") return [smokeArtistProfile];
    if (command === "get_artist_profile") return smokeArtistProfile;
    if (command === "search_artist_images") {
      artistImageSearchArgs = { ...args };
      return [
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
      {
        id: "brave-search-result",
        provider: "brave-search",
        imageUrl: "https://imgs.search.brave.com/muro-search-result.jpg",
        sourceUrl: "https://search.brave.com/images?q=Muro+musician",
        sourceName: "label.example",
        title: "Muro artist press portrait",
        attribution: "label.example",
        width: 1600,
        height: 1600,
      },
      {
        id: "deezer-result",
        provider: "deezer",
        imageUrl: "https://cdn-images.dzcdn.net/images/artist/muro/1000x1000.jpg",
        sourceUrl: "https://www.deezer.com/artist/987654",
        sourceName: "Muro",
        title: "Muro on Deezer",
        attribution: "Deezer",
        width: 1000,
        height: 1000,
      },
      ];
    }
    if (command === "set_artist_image") {
      artistImageSaveCount += 1;
      artistImageSaveArgs = { ...args };
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
      if (braveCoverFallbackEnabled) return null;
      return {
        fullPath: smokeTracks[0].source_path,
        thumbPath: smokeTracks[0].source_path,
        sourceUrl: "https://coverartarchive.org/release/smoke/front",
      };
    }
    if (command === "search_album_cover_images") {
      return [
        {
          id: "brave-cover-one",
          provider: "brave-search",
          imageUrl: "https://imgs.search.brave.com/cover-one.jpg",
          sourceUrl: "https://search.brave.com/images?q=Smoke+Album",
          sourceName: "first-label.example",
          title: "Smoke Album alternate cover",
          width: 1000,
          height: 1000,
          score: 2000,
        },
        {
          id: "brave-cover-two",
          provider: "brave-search",
          imageUrl: "https://imgs.search.brave.com/cover-two.jpg",
          sourceUrl: "https://search.brave.com/images?q=Smoke+Album",
          sourceName: "second-label.example",
          title: "Smoke Album official artwork",
          width: 1400,
          height: 1400,
          score: 1000,
        },
      ];
    }
    if (command === "cache_album_cover_candidate") {
      braveCoverCacheCount += 1;
      selectedBraveCoverId = args.candidate?.id ?? null;
      const imagePath = path.join(appRoot, "src", "assets", "app-logo.png");
      return {
        fullPath: imagePath,
        thumbPath: imagePath,
        sourceUrl: args.candidate?.sourceUrl ?? null,
        provider: "brave-search",
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
    if (command === "identify_track_acoustid") {
      return {
        trackId: args.trackId,
        cached: false,
        duration: 180,
        candidates: [{
          id: "11111111-1111-4111-8111-111111111111:99999999-9999-4999-8999-999999999999:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          acoustidId: "11111111-1111-4111-8111-111111111111",
          score: 0.98,
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
          genre: null,
          albumMatch: true,
        }],
      };
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
      return {
        manualCoverFetchCount,
        braveCoverCacheCount,
        selectedBraveCoverId,
        artistImageSaveCount,
        artistImageSearchArgs,
        artistImageSaveArgs,
        copiedCoverPaths: [...copiedCoverPaths],
      };
    }
    if (command === "test_enable_brave_cover_fallback") {
      braveCoverFallbackEnabled = true;
      return undefined;
    }
    if (command === "test_get_metadata_updates") {
      return ratingUpdates;
    }
    if (command === "test_press_enter") {
      const targetDebugger = event.sender.debugger;
      if (!targetDebugger.isAttached()) {
        targetDebugger.attach("1.3");
      }
      const enterKey = {
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      };
      return targetDebugger
        .sendCommand("Input.dispatchKeyEvent", {
          ...enterKey,
          type: "rawKeyDown",
        })
        .then(() => targetDebugger.sendCommand("Input.dispatchKeyEvent", {
          ...enterKey,
          type: "char",
          text: "\r",
          unmodifiedText: "\r",
        }))
        .then(() => targetDebugger.sendCommand("Input.dispatchKeyEvent", {
          ...enterKey,
          type: "keyUp",
        }))
        .then(() => true);
    }
    if (command === "test_get_artist_separator_updates") {
      return ratingUpdates.filter((update) =>
        typeof update.updates?.artist === "string" ||
        typeof update.updates?.artists === "string"
      );
    }
    if (command === "export_organized_library") {
      organizedLibraryExportArgs = args;
      event.sender.send("muro:event", "muro://library-export-progress", {
        phase: "music",
        current: smokeTracks.length,
        total: smokeTracks.length,
        name: smokeTracks.at(-1)?.title,
      });
      event.sender.send("muro:event", "muro://library-export-progress", {
        phase: "playlists",
        current: 5,
        total: 5,
        name: "Nested Playlist",
      });
      return {
        exportRoot: path.join(temporaryDirectory, "Muro Library"),
        tracks: smokeTracks.length,
        filesCopied: smokeTracks.length,
        tracksFailed: 0,
        playlistsExported: 5,
        playlistEntriesExported: smokeTracks.length,
        playlistEntriesMissing: 0,
        librarySwitchRequested: Boolean(args.useAsCurrentLibrary),
        librarySwitched: Boolean(args.useAsCurrentLibrary),
        librarySwitchError: null,
        failures: [],
      };
    }
    if (command === "test_get_organized_library_export_args") {
      return organizedLibraryExportArgs
        ? { ...organizedLibraryExportArgs, rendererReloaded: organizedLibraryReloaded }
        : null;
    }
    if (command === "scan_technical_metadata") {
      return { checked: 0, updated: 0, failed: 0, remaining: 0 };
    }
    if (
      command === "reorder_playlists" ||
      command === "delete_playlist" ||
      command === "create_playlist" ||
      command === "update_playlist" ||
      command === "set_playlist_tracks"
    ) return undefined;
    if (command === "delete_playlists") {
      return { deleted: args.playlistIds?.length ?? 0 };
    }
    if (command === "restore_playlists") {
      return { restored: args.playlists?.length ?? 0 };
    }
    if (command === "update_track_metadata") {
      ratingUpdates.push(args);
      return { updated: args.trackIds?.length ?? 0, filesWritten: 0, fileWriteErrors: [] };
    }
    if (command === "playback_get_state") return {
      is_playing: false,
      current_position: 0,
      duration: 0,
      volume: 1,
      current_track: null,
    };
    if (command === "cast_get_state") return {
      state: "idle",
      deviceId: null,
      deviceName: null,
      media: null,
      track: null,
      lastError: null,
      discovery: {
        devices: [{ id: "cast-smoke", name: "Smoke Speaker", model: "Smoke Cast" }],
        scanning: false,
        error: null,
      },
    };
    if (command === "dlna_get_state") return {
      state: "idle",
      deviceId: null,
      deviceName: null,
      media: null,
      track: null,
      lastError: null,
      discovery: { devices: [], scanning: false, error: null },
    };
    if (command === "cast_start_discovery") {
      return {
        devices: [{ id: "cast-smoke", name: "Smoke Speaker", model: "Smoke Cast" }],
        scanning: false,
        error: null,
      };
    }
    if (command === "dlna_start_discovery") {
      return { devices: [], scanning: false, error: null };
    }
    if (command === "cast_stop_discovery" || command === "dlna_stop_discovery") {
      return undefined;
    }
    if (command === "cast_connect") {
      const state = {
        state: "connected",
        deviceId: "cast-smoke",
        deviceName: "Smoke Speaker",
        media: null,
        track: null,
        lastError: null,
      };
      event.sender.send("muro:event", "muro://cast-state", state);
      return state;
    }
    if (command === "cast_load_track") {
      throw new Error("CAST_UNSUPPORTED_FORMAT: simulated unsupported format");
    }
    if (command === "cast_disconnect") {
      const state = {
        state: "idle",
        deviceId: null,
        deviceName: null,
        media: null,
        track: null,
        lastError: null,
        lastPositionSecs: 0,
      };
      event.sender.send("muro:event", "muro://cast-state", state);
      return state;
    }
    if (command === "playback_play_file") return undefined;
    if (command === "playback_set_seek_mode" || command === "generate_track_waveform") {
      return command === "generate_track_waveform" ? [] : undefined;
    }
    if (command === "playback_toggle") return false;
    if (command === "add_tracks_to_playlist") return undefined;
    if (command === "test_emit_media_control") {
      event.sender.send("muro:event", "muro://media-control", args.payload ?? args.action);
      return undefined;
    }
    if (command === "test_emit_track_ended") {
      event.sender.send("muro:event", "muro://track-ended", null);
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
    // Gapless preload and crossfade configuration: the renderer pushes these
    // whenever the queue or the transport settings change.
    if (
      command === "playback_preload_next" ||
      command === "playback_clear_preload" ||
      command === "playback_set_gapless" ||
      command === "playback_set_crossfade" ||
      command === "playback_set_track_gain"
    ) return undefined;
    // Full-text search: null tells the renderer the index has no opinion, so it
    // uses its in-memory matcher — which is what the search assertions below
    // exercise. The index itself is covered by search-index-smoke.
    if (command === "search_tracks") return null;
    if (command === "set_watched_folders") return { watching: [] };
    if (command === "scan_watched_folders") return { imported: 0, scanned: 0 };
    if (command === "configure_playlist_sync") {
      return { linked: 0, synced: 0, changed: 0 };
    }
    if (command === "sync_playlist_source") return null;
    if (command === "watched_folders_status") {
      return { enabled: false, watching: [], pending: 0 };
    }
    if (command === "verify_library_files") {
      return { checked: 0, newlyMissing: 0, restored: 0, missing: 0 };
    }
    if (command === "list_missing_tracks") return [];
    if (command === "validate_library_structure") {
      libraryStructureValidationCount += 1;
      const libraryRoot = args.libraryRoot || settingsWatchedFolders[1];
      return {
        checked: 1,
        unavailable: 0,
        outsideRoot: 0,
        misplaced: libraryStructureValidationCount === 1
          ? [{
              trackId: "smoke-track-0",
              title: "Smoke Track 000",
              artist: "Renamed Muro",
              albumArtist: "",
              album: "Smoke Album 00",
              filename: "track-0.wav",
              currentPath: path.join(
                libraryRoot,
                "Muro",
                "Smoke Album 00",
                "track-0.wav"
              ),
              currentFolder: path.join(libraryRoot, "Muro", "Smoke Album 00"),
              expectedFolder: path.join(
                libraryRoot,
                "Renamed Muro",
                "Smoke Album 00"
              ),
            }]
          : [],
      };
    }
    if (command === "repair_library_structure") {
      libraryStructureRepairArgs = { ...args, trackIds: [...(args.trackIds ?? [])] };
      return {
        requested: args.trackIds?.length ?? 0,
        moved: (args.trackIds ?? []).map((trackId) => ({
          trackId,
          sourcePath: path.join(
            args.libraryRoot,
            "Renamed Muro",
            "Smoke Album 00",
            "track-0.wav"
          ),
          filename: "track-0.wav",
        })),
        skipped: 0,
        failures: [],
      };
    }
    if (command === "test_get_library_structure_state") {
      return {
        loadTracksInvocationCount,
        validationCount: libraryStructureValidationCount,
        repairArgs: libraryStructureRepairArgs,
      };
    }
    if (command === "list_tracks_needing_loudness") return [];
    if (command === "update_track_loudness") return { updated: true };
    if (command === "recompute_album_gain") return { albums: 0, updated: 0 };
    throw new Error(`Unexpected renderer smoke command: ${command}`);
  });

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(appRoot, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Render offscreen so Chromium keeps producing compositor frames for
      // this never-shown window. Without frames, requestAnimationFrame
      // callbacks and ResizeObserver deliveries starve mid-run, which stalls
      // rAF-deferred app work and stops the virtualizer from rendering rows.
      offscreen: true,
      backgroundThrottling: false,
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

  if (startupLoadingSmoke) {
    const startupLoadingState = await window.webContents.executeJavaScript(`(async () => {
      let loading = null;
      for (let attempt = 0; attempt < 40 && !loading; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        loading = document.querySelector('[data-library-loading]');
      }
      return {
        visible: Boolean(loading),
        role: loading?.getAttribute('role') ?? null,
        live: loading?.getAttribute('aria-live') ?? null,
        text: loading?.textContent?.trim() ?? null,
        spinner: Boolean(loading?.querySelector('.animate-spin')),
      };
    })()`);
    releaseStartupTrackLoad();
    if (
      !startupLoadingState.visible
      || startupLoadingState.role !== "status"
      || startupLoadingState.live !== "polite"
      || !startupLoadingState.text?.includes("Loading")
      || !startupLoadingState.spinner
    ) {
      fail(`Startup loading state failed: ${JSON.stringify(startupLoadingState)}`);
      return;
    }
    const startupLoadCompleted = await window.webContents.executeJavaScript(`(async () => {
      let row = null;
      for (let attempt = 0; attempt < 80 && !row; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        row = document.querySelector('[data-track-index="0"]');
      }
      return Boolean(row) && !document.querySelector('[data-library-loading]');
    })()`);
    if (!startupLoadCompleted) {
      fail("Startup loading state did not clear after songs became visible");
      return;
    }

    const multiArtistPreflight = await window.webContents.executeJavaScript(`(async () => {
      let cell = null;
      for (let attempt = 0; attempt < 40 && !cell; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        cell = document.querySelector(
          '[data-track-index="5"] [data-column-key="artist"]'
        );
      }
      const links = cell?.querySelectorAll('[data-track-artist-link="true"]') ?? [];
      const exact = Boolean(
        cell?.textContent?.trim() === "Muro feat. Guest Alias" &&
        links.length === 2 &&
        links[0]?.textContent === "Muro" &&
        links[1]?.textContent === "Guest Alias"
      );
      links[1]?.click();
      let secondLink = false;
      for (let attempt = 0; attempt < 40 && !secondLink; attempt += 1) {
        secondLink = Boolean(
          window.location.hash.includes("/collection/artists") &&
          window.location.hash.includes("value=Guest+Artist") &&
          document.querySelector('[data-artist-detail="Guest Artist"]')
        );
        if (!secondLink) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const debug = {
        text: cell?.textContent ?? null,
        links: [...links].map((link) => link.textContent),
        hash: window.location.hash,
      };
      window.location.hash = "#/";
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (
          window.location.hash === "#/" &&
          document.querySelector('[data-track-table-scroll]') &&
          !document.querySelector('[data-artist-detail]')
        ) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return { exact, secondLink, debug };
    })()`);
    if (!multiArtistPreflight.exact || !multiArtistPreflight.secondLink) {
      fail(
        `Multi-artist preflight failed: exact=${multiArtistPreflight.exact}, `
        + `secondLink=${multiArtistPreflight.secondLink}, `
        + `debug=${JSON.stringify(multiArtistPreflight.debug)}`,
      );
      return;
    }
    await new Promise((resolve) => {
      window.webContents.once("did-finish-load", resolve);
      window.webContents.reload();
    });
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    let result;
    try {
      result = await window.webContents.executeJavaScript(`(async () => {
      const root = document.getElementById("root");
      const selectAll = document.querySelector('[aria-label="Select all tracks"]');
      const scroller = document.querySelector('[data-track-table-scroll]');
      const headerScroller = document.querySelector('[data-track-table-header-scroll]');
      const searchShortcutHint = document.querySelector('[data-search-shortcut-hint]');
      const waitForSelector = async (selector, attempts = 120) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return null;
      };
      const waitForCondition = async (predicate, attempts = 120) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return false;
      };
      const requireCondition = async (label, predicate, attempts = 120) => {
        const ready = await waitForCondition(predicate, attempts);
        if (!ready) throw new Error("Timed out waiting for " + label);
      };
      if (${settingsSmokeOnly ? "true" : "false"}) {
        if (!root?.childElementCount || !scroller) {
          return {
            childCount: root?.childElementCount ?? 0,
            textLength: root?.textContent?.trim().length ?? 0,
            stickyHeaderReady: false,
          };
        }

        await waitForCondition(() => Boolean(
          document.querySelector("[data-playlist-create]") &&
          document.querySelector("[data-playlist-actions-menu]")
        ));
        const createPlaylistButton = document.querySelector("[data-playlist-create]");
        const playlistActionsButton = document.querySelector("[data-playlist-actions-menu]");
        const unlabeledIconButtons = [...document.querySelectorAll("button")].filter(
          (button) =>
            !button.textContent?.trim() &&
            !button.getAttribute("aria-label")?.trim() &&
            !button.getAttribute("title")?.trim()
        );
        playlistActionsButton?.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          relatedTarget: document.body,
        }));
        await waitForCondition(() => {
          const tooltip = document.querySelector("[data-global-button-tooltip]");
          const rect = tooltip?.getBoundingClientRect();
          return Boolean(
            tooltip?.getAttribute("role") === "tooltip" &&
            tooltip.textContent?.includes("More playlist actions") &&
            rect &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight
          );
        }, 80);
        const playlistActionsTooltip = document.querySelector("[data-global-button-tooltip]");
        const playlistActionsTooltipRect = playlistActionsTooltip?.getBoundingClientRect();
        const playlistActionsTooltipReady = Boolean(
          playlistActionsTooltip?.getAttribute("role") === "tooltip" &&
          playlistActionsTooltip.textContent?.includes("More playlist actions") &&
          playlistActionsTooltipRect &&
          playlistActionsTooltipRect.left >= 0 &&
          playlistActionsTooltipRect.right <= window.innerWidth &&
          playlistActionsTooltipRect.top >= 0 &&
          playlistActionsTooltipRect.bottom <= window.innerHeight
        );
        playlistActionsButton?.dispatchEvent(new PointerEvent("pointerout", {
          bubbles: true,
          relatedTarget: document.body,
        }));
        playlistActionsButton?.click();
        await waitForCondition(() => Boolean(
          document.querySelector("[data-playlist-actions-menu]")
            ?.getAttribute("aria-expanded") === "true" &&
          document.querySelector("[data-playlist-import]")?.textContent
            ?.includes("Import playlist file") &&
          document.querySelector("[data-playlist-folder-import]")?.textContent
            ?.includes("Import playlist folder") &&
          document.querySelector("[data-playlist-export-all]")?.textContent
            ?.includes("Export all playlists") &&
          document.querySelector("[data-playlist-folder-create]")?.textContent
            ?.includes("New playlist folder")
        ));
        const importButton = document.querySelector("[data-playlist-import]");
        const folderImportButton = document.querySelector("[data-playlist-folder-import]");
        const exportAllButton = document.querySelector("[data-playlist-export-all]");
        const folderCreateButton = document.querySelector("[data-playlist-folder-create]");
        const playlistActionsMenuReady = Boolean(
          createPlaylistButton &&
          playlistActionsButton?.getAttribute("aria-expanded") === "true" &&
          importButton?.textContent?.includes("Import playlist file") &&
          folderImportButton?.textContent?.includes("Import playlist folder") &&
          exportAllButton?.textContent?.includes("Export all playlists") &&
          folderCreateButton?.textContent?.includes("New playlist folder")
        );
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await waitForCondition(() =>
          !document.querySelector("[data-popover]") &&
          document.querySelector("[data-playlist-actions-menu]")
            ?.getAttribute("aria-expanded") !== "true"
        );
        const playlistForExport = document.querySelector('[data-playlist-id="smoke-empty-playlist"]');
        playlistForExport?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 180,
          clientY: 220,
        }));
        await waitForSelector("[data-playlist-export]");
        const exportButton = document.querySelector("[data-playlist-export]");
        const playlistTooltipsReady = Boolean(
          unlabeledIconButtons.length === 0 &&
          playlistActionsTooltipReady &&
          playlistActionsMenuReady &&
          exportButton?.getAttribute("title") === "Export this playlist as an M3U8 file"
        );
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await waitForCondition(() => !document.querySelector("[data-popover]"));

        window.location.hash = "#/settings";
        let searchInput = null;
        for (let attempt = 0; attempt < 40 && !searchInput; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          searchInput = document.querySelector("[data-settings-search]");
        }
        await waitForCondition(() =>
          document.querySelectorAll("[data-settings-section]").length === 6
        );
        const initialCategoryCount = document.querySelectorAll("[data-settings-section]").length;
        if (searchInput instanceof HTMLInputElement) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
            ?.set?.call(searchInput, "AcoustID");
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await waitForCondition(() =>
          document.querySelectorAll("[data-settings-section]").length === 1 &&
          Boolean(document.querySelector('[data-settings-section="metadata"]')) &&
          Boolean(document.querySelector('[data-settings-page="metadata"]'))
        );
        const filteredToMetadata = Boolean(
          document.querySelectorAll("[data-settings-section]").length === 1 &&
          document.querySelector('[data-settings-section="metadata"]') &&
          document.querySelector('[data-settings-page="metadata"]')
        );

        if (searchInput instanceof HTMLInputElement) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
            ?.set?.call(searchInput, "");
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await waitForCondition(() =>
          document.querySelectorAll("[data-settings-section]").length === 6
        );
        document.querySelector('[data-settings-tab="metadata"]')?.click();
        await waitForCondition(() => [
          "[data-acoustid-client-key]",
          "[data-lastfm-api-key]",
          "[data-theaudiodb-api-key]",
          "[data-fanart-api-key]",
          "[data-brave-search-api-key]",
        ].every((selector) => {
          const input = document.querySelector(selector);
          return input instanceof HTMLInputElement && input.type === "password";
        }));
        const providerInputs = [
          document.querySelector("[data-acoustid-client-key]"),
          document.querySelector("[data-lastfm-api-key]"),
          document.querySelector("[data-theaudiodb-api-key]"),
          document.querySelector("[data-fanart-api-key]"),
          document.querySelector("[data-brave-search-api-key]"),
        ];
        const providersReady = providerInputs.every(
          (input) => input instanceof HTMLInputElement && input.type === "password"
        );
        const acoustIdShowButton = [...document.querySelectorAll("button")]
          .find((button) => button.getAttribute("aria-label") === "Show AcoustID API key");
        acoustIdShowButton?.click();
        await waitForCondition(() =>
          document.querySelector("[data-acoustid-client-key]")?.getAttribute("type") === "text"
        );
        const showKeyReady =
          document.querySelector("[data-acoustid-client-key]")?.getAttribute("type") === "text";

        document.querySelector('[data-settings-tab="library"]')?.click();
        await waitForCondition(() => Boolean(
          document.querySelector('[data-settings-page="library"]') &&
          document.querySelector("[data-artist-separator-tool]") &&
          document.querySelector("[data-organized-library-export]") &&
          document.querySelector("[data-itunes-library-export]") &&
          document.querySelector("[data-export-itunes-library]")
        ));
        const libraryReady = Boolean(
          document.querySelector('[data-settings-page="library"]') &&
          document.querySelector("[data-artist-separator-tool]") &&
          document.querySelector("[data-organized-library-export]") &&
          document.querySelector("[data-itunes-library-export]") &&
          document.querySelector("[data-export-itunes-library]")
        );
        const itunesExportButton = document.querySelector("[data-export-itunes-library]");
        itunesExportButton?.click();
        await waitForCondition(() =>
          document.querySelector("[data-itunes-library-export-status]")
            ?.textContent?.includes("Exported 250 tracks and 5 playlists")
        );
        const itunesExportArgs = await window.muro.invoke("test_get_itunes_library_export_args");
        const itunesExportStatus = document.querySelector(
          "[data-itunes-library-export-status]"
        );
        const itunesExportReady = Boolean(
          itunesExportButton &&
          itunesExportArgs?.destinationPath === ${JSON.stringify(
            path.join(temporaryDirectory, "Muro Music Library.xml")
          )} &&
          typeof itunesExportArgs?.dbPath === "string" &&
          itunesExportStatus?.textContent?.includes("Exported 250 tracks and 5 playlists")
        );
        document.querySelector("[data-watch-add-folder]")?.click();
        await waitForCondition(() => Boolean(
          document.querySelector("[data-watch-add-folder]")?.textContent
            ?.includes("Change folder") &&
          document.querySelector("[data-watch-folder-destination-hint]") &&
          document.body.textContent?.includes(${JSON.stringify(settingsWatchedFolders[0])})
        ));
        const firstWatchedFolderReady = Boolean(
          document.querySelector("[data-watch-add-folder]")?.textContent?.includes("Change folder") &&
          document.querySelector("[data-watch-folder-destination-hint]") &&
          document.body.textContent?.includes(${JSON.stringify(settingsWatchedFolders[0])})
        );
        document.querySelector("[data-watch-add-folder]")?.click();
        await waitForCondition(() => {
          let persistedFolders = null;
          try {
            persistedFolders = JSON.parse(
              localStorage.getItem("muro-settings") ?? "null"
            )?.state?.watchedFolders;
          } catch {}
          return Boolean(
            document.body.textContent?.includes(${JSON.stringify(settingsWatchedFolders[1])}) &&
            !document.body.textContent?.includes(${JSON.stringify(settingsWatchedFolders[0])}) &&
            Array.isArray(persistedFolders) &&
            persistedFolders.length === 1 &&
            persistedFolders[0] === ${JSON.stringify(settingsWatchedFolders[1])}
          );
        });
        const persistedWatchedFolders = JSON.parse(
          localStorage.getItem("muro-settings") ?? "null"
        )?.state?.watchedFolders;
        const singleWatchedFolderReady = Boolean(
          document.body.textContent?.includes(${JSON.stringify(settingsWatchedFolders[1])}) &&
          !document.body.textContent?.includes(${JSON.stringify(settingsWatchedFolders[0])}) &&
          Array.isArray(persistedWatchedFolders) &&
          persistedWatchedFolders.length === 1 &&
          persistedWatchedFolders[0] === ${JSON.stringify(settingsWatchedFolders[1])}
        );

        const structureStateBefore = await window.muro.invoke(
          "test_get_library_structure_state"
        );
        const validateStructureButton = document.querySelector(
          "[data-validate-library-structure]"
        );
        const repairUnavailableBeforeValidation = Boolean(
          !document.querySelector("[data-repair-library-structure]")
        );
        validateStructureButton?.click();
        await waitForCondition(() => Boolean(
          document.querySelector("[data-library-structure-modal]") &&
          document.querySelector('[data-library-structure-track="smoke-track-0"]')
            ?.textContent?.includes("Smoke Track 000") &&
          document.querySelector("[data-library-structure-current-path]")
            ?.textContent?.includes("Muro") &&
          document.querySelector("[data-library-structure-expected-path]")
            ?.textContent?.includes("Renamed Muro") &&
          document.querySelector("[data-repair-library-structure]")
        ), 80);
        const misplacedModal = document.querySelector("[data-library-structure-modal]");
        const misplacedRow = document.querySelector(
          '[data-library-structure-track="smoke-track-0"]'
        );
        const currentStructurePath = document.querySelector(
          "[data-library-structure-current-path]"
        );
        const expectedStructurePath = document.querySelector(
          "[data-library-structure-expected-path]"
        );
        const repairStructureButton = document.querySelector(
          "[data-repair-library-structure]"
        );
        const structureValidationShowsTracks = Boolean(
          validateStructureButton instanceof HTMLButtonElement &&
          !validateStructureButton.disabled &&
          repairUnavailableBeforeValidation &&
          misplacedModal &&
          misplacedRow?.textContent?.includes("Smoke Track 000") &&
          misplacedRow?.textContent?.includes("Renamed Muro") &&
          currentStructurePath?.textContent?.includes("Muro") &&
          expectedStructurePath?.textContent?.includes("Renamed Muro") &&
          repairStructureButton
        );
        repairStructureButton?.click();
        await waitForCondition(() => Boolean(
          !document.querySelector("[data-library-structure-modal]") &&
          !document.querySelector("[data-show-misplaced-tracks]") &&
          document.querySelector("[data-library-structure-status]")
            ?.textContent?.includes("correct folders")
        ), 80);
        const structureStateAfter = await window.muro.invoke(
          "test_get_library_structure_state"
        );
        const structureRepairReady = Boolean(
          !document.querySelector("[data-library-structure-modal]") &&
          !document.querySelector("[data-show-misplaced-tracks]") &&
          document.querySelector("[data-library-structure-status]")
            ?.textContent?.includes("correct folders") &&
          structureStateAfter.validationCount === 2 &&
          structureStateAfter.loadTracksInvocationCount >
            structureStateBefore.loadTracksInvocationCount &&
          structureStateAfter.repairArgs?.libraryRoot === persistedWatchedFolders[0] &&
          structureStateAfter.repairArgs?.trackIds?.join(",") === "smoke-track-0"
        );

        document.querySelector('[data-settings-tab="analysis"]')?.click();
        await waitForCondition(() => Boolean(
          document.querySelector("[data-analysis-settings]") &&
          document.querySelector("[data-analysis-notation]") &&
          document.querySelector("[data-analysis-performance]")
        ));
        const analysisReady = Boolean(
          document.querySelector("[data-analysis-settings]") &&
          document.querySelector("[data-analysis-notation]") &&
          document.querySelector("[data-analysis-performance]")
        );

        document.querySelector('[data-settings-tab="dj"]')?.click();
        await waitForSelector("[data-dj-mix-feature-toggle]");
        const featureToggle = document.querySelector("[data-dj-mix-feature-toggle]");
        featureToggle?.click();
        await waitForCondition(() => {
          const bars = document.querySelector("[data-mix-bars]");
          return Boolean(
            document.querySelector('[data-settings-page="dj"]') &&
            document.querySelector("[data-dj-mix-settings]") &&
            bars instanceof HTMLSelectElement &&
            Array.from(bars.options, (option) => option.value).join(",") === "4,8,16,32"
          );
        });
        const mixBars = document.querySelector("[data-mix-bars]");
        const djReady = Boolean(
          document.querySelector('[data-settings-page="dj"]') &&
          document.querySelector("[data-dj-mix-settings]") &&
          mixBars instanceof HTMLSelectElement &&
          Array.from(mixBars.options, (option) => option.value).join(",") === "4,8,16,32"
        );

        document.querySelector('[data-settings-tab="advanced"]')?.click();
        await waitForCondition(() =>
          Boolean(document.querySelector('[data-settings-page="advanced"]')?.textContent
            ?.includes("Danger zone"))
        );
        const advancedReady = Boolean(
          document.querySelector('[data-settings-page="advanced"]')?.textContent
            ?.includes("Danger zone")
        );

        return {
          childCount: root.childElementCount,
          textLength: root.textContent?.trim().length ?? 0,
          stickyHeaderReady: true,
          settingsOrganizationReady: Boolean(
            initialCategoryCount === 6 &&
            filteredToMetadata &&
            providersReady &&
            showKeyReady &&
            libraryReady &&
            itunesExportReady &&
            firstWatchedFolderReady &&
            singleWatchedFolderReady &&
            structureValidationShowsTracks &&
            structureRepairReady &&
            analysisReady &&
            djReady &&
            advancedReady &&
            playlistTooltipsReady
          ),
          settingsOrganizationDebug: {
            initialCategoryCount,
            filteredToMetadata,
            providersReady,
            showKeyReady,
            libraryReady,
            itunesExportReady,
            itunesExportArgs,
            itunesExportStatus: itunesExportStatus?.textContent?.trim() ?? null,
            firstWatchedFolderReady,
            singleWatchedFolderReady,
            persistedWatchedFolders,
            structureValidationShowsTracks,
            structureRepairReady,
            structureStateBefore,
            structureStateAfter,
            analysisReady,
            djReady,
            advancedReady,
            playlistTooltipsReady,
            unlabeledIconButtons: unlabeledIconButtons.map(
              (button) => button.outerHTML.slice(0, 180)
            ),
            playlistActionsTooltipReady,
            playlistActionsMenuReady,
            exportTooltip: exportButton?.getAttribute("title") ?? null,
          },
        };
      }
      if (${libraryExportSmokeOnly ? "true" : "false"}) {
        if (!root?.childElementCount || !scroller) {
          return {
            childCount: root?.childElementCount ?? 0,
            textLength: root?.textContent?.trim().length ?? 0,
            stickyHeaderReady: false,
          };
        }

        window.location.hash = "#/settings";
        let libraryTab = null;
        for (let attempt = 0; attempt < 40 && !libraryTab; attempt += 1) {
          libraryTab = document.querySelector('[data-settings-tab="library"]');
          if (!libraryTab) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        libraryTab?.click();
        await waitForCondition(() => Boolean(
          document.querySelector("[data-use-export-as-current-library]") &&
          document.querySelector("[data-export-organized-library]")
        ));
        const useAsLibraryCheckbox = document.querySelector(
          "[data-use-export-as-current-library]"
        );
        useAsLibraryCheckbox?.click();
        await waitForCondition(() =>
          document.querySelector("[data-use-export-as-current-library]")?.checked === true
        );
        const exportButton = document.querySelector("[data-export-organized-library]");
        exportButton?.click();
        await waitForCondition(() => {
          const status = document.querySelector("[data-organized-library-export-status]")
            ?.textContent;
          return Boolean(
            status?.includes("Copied 250 music files") &&
            status.includes("exported 5 playlists") &&
            status.includes("Muro is now using the exported files")
          );
        }, 120);
        const exportArgs = await window.muro.invoke("test_get_organized_library_export_args");
        const exportStatus = document.querySelector("[data-organized-library-export-status]");

        return {
          childCount: root.childElementCount,
          textLength: root.textContent?.trim().length ?? 0,
          stickyHeaderReady: true,
          organizedLibraryExportReady: Boolean(
            exportButton &&
            useAsLibraryCheckbox instanceof HTMLInputElement &&
            useAsLibraryCheckbox.checked &&
            !exportButton.hasAttribute("disabled") &&
            exportArgs?.destinationPath === ${JSON.stringify(temporaryDirectory)} &&
            typeof exportArgs?.dbPath === "string" &&
            exportArgs?.useAsCurrentLibrary === true &&
            exportArgs?.rendererReloaded === true &&
            exportStatus?.textContent?.includes("Copied 250 music files") &&
            exportStatus?.textContent?.includes("exported 5 playlists") &&
            exportStatus?.textContent?.includes("Muro is now using the exported files")
          ),
          organizedLibraryExportDebug: {
            buttonFound: Boolean(exportButton),
            buttonDisabled: exportButton?.hasAttribute("disabled") ?? null,
            useAsLibraryChecked: useAsLibraryCheckbox instanceof HTMLInputElement
              ? useAsLibraryCheckbox.checked
              : null,
            exportArgs,
            status: exportStatus?.textContent?.trim() ?? null,
          },
        };
      }
      if (${artistSeparatorSmokeOnly ? "true" : "false"}) {
        if (!root?.childElementCount || !scroller) {
          return {
            childCount: root?.childElementCount ?? 0,
            textLength: root?.textContent?.trim().length ?? 0,
            stickyHeaderReady: false,
          };
        }

        window.location.hash = "#/settings";
        let artistLibraryTab = null;
        for (let attempt = 0; attempt < 40 && !artistLibraryTab; attempt += 1) {
          artistLibraryTab = document.querySelector('[data-settings-tab="library"]');
          if (!artistLibraryTab) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        artistLibraryTab?.click();
        let reviewButton = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          reviewButton = document.querySelector("[data-review-artist-separators]");
          if (reviewButton?.textContent?.trim() === "Review 2 matches") break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const reviewCountReady = reviewButton?.textContent?.trim() === "Review 2 matches";
        reviewButton?.click();
        await waitForCondition(() => {
          const proposed = document.querySelector("[data-artist-separator-proposed]");
          return Boolean(
            document.querySelector("[data-artist-separator-modal]") &&
            document.querySelector("[data-artist-separator-field]")
              ?.textContent?.trim() === "Artist" &&
            document.querySelector("[data-artist-separator-current]")
              ?.textContent?.trim() === "Muro & Guest feat. DJ Test" &&
            proposed instanceof HTMLInputElement &&
            proposed.value === "Muro, Guest, DJ Test"
          );
        });

        const modal = document.querySelector("[data-artist-separator-modal]");
        const firstField = document.querySelector("[data-artist-separator-field]");
        const currentArtist = document.querySelector("[data-artist-separator-current]");
        const proposedArtist = document.querySelector("[data-artist-separator-proposed]");
        const artistProposalReady = (
          firstField?.textContent?.trim() === "Artist" &&
          currentArtist?.textContent?.trim() === "Muro & Guest feat. DJ Test" &&
          proposedArtist instanceof HTMLInputElement &&
          proposedArtist.value === "Muro, Guest, DJ Test"
        );

        document.querySelector("[data-artist-separator-exception]")?.click();
        await waitForCondition(() => {
          const proposed = document.querySelector("[data-artist-separator-proposed]");
          return Boolean(
            document.querySelector("[data-artist-separator-field]")
              ?.textContent?.trim() === "Album artist" &&
            document.querySelector("[data-artist-separator-current]")
              ?.textContent?.trim() === "Various Artists & Muro" &&
            proposed instanceof HTMLInputElement &&
            proposed.value === "Various Artists, Muro"
          );
        });
        const secondField = document.querySelector("[data-artist-separator-field]");
        const currentAlbumArtist = document.querySelector("[data-artist-separator-current]");
        const proposedAlbumArtist = document.querySelector("[data-artist-separator-proposed]");
        const albumArtistProposalReady = (
          secondField?.textContent?.trim() === "Album artist" &&
          currentAlbumArtist?.textContent?.trim() === "Various Artists & Muro" &&
          proposedAlbumArtist instanceof HTMLInputElement &&
          proposedAlbumArtist.value === "Various Artists, Muro"
        );

        document.querySelector("[data-artist-separator-apply]")?.click();
        await waitForCondition(() => {
          let exceptions = null;
          try {
            exceptions = JSON.parse(localStorage.getItem("muro-settings") ?? "null")
              ?.state?.artistSeparatorExceptions;
          } catch {}
          return Boolean(
            !document.querySelector("[data-artist-separator-modal]") &&
            document.querySelector("[data-review-artist-separators]")
              ?.hasAttribute("disabled") &&
            Array.isArray(exceptions) &&
            exceptions.length === 1 &&
            exceptions[0] === "Muro & Guest feat. DJ Test" &&
            document.querySelector("[data-artist-separator-exceptions]")?.textContent
              ?.includes("Muro & Guest feat. DJ Test")
          );
        }, 80);
        const updates = await window.muro.invoke("test_get_artist_separator_updates");
        const savedAlbumArtistUpdate = updates[0];
        const persistedArtistExceptions = JSON.parse(
          localStorage.getItem("muro-settings") ?? "null"
        )?.state?.artistSeparatorExceptions;
        const savedExceptionReady = Boolean(
          Array.isArray(persistedArtistExceptions) &&
          persistedArtistExceptions.length === 1 &&
          persistedArtistExceptions[0] === "Muro & Guest feat. DJ Test" &&
          document.querySelector("[data-artist-separator-exceptions]")?.textContent
            ?.includes("Muro & Guest feat. DJ Test") &&
          document.querySelector(
            '[data-remove-artist-separator-exception="Muro & Guest feat. DJ Test"]'
          )
        );
        const reviewCompleted = (
          !document.querySelector("[data-artist-separator-modal]") &&
          document.querySelector("[data-review-artist-separators]")?.hasAttribute("disabled")
        );

        return {
          childCount: root.childElementCount,
          textLength: root.textContent?.trim().length ?? 0,
          stickyHeaderReady: true,
          artistSeparatorReviewReady: Boolean(
            reviewCountReady &&
            modal &&
            artistProposalReady &&
            albumArtistProposalReady &&
            savedExceptionReady &&
            reviewCompleted &&
            updates.length === 1 &&
            savedAlbumArtistUpdate?.trackIds?.length === 1 &&
            savedAlbumArtistUpdate.trackIds[0] === "smoke-track-249" &&
            savedAlbumArtistUpdate.updates?.artists === "Various Artists, Muro"
          ),
          artistSeparatorReviewDebug: {
            reviewCountReady,
            libraryTab: Boolean(artistLibraryTab),
            reviewButtonText: reviewButton?.textContent?.trim() ?? null,
            modal: Boolean(modal),
            artistProposalReady,
            albumArtistProposalReady,
            savedExceptionReady,
            reviewCompleted,
            updates,
            persistedArtistExceptions,
            exceptionList: document.querySelector("[data-artist-separator-exceptions]")
              ?.textContent?.trim() ?? null,
          },
        };
      }
      if (${autoMixQueueSmokeOnly ? "true" : "false"}) {
        if (!root?.childElementCount || !scroller) {
          return {
            childCount: root?.childElementCount ?? 0,
            textLength: root?.textContent?.trim().length ?? 0,
            stickyHeaderReady: false,
          };
        }

        window.location.hash = "#/settings";
        const djSettingsTab = await waitForSelector('[data-settings-tab="dj"]');
        djSettingsTab?.click();
        await waitForSelector("[data-dj-mix-feature-toggle]");
        const featureToggle = document.querySelector("[data-dj-mix-feature-toggle]");
        if (featureToggle instanceof HTMLInputElement && !featureToggle.checked) {
          featureToggle.click();
        }
        await waitForCondition(() => Boolean(
          document.querySelector("[data-dj-mix-feature-toggle]")?.checked === true &&
          document.querySelector("[data-dj-mix-settings]") &&
          document.querySelector("[data-mix-auto]")
        ));
        const autoMixToggle = document.querySelector("[data-mix-auto]");
        if (autoMixToggle instanceof HTMLInputElement && !autoMixToggle.checked) {
          autoMixToggle.click();
        }
        await waitForCondition(() =>
          document.querySelector("[data-mix-auto]")?.checked === true
        );

        window.location.hash = "#/";
        await waitForCondition(() => Boolean(
          window.location.hash === "#/" &&
          document.querySelector('[data-track-index="0"]')
        ));
        document.querySelector('[data-track-index="0"]')?.dispatchEvent(new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
        }));
        await waitForCondition(() =>
          document.querySelector('[data-track-index="0"][data-track-playing="true"]') !== null
        );
        document.querySelector('[data-track-index="1"]')?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 240,
        }));
        await waitForCondition(() =>
          [...document.querySelectorAll('[data-popover] button')]
            .some((button) => button.textContent?.trim() === "Add to queue")
        );
        const addToQueueButton = [...document.querySelectorAll('[data-popover] button')]
          .find((button) => button.textContent?.trim() === "Add to queue");
        addToQueueButton?.click();
        await waitForCondition(() => Boolean(
          document.querySelector('[data-queue-track]') &&
          document.querySelector('[data-track-playing="true"]')
        ), 120);
        return {
          childCount: root.childElementCount,
          textLength: root.textContent?.trim().length ?? 0,
          stickyHeaderReady: true,
          autoMixQueueResponsive: Boolean(
            addToQueueButton &&
            document.querySelector('[data-queue-track]') &&
            document.querySelector('[data-track-playing="true"]')
          ),
        };
      }
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
      const rowHeightBeforeCompact = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--table-row-height')
      );
      compactTableButton?.click();
      await waitForCondition(() => {
        const firstRow = scroller?.querySelector('[data-track-index="0"]');
        const secondRow = scroller?.querySelector('[data-track-index="1"]');
        const firstRect = firstRow?.getBoundingClientRect();
        const secondRect = secondRow?.getBoundingClientRect();
        const expectedHeight = parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--table-row-height')
        );
        return Boolean(
          firstRect &&
          secondRect &&
          Math.abs(expectedHeight - rowHeightBeforeCompact) >= 1 &&
          Math.abs(firstRect.height - expectedHeight) < 1 &&
          Math.abs(secondRect.height - expectedHeight) < 1 &&
          Math.abs(secondRect.top - firstRect.bottom) < 1
        );
      });
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
      await waitForCondition(() => {
        const restoredHeight = parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--table-row-height')
        );
        const firstRect = scroller?.querySelector('[data-track-index="0"]')
          ?.getBoundingClientRect();
        return Boolean(
          firstRect &&
          Math.abs(restoredHeight - rowHeightBeforeCompact) < 1 &&
          Math.abs(firstRect.height - restoredHeight) < 1
        );
      });
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
      const requestedColumnKeys = [
        "artists",
        "genre",
        "playCount",
        "lastPlayedAt",
        "sourcePath",
        "discNumber",
        "comment",
        "sampleRate",
        "bitDepth",
        "fileSize",
      ];
      const toggleRequestedColumns = () => {
        const labels = [...document.querySelectorAll('[data-columns-list] label')];
        for (const labelText of requestedColumnLabels) {
          const label = labels.find((item) => item.textContent?.trim() === labelText);
          label?.querySelector('input')?.click();
        }
      };
      libraryHeader?.querySelector('[data-library-columns]')?.click();
      await waitForSelector('[data-columns-list]');
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
      await waitForCondition(() => {
        const row = scroller?.querySelector('[data-track-index="0"]');
        return Boolean(
          !document.querySelector('[data-columns-list]') &&
          row &&
          requestedColumnKeys.every((key) =>
            document.querySelector('[role="columnheader"][data-column-key="' + key + '"]') &&
            row.querySelector('[data-column-key="' + key + '"]')
          )
        );
      }, 80);
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
      await waitForSelector('[data-columns-list]');
      toggleRequestedColumns();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await waitForCondition(() => Boolean(
        !document.querySelector('[data-columns-list]') &&
        requestedColumnKeys.every((key) =>
          !document.querySelector('[role="columnheader"][data-column-key="' + key + '"]') &&
          !scroller?.querySelector('[data-track-index="0"] [data-column-key="' + key + '"]')
        )
      ), 80);
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
      const playlistCreateButton = document.querySelector('[data-playlist-create]');
      const playlistActionsButton = document.querySelector('[data-playlist-actions-menu]');
      playlistActionsButton?.click();
      await waitForCondition(() => Boolean(
        document.querySelector('[data-playlist-actions-menu]')
          ?.getAttribute("aria-expanded") === "true" &&
        document.querySelector('[data-playlist-import]')?.textContent
          ?.includes("Import playlist file") &&
        document.querySelector('[data-playlist-folder-import]')?.textContent
          ?.includes("Import playlist folder") &&
        document.querySelector('[data-playlist-export-all]')?.textContent
          ?.includes("Export all playlists") &&
        document.querySelector('[data-playlist-folder-create]')
      ));
      const playlistImportButton = document.querySelector('[data-playlist-import]');
      const playlistFolderImportButton = document.querySelector('[data-playlist-folder-import]');
      const playlistExportAllButton = document.querySelector('[data-playlist-export-all]');
      const linkedPlaylistIndicatorReady = Boolean(
        document.querySelector('[data-playlist-source-linked="smoke-linked-playlist"]')
      );
      const playlistTransferControlsReady = Boolean(
        playlistCreateButton &&
        playlistActionsButton?.getAttribute("aria-expanded") === "true" &&
        playlistImportButton &&
        playlistFolderImportButton &&
        playlistExportAllButton &&
        document.querySelector('[data-playlist-folder-create]') &&
        playlistImportButton.textContent?.includes("Import playlist file") &&
        playlistFolderImportButton.textContent?.includes("Import playlist folder") &&
        playlistExportAllButton.textContent?.includes("Export all playlists")
      );
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await waitForCondition(() =>
        !document.querySelector('[data-popover]') &&
        document.querySelector('[data-playlist-actions-menu]')
          ?.getAttribute("aria-expanded") !== "true"
      );
      const collectionSection = document.querySelector('[data-sidebar-section="collection"]');
      const playlistSection = document.querySelector('[data-sidebar-section="playlists"]');
      const playlistsUnderCollection = Boolean(
        collectionSection &&
        playlistSection &&
        collectionSection.contains(playlistSection)
      );
      const collapseQueueButton = document.querySelector('[aria-label="Collapse queue"]');
      const expandedQueueWidthBeforeCollapse =
        collapseQueueButton?.closest('aside')?.getBoundingClientRect().width ?? 0;
      collapseQueueButton?.click();
      await waitForCondition(() => {
        const button = document.querySelector('[aria-label="Expand queue"]');
        const panel = button?.closest('aside');
        return Boolean(
          button &&
          panel &&
          panel.querySelectorAll('button').length === 1 &&
          panel.querySelectorAll('svg').length === 1 &&
          Math.abs(panel.getBoundingClientRect().width - 40) < 0.1
        );
      }, 80);
      const expandQueueButton = document.querySelector('[aria-label="Expand queue"]');
      const collapsedQueuePanel = expandQueueButton?.closest('aside');
      const collapsedQueueControlsReady = Boolean(
        expandQueueButton &&
        collapsedQueuePanel?.querySelectorAll('button').length === 1 &&
        collapsedQueuePanel?.querySelectorAll('svg').length === 1
      );
      const collapsedQueueWidth = collapsedQueuePanel?.getBoundingClientRect().width ?? 0;
      expandQueueButton?.click();
      await waitForCondition(() => {
        const button = document.querySelector('[aria-label="Collapse queue"]');
        const panelWidth = button?.closest('aside')?.getBoundingClientRect().width ?? 0;
        return Boolean(
          button &&
          expandedQueueWidthBeforeCollapse > 0 &&
          Math.abs(panelWidth - expandedQueueWidthBeforeCollapse) < 0.1
        );
      }, 80);
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
        scroller.scrollLeft = scroller.scrollWidth;
        scroller.dispatchEvent(new Event("scroll"));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const farRightScrollLeft = scroller.scrollLeft;
        const farRightHeaderScrollLeft = headerScroller.scrollLeft;
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
        await waitForSelector('[data-testid="search-album-metadata-menu-item"]');
        const tableAlbumMetadataMenuReady = Boolean(
          document.querySelector('[data-testid="search-album-metadata-menu-item"]')?.textContent?.includes("Search for album metadata")
        );
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await waitForCondition(() => !document.querySelector('[data-popover]'));
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
        const ratingStarsRedReady = getComputedStyle(
          thirdRatingStar?.querySelector("[data-rating-fill]") ?? document.documentElement
        ).color === "rgb(239, 51, 64)";
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
        await requireCondition("first track selection and table focus", () => Boolean(
          document.activeElement === scroller &&
          firstTrackRow?.getAttribute("data-track-selected") === "true"
        ), 480);
        const tableFocusedAfterClick = document.activeElement === scroller;
        scroller.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }));
        await requireCondition("ArrowDown track selection", () => Boolean(
          scroller.querySelector('[data-track-selected="true"]')
            ?.getAttribute("data-track-index") === "1" &&
          document.querySelector('[data-selection-edit]')
        ), 480);
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
        await waitForSelector('[data-edit-track-modal]');
        await requireCondition("edit metadata form initialization", () => {
          const artist = document.querySelector('[data-autocomplete-field="artist"]');
          const albumArtist = document.querySelector('[data-autocomplete-field="albumArtist"]');
          const button = document.querySelector('[data-testid="same-as-artist"]');
          return Boolean(
            artist instanceof HTMLInputElement &&
            artist.value === "Muro" &&
            albumArtist instanceof HTMLInputElement &&
            albumArtist.value === "Muro" &&
            button instanceof HTMLButtonElement &&
            button.disabled
          );
        }, 480);
        const autocompleteFieldsReady = [
          ["artist", "Muro"],
          ["albumArtist", "Muro"],
          ["album", "Smoke Album 00"],
          ["genre", "Electronic"],
          ["label", "Muro Records"],
        ].every(([field, expected]) => {
          const input = document.querySelector('[data-autocomplete-field="' + field + '"]');
          const listId = input?.getAttribute("list");
          const list = listId ? document.getElementById(listId) : null;
          return list instanceof HTMLDataListElement &&
            [...list.options].some((option) => option.value === expected);
        });
        const artistEditInput = document.querySelector('[data-autocomplete-field="artist"]');
        const albumArtistEditInput = document.querySelector('[data-autocomplete-field="albumArtist"]');
        const sameAsArtistButton = document.querySelector('[data-testid="same-as-artist"]');
        const sameAsArtistInitiallyDisabled = sameAsArtistButton instanceof HTMLButtonElement &&
          sameAsArtistButton.disabled;
        const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (artistEditInput instanceof HTMLInputElement && nativeValueSetter) {
          nativeValueSetter.call(artistEditInput, "Copied Artist");
          artistEditInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await requireCondition("edited artist value and Same as Artist action", () => {
          const artist = document.querySelector('[data-autocomplete-field="artist"]');
          const button = document.querySelector('[data-testid="same-as-artist"]');
          return artist instanceof HTMLInputElement &&
            artist.value === "Copied Artist" &&
            button instanceof HTMLButtonElement &&
            !button.disabled;
        }, 480);
        const sameAsArtistEnabled = true;
        const enabledSameAsArtistButton = document.querySelector('[data-testid="same-as-artist"]');
        enabledSameAsArtistButton?.click();
        await requireCondition("album artist copy from edited artist", () => {
          const input = document.querySelector('[data-autocomplete-field="albumArtist"]');
          const button = document.querySelector('[data-testid="same-as-artist"]');
          return input instanceof HTMLInputElement &&
            input.value === "Copied Artist" &&
            button instanceof HTMLButtonElement &&
            button.disabled;
        }, 480);
        const albumArtistCopied = true;
        const sameAsArtistReady = Boolean(
          sameAsArtistInitiallyDisabled &&
          sameAsArtistEnabled &&
          albumArtistEditInput instanceof HTMLInputElement &&
          albumArtistCopied
        );
        const editCoverField = document.querySelector('[data-cover-art-field]');
        editCoverField?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForSelector('[data-testid="fetch-cover-art-menu-item"]');
        const fetchCoverMenuItem = document.querySelector('[data-testid="fetch-cover-art-menu-item"]');
        const pasteCoverMenuItem = document.querySelector('[data-testid="paste-cover-art-menu-item"]');
        const copyCoverMenuItem = document.querySelector('[data-testid="copy-cover-art-menu-item"]');
        const manualCoverMenuReady = Boolean(
          fetchCoverMenuItem &&
          copyCoverMenuItem instanceof HTMLButtonElement &&
          copyCoverMenuItem.disabled &&
          pasteCoverMenuItem instanceof HTMLButtonElement &&
          pasteCoverMenuItem.disabled
        );
        fetchCoverMenuItem?.click();
        await waitForCondition(() => Boolean(
          document.querySelector('[data-cover-art-field] img')
        ));
        const coverCounts = await window.muro.invoke("test_get_cover_counts");
        const manualCoverFetchReady = Boolean(
          coverCounts.manualCoverFetchCount === 1 &&
          editCoverField?.querySelector("img")
        );
        editCoverField?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForCondition(() => {
          const item = document.querySelector('[data-testid="copy-cover-art-menu-item"]');
          return item instanceof HTMLButtonElement && !item.disabled;
        });
        const copyFetchedCoverItem = document.querySelector('[data-testid="copy-cover-art-menu-item"]');
        const copyCoverEnabled = copyFetchedCoverItem instanceof HTMLButtonElement && !copyFetchedCoverItem.disabled;
        copyFetchedCoverItem?.click();
        await waitForCondition(() =>
          [...document.querySelectorAll(".fixed.bottom-4.right-4 p")].some((message) =>
            message.textContent?.includes("Cover art copied to the clipboard.")
          )
        );
        const copyCounts = await window.muro.invoke("test_get_cover_counts");
        const manualCoverCopyReady = Boolean(
          copyCoverEnabled &&
          copyCounts.copiedCoverPaths.length === 1 &&
          copyCounts.copiedCoverPaths[0]?.endsWith("track-0.wav")
        );
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent?.trim() === "Cancel")
          ?.click();
        await waitForCondition(() => !document.querySelector('[data-edit-track-modal]'));
        document.querySelector('[data-selection-edit]')?.click();
        await waitForSelector('[data-edit-track-modal]');
        const albumCoverField = document.querySelector('[data-cover-art-field]');
        albumCoverField?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForSelector('[data-testid="fetch-cover-art-menu-item"]');
        document.querySelector('[data-testid="fetch-cover-art-menu-item"]')?.click();
        await waitForCondition(() => Boolean(
          document.querySelector('[data-cover-art-field] img')
        ));
        [...(document.querySelector('[data-edit-track-modal]')?.querySelectorAll("button") ?? [])]
          .find((button) => button.textContent?.trim() === "Save")
          ?.click();
        await waitForCondition(() => !document.querySelector('[data-edit-track-modal]'));
        const metadataUpdates = await window.muro.invoke("test_get_metadata_updates");
        const albumCoverUpdate = [...metadataUpdates].reverse().find(
          (entry) => typeof entry.updates?.coverArtPath === "string"
        );
        const expectedSelectedTrackId = "smoke-track-" + (selectedAfterArrowDown ?? "1");
        const coverAppliedToSelectionReady = Boolean(
          albumCoverUpdate?.trackIds?.length === 1 &&
          albumCoverUpdate.trackIds[0] === expectedSelectedTrackId
        );
        await window.muro.invoke("test_enable_brave_cover_fallback");
        document.querySelector('[data-selection-edit]')?.click();
        await waitForSelector('[data-edit-track-modal]');
        const braveFallbackCoverField = document.querySelector('[data-cover-art-field]');
        braveFallbackCoverField?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForSelector('[data-testid="fetch-cover-art-menu-item"]');
        document.querySelector('[data-testid="fetch-cover-art-menu-item"]')?.click();
        await waitForCondition(() =>
          document.querySelectorAll('[data-album-cover-candidate]').length === 2
        );
        const braveCoverCandidates = [...document.querySelectorAll('[data-album-cover-candidate]')];
        const secondBraveCoverButton = braveCoverCandidates[1]?.querySelector('[role="radio"]');
        secondBraveCoverButton?.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const braveCoverSelectionReady =
          secondBraveCoverButton?.getAttribute("aria-checked") === "true";
        document.querySelector('[data-apply-album-cover]')?.click();
        await waitForCondition(() => Boolean(
          !document.querySelector('[data-album-cover-picker]') &&
          document.querySelector('[data-cover-art-field] img') &&
          [...document.querySelectorAll(".fixed.bottom-4.right-4 p")].some((message) =>
            message.textContent?.includes("Cover selected from Brave Image Search")
          )
        ));
        const braveCoverCounts = await window.muro.invoke("test_get_cover_counts");
        const braveCoverPickerReady = Boolean(
          braveCoverCandidates.length === 2 &&
          braveCoverSelectionReady &&
          !document.querySelector('[data-album-cover-picker]') &&
          braveCoverCounts.braveCoverCacheCount === 1 &&
          braveCoverCounts.selectedBraveCoverId === "brave-cover-two" &&
          document.querySelector('[data-cover-art-field] img')
        );
        [...(document.querySelector('[data-edit-track-modal]')?.querySelectorAll("button") ?? [])]
          .find((button) => button.textContent?.trim() === "Cancel")
          ?.click();
        await waitForCondition(() => !document.querySelector('[data-edit-track-modal]'));
        document.querySelector('[aria-label="Select all tracks"]')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        document.querySelector('[data-selection-edit]')?.click();
        await waitForCondition(() => {
          const modal = document.querySelector('[data-edit-track-modal]');
          const artist = modal?.querySelector('[data-autocomplete-field="artist"]');
          const albumArtist = modal?.querySelector('[data-autocomplete-field="albumArtist"]');
          return Boolean(
            modal?.textContent?.includes("250") &&
            artist instanceof HTMLInputElement &&
            artist.placeholder === "Mixed values" &&
            albumArtist instanceof HTMLInputElement &&
            albumArtist.value === "Muro"
          );
        });
        const batchEditModal = document.querySelector('[data-edit-track-modal]');
        const batchArtistInput = batchEditModal?.querySelector('[data-autocomplete-field="artist"]');
        const batchAlbumArtistInput = batchEditModal?.querySelector('[data-autocomplete-field="albumArtist"]');
        const batchAlbumInput = batchEditModal?.querySelector('[data-autocomplete-field="album"]');
        const batchGenreInput = batchEditModal?.querySelector('[data-autocomplete-field="genre"]');
        const batchLabelInput = batchEditModal?.querySelector('[data-autocomplete-field="label"]');
        const batchCommonValuesReady = Boolean(
          batchEditModal?.textContent?.includes("250") &&
          batchArtistInput instanceof HTMLInputElement && batchArtistInput.value === "" &&
          batchArtistInput.placeholder === "Mixed values" &&
          batchAlbumArtistInput instanceof HTMLInputElement && batchAlbumArtistInput.value === "Muro" &&
          batchAlbumInput instanceof HTMLInputElement && batchAlbumInput.value === "" &&
          batchAlbumInput.placeholder === "Mixed values" &&
          batchGenreInput instanceof HTMLInputElement && batchGenreInput.value === "" &&
          batchGenreInput.placeholder === "Mixed values" &&
          batchLabelInput instanceof HTMLInputElement && batchLabelInput.value === "" &&
          batchLabelInput.placeholder === "Mixed values" &&
          !batchEditModal.querySelector('[data-mixed-field="rating"]')
        );
        [...(batchEditModal?.querySelectorAll("button") ?? [])]
          .find((button) => button.textContent?.trim() === "Cancel")
          ?.click();
        await waitForCondition(() => !document.querySelector('[data-edit-track-modal]'));
        const restoreSelectedRow = document.querySelector(
          '[data-track-index="' + (selectedAfterArrowDown ?? "1") + '"]'
        );
        restoreSelectedRow?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
        await waitForCondition(() => {
          const row = scroller.querySelector('[data-track-playing="true"]');
          return Boolean(
            row?.getAttribute("data-track-index") === "1" &&
            getComputedStyle(row).backgroundColor.startsWith("rgba(239, 51, 64,") &&
            document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Pause" &&
            navigator.mediaSession?.metadata?.title === "Smoke Track 001" &&
            navigator.mediaSession.playbackState === "playing"
          );
        });
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
        scroller.querySelector('[data-track-index="2"]')?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        scroller.dispatchEvent(new KeyboardEvent("keydown", {
          key: "q",
          code: "KeyQ",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        playingTrackRow?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        scroller.dispatchEvent(new KeyboardEvent("keydown", {
          key: "r",
          code: "KeyR",
          bubbles: true,
          cancelable: true,
        }));
        scroller.dispatchEvent(new KeyboardEvent("keydown", {
          key: "r",
          code: "KeyR",
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const repeatOneButtonReady = document.querySelector('button[title="Repeat one"]') !== null;
        const queuedTrackCountBeforeRepeat = document.querySelectorAll('[data-queue-track]').length;
        const mediaSessionMetadataBeforeRepeat = navigator.mediaSession?.metadata;
        await window.muro.invoke("test_emit_track_ended");
        const repeatOneTransitionReady = await waitForCondition(() =>
          navigator.mediaSession?.metadata !== mediaSessionMetadataBeforeRepeat &&
          document.querySelectorAll('[data-queue-track]').length === queuedTrackCountBeforeRepeat &&
          scroller.querySelector('[data-track-playing="true"]')
            ?.getAttribute("data-track-index") === playingAfterSpace &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Pause" &&
          navigator.mediaSession?.playbackState === "playing"
        );
        const repeatOneReady = Boolean(
          repeatOneTransitionReady &&
          repeatOneButtonReady &&
          queuedTrackCountBeforeRepeat > 0 &&
          document.querySelectorAll('[data-queue-track]').length === queuedTrackCountBeforeRepeat &&
          scroller.querySelector('[data-track-playing="true"]')
            ?.getAttribute("data-track-index") === playingAfterSpace
        );
        const repeatOneDebug = {
          repeatOneButtonReady,
          repeatOneTransitionReady,
          queuedTrackCountBeforeRepeat,
          playingAfterSpace,
          playingAfterRepeat: scroller.querySelector('[data-track-playing="true"]')
            ?.getAttribute("data-track-index") ?? null,
        };
        document.querySelector('button[title="Remove from queue"]')?.click();
        const queueClearedAfterRepeat = await waitForCondition(() =>
          !document.querySelector('[data-queue-track]')
        );
        const playerMetadata = document.querySelector("[data-player-track-metadata]");
        const playerRatingControl = playerMetadata?.querySelector('[role="slider"]');
        const fourthPlayerRatingStar = playerMetadata?.querySelector('[data-rating-star="4"]');
        const fourthPlayerRatingRect = fourthPlayerRatingStar?.getBoundingClientRect();
        const playerMetadataReady = Boolean(
          playerMetadata?.textContent?.includes("— BPM") &&
          playerMetadata.textContent.includes("8A") &&
          playerRatingControl?.getAttribute("aria-valuenow") === "0"
        );
        const volumeControlGroup = document.querySelector(".player-volume-control")?.parentElement;
        const playerVolumeEndSpacingReady = volumeControlGroup
          ? Number.parseFloat(getComputedStyle(volumeControlGroup).paddingRight) >= 8
          : false;
        const queueOutputRemoved = !document.querySelector("[data-output-footer]");
        if (fourthPlayerRatingStar && fourthPlayerRatingRect) {
          fourthPlayerRatingStar.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: fourthPlayerRatingRect.right - 1,
          }));
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const playerRatingSetToFour = playerRatingControl?.getAttribute("aria-valuenow") === "4";
        if (fourthPlayerRatingStar && fourthPlayerRatingRect) {
          fourthPlayerRatingStar.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: fourthPlayerRatingRect.left + 1,
          }));
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const playerRatingClearsToZero = playerRatingControl?.getAttribute("aria-valuenow") === "0";
        scroller.dispatchEvent(new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
          cancelable: true,
        }));
        const pausedRowSelector = '[data-track-index="' + playingAfterSpace + '"][data-track-playing="true"]';
        await waitForCondition(() => {
          const row = scroller.querySelector(pausedRowSelector);
          return Boolean(
            document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Play" &&
            navigator.mediaSession?.playbackState === "paused" &&
            row &&
            getComputedStyle(row).backgroundColor.startsWith("rgba(148, 163, 184,")
          );
        });
        const pausedTrackRow = scroller.querySelector(pausedRowSelector);
        const pausedAfterSecondSpace = document.querySelector(".player-bar-play-button")
          ?.getAttribute("title") === "Play";
        const pausedRowColor = pausedTrackRow
          ? getComputedStyle(pausedTrackRow).backgroundColor
          : "";
        const pausedRowUsesGreyHighlight = pausedRowColor.startsWith("rgba(148, 163, 184,");
        const mediaSessionPausedReady = navigator.mediaSession?.playbackState === "paused";
        document.querySelector("[data-output-button]")?.click();
        const castOutputDevice = await waitForSelector('[data-output-device="cast:cast-smoke"]');
        castOutputDevice?.click();
        const remoteFallbackOutcomeReady = await waitForCondition(() => {
          const notifications = [...document.querySelectorAll(".fixed.bottom-4.right-4 p")];
          const restoreFailed = notifications.some((message) =>
            message.textContent?.includes("Local playback could not be restored automatically.")
          );
          const restoreSucceeded = notifications.some((message) =>
            message.textContent?.includes("Local playback is ready and paused at the handoff position.")
          );
          return restoreFailed || Boolean(
            restoreSucceeded &&
            document.querySelector("[data-output-button]")?.getAttribute("data-output-state") === "idle" &&
            document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Play"
          );
        }, 480);
        if (!remoteFallbackOutcomeReady) {
          throw new Error("Timed out waiting for Cast fallback to finish");
        }
        const remoteFallbackMessages = [...document.querySelectorAll(".fixed.bottom-4.right-4 p")]
          .map((message) => message.textContent?.trim() ?? "");
        const remoteFallbackReady = Boolean(
          document.querySelector("[data-output-button]")?.getAttribute("data-output-state") === "idle" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Play" &&
          remoteFallbackMessages.some((message) =>
            message.includes("Local playback is ready and paused at the handoff position.")
          )
        );
        if (!remoteFallbackReady) {
          throw new Error(
            "Cast fallback finished without restoring paused local playback: " +
            JSON.stringify(remoteFallbackMessages)
          );
        }
        await window.muro.invoke("test_emit_media_control", { action: "next" });
        await requireCondition("media next transition after Cast fallback", () =>
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "2" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Pause"
        );
        const mediaNextTrackIndex = scroller.querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        await window.muro.invoke("test_emit_media_control", { action: "previous" });
        await requireCondition("media previous transition after Cast fallback", () =>
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "1" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Pause"
        );
        const mediaPreviousTrackIndex = scroller.querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "next", source: "global-shortcut" },
        });
        await requireCondition("global shortcut next transition", () =>
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "2" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Pause"
        );
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "toggle", source: "global-shortcut" },
        });
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "pause", source: "media-session" },
        });
        await requireCondition("media pause after shortcut toggle", () =>
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "2" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Play" &&
          navigator.mediaSession?.playbackState === "paused"
        );
        const mediaPausedAfterSkip = Boolean(
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "2" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Play"
        );
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "next", source: "global-shortcut" },
        });
        await requireCondition("global shortcut next while paused", () =>
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "3" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Pause"
        );
        const mediaNextAfterPauseIndex = scroller.querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "toggle", source: "global-shortcut" },
        });
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "pause", source: "media-session" },
        });
        await requireCondition("media pause on advanced track", () =>
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "3" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Play" &&
          navigator.mediaSession?.playbackState === "paused"
        );
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "toggle", source: "global-shortcut" },
        });
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "play", source: "media-session" },
        });
        await requireCondition("media resume after pause", () =>
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "3" &&
          document.querySelector(".player-bar-play-button")?.getAttribute("title") === "Pause" &&
          navigator.mediaSession?.playbackState === "playing"
        );
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
        await requireCondition("first previous transition after resume", () =>
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "2"
        );
        await window.muro.invoke("test_emit_media_control", {
          payload: { action: "previous", source: "global-shortcut" },
        });
        await requireCondition("second previous transition after resume", () =>
          scroller.querySelector('[data-track-playing="true"]')?.getAttribute("data-track-index") === "1"
        );
        const mediaPreviousAfterResumeIndex = scroller
          .querySelector('[data-track-playing="true"]')
          ?.getAttribute("data-track-index");
        document.querySelector('[data-panel-view="mix"]')?.click();
        await requireCondition("mix suggestions and filters", () =>
          document.querySelectorAll('[data-mix-suggestion]').length >= 3 &&
          Boolean(document.querySelector('[data-mix-filter-bpm]')) &&
          Boolean(document.querySelector('[data-mix-filter-rating]')) &&
          Boolean(document.querySelector('[data-mix-filter-genre]')) &&
          Boolean(document.querySelector('[data-mix-sort]'))
        );
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
        await waitForCondition(() => {
          const grid = document.querySelector('[style*="--queue-width"]');
          return Boolean(
            grid &&
            parseFloat(getComputedStyle(grid).getPropertyValue("--queue-width")) >= 480
          );
        });
        const appGrid = document.querySelector('[style*="--queue-width"]');
        const expandedQueueWidth = appGrid
          ? parseFloat(getComputedStyle(appGrid).getPropertyValue("--queue-width"))
          : 0;
        const mixExpanded = expandedQueueWidth >= 480;
        document.querySelector('[data-mix-expand]')?.click();
        await waitForCondition(() => {
          const grid = document.querySelector('[style*="--queue-width"]');
          return Boolean(
            grid &&
            parseFloat(getComputedStyle(grid).getPropertyValue("--queue-width")) < 480
          );
        });
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
        await waitForCondition(() => {
          const suggestions = [...document.querySelectorAll('[data-mix-suggestion]')];
          return Boolean(
            document.querySelector('[data-camelot-selected="true"]')
              ?.getAttribute("data-camelot-code") === "9A" &&
            suggestions.length > 0 &&
            suggestions.every((suggestion) => suggestion.getAttribute("data-mix-code") === "9A")
          );
        });
        const selectedCamelotCode = document.querySelector('[data-camelot-selected="true"]')
          ?.getAttribute("data-camelot-code");
        const filteredMixSuggestions = Array.from(document.querySelectorAll('[data-mix-suggestion]'));
        const wheelFilteredTo9A = filteredMixSuggestions.length > 0 && filteredMixSuggestions.every(
          (suggestion) => suggestion.getAttribute("data-mix-code") === "9A"
        );
        const mixPlayNextButton = filteredMixSuggestions[0]?.querySelector('[data-mix-play-next]');
        const queuedMixTitle = mixPlayNextButton?.getAttribute("aria-label")
          ?.replace(/^Play /, "")
          .replace(/ next$/, "") ?? null;
        mixPlayNextButton?.click();
        document.querySelector('[data-panel-view="queue"]')?.click();
        const mixQueueTransitionReady = await waitForCondition(() => {
          const queuedTracks = document.querySelectorAll('[data-queue-track]');
          return Boolean(
            queueClearedAfterRepeat &&
            document.querySelector('[data-queue-section="queue"]') &&
            queuedTracks.length === 1
          );
        });
        const queuedFromMix = Boolean(
          mixQueueTransitionReady &&
          document.querySelectorAll('[data-queue-track]').length === 1
        );
        const queuedFromMixDebug = {
          queueClearedAfterRepeat,
          mixQueueTransitionReady,
          queuedMixTitle,
          queueTexts: [...document.querySelectorAll('[data-queue-track]')]
            .map((track) => track.textContent?.trim() ?? null),
        };
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
        await waitForSelector('[data-testid="add-to-playlist-menu-item"]');
        document.querySelector('[data-testid="add-to-playlist-menu-item"]')?.click();
        await waitForCondition(() => Boolean(
          document.querySelector('[data-playlist-choices]') &&
          document.querySelector('[data-playlist-choice="smoke-playlist"]') &&
          document.querySelector('[data-playlist-choice="smoke-empty-playlist"]')
        ));
        const playlistChoicesReady = Boolean(
          document.querySelector('[data-playlist-choices]') &&
          document.querySelector('[data-playlist-choice="smoke-playlist"]') &&
          document.querySelector('[data-playlist-choice="smoke-empty-playlist"]')
        );
        document.querySelector('[data-playlist-choice="smoke-empty-playlist"]')?.click();
        await waitForCondition(() =>
          Number(
            document.querySelector('[data-playlist-id="smoke-empty-playlist"] .sidebar-count')
              ?.textContent?.replace(/[^0-9]/g, "") ?? 0
          ) > 0 &&
          !document.querySelector('[data-popover]')
        );
        const emptyPlaylistCount = Number(
          document.querySelector('[data-playlist-id="smoke-empty-playlist"] .sidebar-count')
            ?.textContent?.replace(/[^0-9]/g, "") ?? 0
        );
        const contextAddToPlaylistReady = playlistChoicesReady && emptyPlaylistCount > 0;
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }));
        await waitForCondition(() =>
          Number(
            document.querySelector('[data-playlist-id="smoke-empty-playlist"] .sidebar-count')
              ?.textContent?.replace(/[^0-9]/g, "") ?? 0
          ) === 0 &&
          [...document.querySelectorAll(".fixed.bottom-4.right-4 p")].some((message) =>
            message.textContent?.includes('Restored "Empty Mix" to its previous 0 tracks.')
          )
        );
        const countAfterPlaylistUndo = Number(
          document.querySelector('[data-playlist-id="smoke-empty-playlist"] .sidebar-count')
            ?.textContent?.replace(/[^0-9]/g, "") ?? 0
        );
        const truthfulPlaylistUndoReady = Boolean(
          countAfterPlaylistUndo === 0 &&
          [...document.querySelectorAll(".fixed.bottom-4.right-4 p")].some((message) =>
            message.textContent?.includes('Restored "Empty Mix" to its previous 0 tracks.')
          )
        );
        const visiblePlaylistRows = [...scroller.querySelectorAll("[data-track-index]")];
        const existingNextPlaylistTitles = new Set([
          "Smoke Track 000",
          "Smoke Track 010",
          "Smoke Track 020",
        ]);
        const rowTitle = (row) =>
          row.querySelector('[data-column-key="title"]')?.textContent?.trim() ?? "";
        const duplicatePlaylistRow = visiblePlaylistRows.find((row) =>
          existingNextPlaylistTitles.has(rowTitle(row))
        );
        const novelPlaylistRow = visiblePlaylistRows.find((row) =>
          !existingNextPlaylistTitles.has(rowTitle(row))
        );
        duplicatePlaylistRow?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        novelPlaylistRow?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        duplicatePlaylistRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForSelector('[data-testid="add-to-playlist-menu-item"]');
        document.querySelector('[data-testid="add-to-playlist-menu-item"]')?.click();
        await waitForSelector('[data-playlist-choice="smoke-next-playlist"]');
        document.querySelector('[data-playlist-choice="smoke-next-playlist"]')?.click();
        await waitForCondition(() =>
          [...document.querySelectorAll("button")]
            .some((button) => button.textContent?.trim() === "Add non-duplicates") &&
          !document.querySelector('[data-popover]')
        );
        const addNonDuplicatesButton = [...document.querySelectorAll("button")]
          .find((button) => button.textContent?.trim() === "Add non-duplicates");
        addNonDuplicatesButton?.click();
        await waitForCondition(() =>
          Number(
            document.querySelector('[data-playlist-id="smoke-next-playlist"] .sidebar-count')
              ?.textContent?.replace(/[^0-9]/g, "") ?? 0
          ) === 4 &&
          ![...document.querySelectorAll("button")]
            .some((button) => button.textContent?.trim() === "Add non-duplicates")
        );
        const mixedDuplicateAddedCount = Number(
          document.querySelector('[data-playlist-id="smoke-next-playlist"] .sidebar-count')
            ?.textContent?.replace(/[^0-9]/g, "") ?? 0
        );
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }));
        await waitForCondition(() =>
          Number(
            document.querySelector('[data-playlist-id="smoke-next-playlist"] .sidebar-count')
              ?.textContent?.replace(/[^0-9]/g, "") ?? 0
          ) === 3 &&
          [...document.querySelectorAll(".fixed.bottom-4.right-4 p")].some((message) =>
            message.textContent?.includes('Restored "Next Context" to its previous 3 tracks.')
          )
        );
        const mixedDuplicateUndoCount = Number(
          document.querySelector('[data-playlist-id="smoke-next-playlist"] .sidebar-count')
            ?.textContent?.replace(/[^0-9]/g, "") ?? 0
        );
        const mixedDuplicateUndoReady = Boolean(
          addNonDuplicatesButton &&
          mixedDuplicateAddedCount === 4 &&
          mixedDuplicateUndoCount === 3 &&
          [...document.querySelectorAll(".fixed.bottom-4.right-4 p")].some((message) =>
            message.textContent?.includes('Restored "Next Context" to its previous 3 tracks.')
          )
        );
        const mixedDuplicateUndoDebug = {
          button: Boolean(addNonDuplicatesButton),
          duplicateTitle: duplicatePlaylistRow ? rowTitle(duplicatePlaylistRow) : null,
          novelTitle: novelPlaylistRow ? rowTitle(novelPlaylistRow) : null,
          addedCount: mixedDuplicateAddedCount,
          undoCount: mixedDuplicateUndoCount,
          messages: [...document.querySelectorAll(".fixed.bottom-4.right-4 p")]
            .map((message) => message.textContent),
        };
        const nativeDragRows = [...scroller.querySelectorAll("[data-track-index]")].slice(0, 2);
        nativeDragRows[0]?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        nativeDragRows[1]?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const dragPlaylistTarget = document.querySelector(
          '[data-playlist-target="smoke-drag-playlist"]'
        );
        let dragAddToPlaylistReady = false;
        let nativeMultiFileDragReady = false;
        let nativeDragDefaultPrevented = false;
        if (nativeDragRows[0] && dragPlaylistTarget) {
          const dataTransfer = new DataTransfer();
          const dragStartEvent = new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: 100,
            clientY: 100,
          });
          nativeDragRows[0].dispatchEvent(dragStartEvent);
          nativeDragDefaultPrevented = dragStartEvent.defaultPrevented;
          dragPlaylistTarget.dispatchEvent(new DragEvent("dragenter", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: 120,
            clientY: 120,
          }));
          dragPlaylistTarget.dispatchEvent(new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: 120,
            clientY: 120,
          }));
          dragPlaylistTarget.dispatchEvent(new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: 120,
            clientY: 120,
          }));
          nativeDragRows[0].dispatchEvent(new DragEvent("dragend", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          }));
          await waitForCondition(() =>
            Number(
              document.querySelector('[data-playlist-id="smoke-drag-playlist"] .sidebar-count')
                ?.textContent?.replace(/[^0-9]/g, "") ?? 0
            ) > 0
          );
          const dragPlaylistCount = Number(
            document.querySelector('[data-playlist-id="smoke-drag-playlist"] .sidebar-count')
              ?.textContent?.replace(/[^0-9]/g, "") ?? 0
          );
          dragAddToPlaylistReady = dragPlaylistCount > 0;
          nativeMultiFileDragReady = nativeDragRows.every(
            (row) => row.getAttribute("data-native-file-draggable") === "true"
          );
        }
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: window.innerWidth - 4,
          clientY: window.innerHeight - 4,
        }));
        const contextMenuViewportReady = await waitForCondition(() => {
          const menu = document.querySelector('[data-popover]');
          const rect = menu?.getBoundingClientRect();
          return Boolean(
            rect &&
            rect.left >= 7 &&
            rect.top >= 7 &&
            rect.right <= window.innerWidth - 7 &&
            rect.bottom <= window.innerHeight - 7 &&
            menu?.getAttribute("data-popover-horizontal") === "left" &&
            menu?.getAttribute("data-popover-vertical") === "up"
          );
        });
        const edgeContextMenu = document.querySelector('[data-popover]');
        const contextMenuOpened = Boolean(edgeContextMenu);
        document.querySelector('[data-popover]')?.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const contextMenuStayedOpenInside = Boolean(document.querySelector('[data-popover]'));
        document.querySelector('[data-track-table-header-scroll]')?.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
        }));
        const contextMenuClosedOutside = await waitForCondition(
          () => !document.querySelector('[data-popover]')
        );
        firstTrackRow?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        }));
        await waitForCondition(() =>
          firstTrackRow?.getAttribute("data-track-selected") === "true"
        );
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForSelector('[data-testid="show-in-finder-menu-item"]');
        const showInFinderItem = document.querySelector('[data-testid="show-in-finder-menu-item"]');
        const expectedShowInFolderLabel =
          window.muro?.platform === "darwin" ? "Show in Finder" : "Show in folder";
        const showInFinderReady = Boolean(
          showInFinderItem?.textContent?.includes(expectedShowInFolderLabel)
        );
        showInFinderItem?.click();
        await waitForCondition(() => !document.querySelector('[data-popover]'));
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForCondition(() =>
          Boolean(
            document.querySelector('[data-testid="search-metadata-menu-item"]') &&
            document.querySelector('[data-testid="identify-acoustid-menu-item"]')
          )
        );
        const searchMetadataItem = document.querySelector('[data-testid="search-metadata-menu-item"]');
        const searchMetadataMenuReady = Boolean(
          searchMetadataItem?.textContent?.includes("Search for metadata")
        );
        const acoustIdMenuItem = document.querySelector('[data-testid="identify-acoustid-menu-item"]');
        const acoustIdMenuReady = Boolean(
          acoustIdMenuItem?.textContent?.includes("Identify with AcoustID")
        );
        acoustIdMenuItem?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector("[data-acoustid-modal]") &&
            document.querySelector("[data-acoustid-row]") &&
            document.querySelector("[data-acoustid-candidate-select]") &&
            document.querySelector("[data-apply-acoustid]")
          )
        );
        const acoustIdModal = document.querySelector("[data-acoustid-modal]");
        const acoustIdModalReady = Boolean(
          acoustIdModal &&
          document.querySelector("[data-acoustid-row]") &&
          document.querySelector("[data-acoustid-candidate-select]") &&
          document.querySelector("[data-apply-acoustid]")
        );
        [...(acoustIdModal?.querySelectorAll("button") ?? [])]
          .find((button) => button.textContent?.trim() === "Cancel")
          ?.click();
        await waitForCondition(() => !document.querySelector("[data-acoustid-modal]"));
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForSelector('[data-testid="search-metadata-menu-item"]');
        document.querySelector('[data-testid="search-metadata-menu-item"]')?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector("[data-metadata-search-modal]") &&
            document.querySelector("[data-metadata-candidate]") &&
            document.querySelector("[data-apply-metadata]")
          )
        );
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
        await waitForCondition(() => !document.querySelector("[data-metadata-search-modal]"));
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForSelector('[data-testid="delete-track-menu-item"]');
        document.querySelector('[data-testid="delete-track-menu-item"]')?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector('[data-delete-tracks-modal]') &&
            document.querySelector('[data-delete-library-only]') &&
            document.querySelector('[data-delete-from-disk]')
          )
        );
        const deleteModalReady = Boolean(
          document.querySelector('[data-delete-tracks-modal]') &&
          document.querySelector('[data-delete-library-only]') &&
          document.querySelector('[data-delete-from-disk]')
        );
        const initialLibraryPreference = Boolean(
          document.querySelector('[data-delete-library-only][data-delete-preferred="true"]')
        );
        document.querySelector('[data-delete-from-disk]')?.click();
        await waitForCondition(() => {
          try {
            return (
              !document.querySelector('[data-delete-tracks-modal]') &&
              JSON.parse(localStorage.getItem("muro-settings") ?? "null")
                ?.state?.lastDeleteMode === "disk"
            );
          } catch {
            return false;
          }
        });
        firstTrackRow?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 160,
        }));
        await waitForSelector('[data-testid="delete-track-menu-item"]');
        document.querySelector('[data-testid="delete-track-menu-item"]')?.click();
        await waitForCondition(() => {
          const preferredButton = document.querySelector(
            '[data-delete-from-disk][data-delete-preferred="true"]'
          );
          return Boolean(preferredButton && document.activeElement === preferredButton);
        });
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
        await waitForCondition(() => !document.querySelector('[data-delete-tracks-modal]'));
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
        await waitForCondition(() => {
          const menuText = Array.from(
            document.querySelectorAll('[data-popover]'),
            (node) => node.textContent ?? "",
          );
          const exportButton = document.querySelector("[data-playlist-export]");
          return menuText.some((text) =>
            text.includes("Export playlist") &&
            text.includes("Move to") &&
            text.includes("Playlists")
          ) && exportButton?.getAttribute("title") === "Export this playlist as an M3U8 file";
        });
        const playlistMenuTexts = Array.from(
          document.querySelectorAll('[data-popover]'),
          (node) => node.textContent ?? "",
        );
        const playlistExportButton = document.querySelector("[data-playlist-export]");
        const playlistExportMoveMenuReady = playlistMenuTexts.some((text) =>
          text.includes("Export playlist") &&
          text.includes("Move to") &&
          text.includes("Playlists")
        ) && playlistExportButton?.getAttribute("title") === "Export this playlist as an M3U8 file";
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await waitForCondition(() => !document.querySelector('[data-popover]'));

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
          await waitForCondition(() => {
            const updatedSource = document.querySelector(
              '[data-playlist-id="smoke-empty-playlist"]'
            );
            const updatedTarget = document.querySelector(
              '[data-playlist-id="smoke-drag-playlist"]'
            );
            return Boolean(
              updatedSource &&
              updatedTarget &&
              (
                updatedTarget.compareDocumentPosition(updatedSource) &
                Node.DOCUMENT_POSITION_FOLLOWING
              )
            );
          });
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
        await waitForCondition(() =>
          Boolean(
            document.querySelector('[data-playlist-move-folder="smoke-nested-folder"]') &&
            document.querySelector('[data-playlist-delete]')
              ?.textContent?.includes("Delete 2 playlists")
          )
        );
        const bulkMoveButton = document.querySelector(
          '[data-playlist-move-folder="smoke-nested-folder"]'
        );
        const initialBulkDeleteButton = document.querySelector('[data-playlist-delete]');
        const bulkPlaylistMenuReady = Boolean(
          bulkMoveButton && initialBulkDeleteButton?.textContent?.includes("Delete 2 playlists")
        );
        bulkMoveButton?.click();
        await waitForCondition(() =>
          document.querySelector('[data-playlist-id="smoke-empty-playlist"]')
            ?.getAttribute("data-playlist-folder-parent") === "smoke-nested-folder" &&
          document.querySelector('[data-playlist-id="smoke-drag-playlist"]')
            ?.getAttribute("data-playlist-folder-parent") === "smoke-nested-folder"
        );
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
        await waitForCondition(() =>
          document.querySelector('[data-playlist-delete]')
            ?.textContent?.includes("Delete 2 playlists")
        );
        const bulkDeleteButton = document.querySelector('[data-playlist-delete]');
        bulkDeleteButton?.click();
        await waitForCondition(() =>
          !document.querySelector('[data-playlist-id="smoke-empty-playlist"]') &&
          !document.querySelector('[data-playlist-id="smoke-drag-playlist"]')
        );
        const bulkPlaylistDeleteReady = Boolean(
          !document.querySelector('[data-playlist-id="smoke-empty-playlist"]') &&
          !document.querySelector('[data-playlist-id="smoke-drag-playlist"]')
        );

        window.location.hash = "#/playlists/smoke-playlist";
        await waitForSelector('[data-remove-from-playlist]');
        const playlistRemoveReady = Boolean(document.querySelector('[data-remove-from-playlist]'));
        window.location.hash = "#/settings";
        await waitForCondition(
          () => document.querySelectorAll("[data-settings-section]").length === 6
        );
        const settingsNavigationReady = Boolean(
          document.querySelector("[data-settings-search]") &&
          document.querySelectorAll("[data-settings-section]").length === 6 &&
          document.querySelector('[data-settings-section="general"]') &&
          document.querySelector('[data-settings-section="library"]') &&
          document.querySelector('[data-settings-section="metadata"]') &&
          document.querySelector('[data-settings-section="analysis"]') &&
          document.querySelector('[data-settings-section="dj"]') &&
          document.querySelector('[data-settings-section="advanced"]')
        );
        document.querySelector('[data-settings-tab="metadata"]')?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector("[data-artist-information-settings]") &&
            document.querySelector("[data-acoustid-settings]") &&
            document.querySelector("[data-lastfm-api-key]") &&
            document.querySelector("[data-theaudiodb-api-key]") &&
            document.querySelector("[data-fanart-api-key]") &&
            document.querySelector("[data-brave-search-api-key]") &&
            document.querySelector("[data-acoustid-client-key]")
          )
        );
        const lastFmApiKeyInput = document.querySelector("[data-lastfm-api-key]");
        const theAudioDbApiKeyInput = document.querySelector("[data-theaudiodb-api-key]");
        const fanartApiKeyInput = document.querySelector("[data-fanart-api-key]");
        const braveSearchApiKeyInput = document.querySelector("[data-brave-search-api-key]");
        const acoustIdClientKeyInput = document.querySelector("[data-acoustid-client-key]");
        const artistInformationSettingsReady = Boolean(
          document.querySelector("[data-artist-information-settings]") &&
          lastFmApiKeyInput instanceof HTMLInputElement &&
          lastFmApiKeyInput.type === "password" &&
          theAudioDbApiKeyInput instanceof HTMLInputElement &&
          theAudioDbApiKeyInput.type === "password" &&
          fanartApiKeyInput instanceof HTMLInputElement &&
          fanartApiKeyInput.type === "password" &&
          braveSearchApiKeyInput instanceof HTMLInputElement &&
          braveSearchApiKeyInput.type === "password"
        );
        const acoustIdSettingsReady = Boolean(
          document.querySelector("[data-acoustid-settings]") &&
          acoustIdClientKeyInput instanceof HTMLInputElement &&
          acoustIdClientKeyInput.type === "password"
        );
        document.querySelector('[data-settings-tab="dj"]')?.click();
        await waitForSelector("[data-dj-mix-feature-toggle]");
        const featureToggle = document.querySelector("[data-dj-mix-feature-toggle]");
        const defaultOff = featureToggle instanceof HTMLInputElement && !featureToggle.checked;
        featureToggle?.click();
        await waitForCondition(() => {
          const bars = document.querySelector("[data-mix-bars]");
          return Boolean(
            document.querySelector("[data-dj-mix-settings]") &&
            bars instanceof HTMLSelectElement &&
            Array.from(bars.options, (option) => Number(option.value)).join(",") === "4,8,16,32"
          );
        });
        const mixBars = document.querySelector("[data-mix-bars]");
        const mixBarOptions = mixBars instanceof HTMLSelectElement
          ? Array.from(mixBars.options, (option) => Number(option.value))
          : [];
        const djMixFeatureGateReady =
          defaultOff &&
          Boolean(document.querySelector("[data-dj-mix-settings]")) &&
          mixBarOptions.join(",") === "4,8,16,32";
        window.location.hash = "#/";
        await waitForCondition(() =>
          window.location.hash === "#/" &&
          document.querySelectorAll('[data-track-index]').length >= 2
        );
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
        await waitForSelector("[data-mix-with-current]");
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
        await waitForCondition(() =>
          Boolean(
            document.querySelector('[data-mix-indicator="active"]')
              ?.textContent?.includes("42%") &&
            document.querySelector("[data-mix-progress]")
              ?.getAttribute("aria-valuenow") === "42"
          )
        );
        const mixIndicator = document.querySelector('[data-mix-indicator="active"]');
        const mixProgress = document.querySelector("[data-mix-progress]");
        const mixIndicatorReady = Boolean(
          mixIndicator?.textContent?.includes("Mixing") &&
          mixIndicator?.textContent?.includes("42%") &&
          mixIndicator?.textContent?.includes("Smoke Track 002") &&
          mixProgress?.getAttribute("aria-valuenow") === "42"
        );
        document.querySelector('[data-panel-view="queue"]')?.click();
        await waitForSelector('[data-queue-section="queue"]');
        window.location.hash = "#/settings";
        const analysisSettingsTab = await waitForSelector('[data-settings-tab="analysis"]');
        analysisSettingsTab?.click();
        await waitForSelector('[data-analysis-notation]');
        await waitForSelector('[data-analysis-performance]');
        const notationSelect = document.querySelector('[data-analysis-notation]');
        const notationOptions = notationSelect instanceof HTMLSelectElement
          ? Array.from(notationSelect.options, (option) => option.value)
          : [];
        const performanceSelect = document.querySelector('[data-analysis-performance]');
        const performanceOptions = performanceSelect instanceof HTMLSelectElement
          ? Array.from(performanceSelect.options, (option) => option.value)
          : [];
        if (performanceSelect instanceof HTMLSelectElement) {
          performanceSelect.value = "maximum";
          performanceSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const analysisPerformancePersisted = await waitForCondition(() =>
          JSON.parse(localStorage.getItem("muro-settings") ?? "null")
            ?.state?.analysisPerformance === "maximum"
        );
        const persistedAnalysisPerformance = JSON.parse(
          localStorage.getItem("muro-settings") ?? "null"
        )?.state?.analysisPerformance;
        const analysisNotationSettingsReady =
          notationOptions.includes("standard") &&
          notationOptions.includes("custom") &&
          notationOptions.includes("combined") &&
          notationOptions.includes("djCombined") &&
          performanceOptions.join(",") === "stable,fast,maximum" &&
          analysisPerformancePersisted &&
          persistedAnalysisPerformance === "maximum";
        window.location.hash = "#/collection/albums";
        await waitForSelector("[data-albums-view]");
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
        await waitForCondition(() =>
          Boolean(
            Array.from(
              document.querySelectorAll("[data-popover]"),
              (node) => node.textContent ?? "",
            ).some((text) => text.includes("10 selected") && text.includes("Add to playlist")) &&
            document.querySelector('[data-testid="search-album-metadata-menu-item"]')
          )
        );
        const albumCardContextMenuReady = Boolean(
          Array.from(document.querySelectorAll("[data-popover]"), (node) => node.textContent ?? "")
            .some((text) => text.includes("10 selected") && text.includes("Add to playlist"))
        );
        const searchAlbumMetadataItem = document.querySelector('[data-testid="search-album-metadata-menu-item"]');
        const albumMetadataMenuReady = Boolean(
          searchAlbumMetadataItem?.textContent?.includes("Search for album metadata")
        );
        searchAlbumMetadataItem?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector("[data-album-metadata-modal]") &&
            document.querySelector("[data-album-metadata-candidate]") &&
            document.querySelectorAll("[data-album-metadata-field]").length === 12 &&
            document.querySelectorAll('[data-album-track-match="matched"]').length === 10 &&
            document.querySelector("[data-apply-album-metadata]")
              ?.textContent?.includes("10 tracks")
          )
        );
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
        await waitForCondition(() => !document.querySelector("[data-album-metadata-modal]"));
        document.querySelector(".album-card-open")?.click();
        await waitForSelector("[data-album-detail]");
        const albumDetailReady = Boolean(document.querySelector("[data-album-detail]"));
        const albumDetailTrackCount = document.querySelectorAll("[data-album-track]").length;
        document.querySelector("[data-album-track]")?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 260,
        }));
        await waitForCondition(() =>
          Array.from(
            document.querySelectorAll("[data-popover]"),
            (node) => node.textContent ?? "",
          ).some((text) => text.includes("Play next") && text.includes("Add to playlist"))
        );
        const albumTrackContextMenuReady = Boolean(
          Array.from(document.querySelectorAll("[data-popover]"), (node) => node.textContent ?? "")
            .some((text) => text.includes("Play next") && text.includes("Add to playlist"))
        );
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await waitForCondition(() => !document.querySelector("[data-popover]"));
        document.querySelector(".album-back-button")?.click();
        await waitForSelector("[data-albums-view]");
        document.querySelector('[aria-label="List view"]')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const albumListReady = Boolean(document.querySelector(".album-collection--list"));
        document.querySelector(".album-collection--list [data-album-card]")?.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 240,
          clientY: 200,
        }));
        await waitForSelector('[data-testid="search-album-metadata-menu-item"]');
        const albumListMetadataMenuReady = Boolean(
          document.querySelector('[data-testid="search-album-metadata-menu-item"]')
        );
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await waitForCondition(() =>
          !document.querySelector("[data-popover]") &&
          Boolean(
            document.querySelector("[data-history-back]") &&
            document.querySelector("[data-history-forward]")
          )
        );
        const historyBackButton = document.querySelector("[data-history-back]");
        const historyForwardButton = document.querySelector("[data-history-forward]");
        const historyButtonsReady = Boolean(historyBackButton && historyForwardButton);
        const historyBackEnabled = historyBackButton instanceof HTMLButtonElement && !historyBackButton.disabled;
        historyBackButton?.click();
        await waitForSelector("[data-album-detail]");
        const historyBackReachedAlbumDetail = Boolean(document.querySelector("[data-album-detail]"));
        const historyForwardEnabledAfterBack =
          historyForwardButton instanceof HTMLButtonElement && !historyForwardButton.disabled;
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowRight",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }));
        await waitForSelector(".album-collection--list");
        const keyboardForwardReachedAlbumList = Boolean(document.querySelector(".album-collection--list"));
        window.dispatchEvent(new MouseEvent("mouseup", {
          button: 3,
          bubbles: true,
          cancelable: true,
        }));
        await waitForSelector("[data-album-detail]");
        const mouseBackReachedAlbumDetail = Boolean(document.querySelector("[data-album-detail]"));
        window.dispatchEvent(new MouseEvent("mouseup", {
          button: 4,
          bubbles: true,
          cancelable: true,
        }));
        await waitForSelector(".album-collection--list");
        const mouseForwardReachedAlbumList = Boolean(document.querySelector(".album-collection--list"));
        document.querySelector(".album-card-open")?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector("[data-album-detail]") &&
            document.querySelector("[data-album-artist]") &&
            document.querySelector("[data-album-genre]")
          )
        );
        const albumMetadataLinksReady = Boolean(
          document.querySelector("[data-album-artist]") &&
          document.querySelector("[data-album-genre]")
        );
        document.querySelector("[data-album-artist]")?.click();
        await waitForCondition(() =>
          window.location.hash.includes("/collection/artists") &&
          window.location.hash.includes("value=Muro") &&
          document.querySelector("h2")?.textContent?.trim() === "Muro" &&
          Boolean(document.querySelector('[data-artist-detail="Muro"][data-artist-status="ready"]'))
        );
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
        await waitForCondition(() =>
          Boolean(
            document.querySelector("[data-artist-index]") &&
            document.querySelectorAll("[data-artist-card]").length === 2 &&
            document.querySelector('[data-artist-card="Muro"]')
              ?.getAttribute("data-artist-profile-cached") === "true"
          )
        );
        const artistCards = document.querySelectorAll("[data-artist-card]");
        const artistCard = document.querySelector('[data-artist-card="Muro"]');
        const artistIndexReady =
          Boolean(document.querySelector("[data-artist-index]")) &&
          artistCards.length === 2 &&
          artistCard?.getAttribute("data-artist-profile-cached") === "true" &&
          artistCard?.textContent?.includes("250 tracks") &&
          artistCard?.textContent?.includes("25 albums");
        artistCard?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector('[data-artist-detail="Muro"][data-artist-status="ready"]') &&
            document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "250"
          )
        );
        const artistDetailReady = Boolean(
          document.querySelector('[data-artist-detail="Muro"][data-artist-status="ready"]') &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "250"
        );
        document.querySelector('[title="Search for another artist picture"]')?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector("[data-artist-image-modal]") &&
            document.querySelectorAll("[data-artist-image-candidate]").length === 4
          )
        );
        const artistImageChooserReady = Boolean(
          document.querySelector("[data-artist-image-modal]") &&
          document.querySelectorAll("[data-artist-image-candidate]").length === 4 &&
          document.querySelector('[data-artist-image-candidate="wikimedia-commons"]') &&
          document.querySelector('[data-artist-image-candidate="fanart.tv"]') &&
          document.querySelector('[data-artist-image-candidate="deezer"]') &&
          document.querySelector('[data-artist-image-candidate="brave-search"]') &&
          document.querySelector("[data-artist-image-modal]")?.textContent?.includes("usage rights")
        );
        document.querySelector('[data-artist-image-candidate="fanart.tv"] [role="radio"]')?.click();
        document.querySelector("[data-apply-artist-image]")?.click();
        await waitForCondition(() =>
          !document.querySelector("[data-artist-image-modal]") &&
          Boolean(
            document.querySelector(".artist-detail-photo img")
              ?.getAttribute("src")?.includes("app-logo.png")
          )
        );
        const artistImageCounts = await window.muro.invoke("test_get_cover_counts");
        const artistImageApplied = Boolean(
          !document.querySelector("[data-artist-image-modal]") &&
          artistImageCounts.artistImageSaveCount === 1 &&
          artistImageCounts.artistImageSearchArgs?.artistId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" &&
          artistImageCounts.artistImageSaveArgs?.artistId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" &&
          document.querySelector(".artist-detail-photo img")?.getAttribute("src")?.includes("app-logo.png")
        );

        window.location.hash = "#/";
        await waitForCondition(() => Boolean(
          window.location.hash === "#/" &&
          document.querySelector('[data-library-view="library"]')
            ?.getAttribute("aria-current") === "page" &&
          document.querySelector("h2")?.textContent?.trim() === "All Songs" &&
          !document.querySelector('[data-artist-detail]') &&
          document.querySelector('[data-track-index="0"] [data-track-artist-link="true"]')
        ));
        const tableArtistLink = document.querySelector('[data-track-index="0"] [data-track-artist-link="true"]');
        const tableArtistCell = tableArtistLink?.closest('[data-column-key="artist"]');
        const artistLinkRect = tableArtistLink?.getBoundingClientRect();
        const artistCellRect = tableArtistCell?.getBoundingClientRect();
        tableArtistCell?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const artistCellDoesNotNavigate = window.location.hash === "#/";
        tableArtistLink?.click();
        await waitForCondition(() =>
          window.location.hash.includes("/collection/artists") &&
          window.location.hash.includes("value=Muro") &&
          document.querySelector("h2")?.textContent?.trim() === "Muro"
        );
        const tableArtistNavigationReady =
          window.location.hash.includes("/collection/artists") &&
          window.location.hash.includes("value=Muro") &&
          document.querySelector("h2")?.textContent?.trim() === "Muro";

        window.location.hash = "#/";
        await waitForCondition(() => Boolean(
          window.location.hash === "#/" &&
          document.querySelector('[data-library-view="library"]')
            ?.getAttribute("aria-current") === "page" &&
          document.querySelector("h2")?.textContent?.trim() === "All Songs" &&
          !document.querySelector('[data-artist-detail]') &&
          document.querySelector('[data-track-index="0"] [data-track-album-link="true"]')
        ));
        const tableAlbumLink = document.querySelector('[data-track-index="0"] [data-track-album-link="true"]');
        const tableAlbumCell = tableAlbumLink?.closest('[data-column-key="album"]');
        const albumLinkRect = tableAlbumLink?.getBoundingClientRect();
        const albumCellRect = tableAlbumCell?.getBoundingClientRect();
        tableAlbumCell?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const albumCellDoesNotNavigate = window.location.hash === "#/";
        const tableTextOnlyNavigationReady = Boolean(
          artistCellDoesNotNavigate &&
          albumCellDoesNotNavigate &&
          artistLinkRect && artistCellRect && artistLinkRect.width < artistCellRect.width - 8 &&
          albumLinkRect && albumCellRect && albumLinkRect.width < albumCellRect.width - 8
        );
        tableAlbumLink?.click();
        await waitForCondition(() =>
          window.location.hash.includes("/collection/albums") &&
          window.location.hash.includes("album=") &&
          Boolean(document.querySelector("[data-album-detail]"))
        );
        const tableAlbumNavigationReady =
          window.location.hash.includes("/collection/albums") &&
          window.location.hash.includes("album=") &&
          Boolean(document.querySelector("[data-album-detail]"));

        window.location.hash = "#/";
        await waitForCondition(() =>
          window.location.hash === "#/" &&
          document.querySelector('[data-library-view="library"]')
            ?.getAttribute("aria-current") === "page" &&
          document.querySelector("h2")?.textContent?.trim() === "All Songs" &&
          !document.querySelector('[data-album-detail]') &&
          Boolean(
            document.querySelector('[data-library-view="recentlyPlayed"]') &&
            document.querySelector('[data-library-view="recentlyAdded"]')
          )
        );

        const libraryViewButtons = [...document.querySelectorAll('[data-library-view]')];
        const recentlyPlayedNavigationIndex = libraryViewButtons.findIndex(
          (button) => button.getAttribute("data-library-view") === "recentlyPlayed"
        );
        const recentlyAddedNavigationIndex = libraryViewButtons.findIndex(
          (button) => button.getAttribute("data-library-view") === "recentlyAdded"
        );
        const recentlyAddedBelowPlayed =
          recentlyAddedNavigationIndex === recentlyPlayedNavigationIndex + 1;
        document.querySelector('[data-library-view="recentlyAdded"]')?.click();
        await waitForCondition(() => Boolean(
          window.location.hash === "#/recently-added" &&
          document.querySelector('[data-library-view="recentlyAdded"]')
            ?.getAttribute("aria-current") === "page" &&
          document.querySelector("h2")?.textContent?.trim() === "Recently Added" &&
          document.querySelector('[data-track-index="0"] [data-column-key="title"]')
            ?.textContent?.trim() === "Smoke Track 000"
        ));
        const recentlyAddedFirstTitle = document.querySelector(
          '[data-track-index="0"] [data-column-key="title"]'
        )?.textContent?.trim() ?? null;
        const recentlyAddedViewReady = Boolean(
          recentlyAddedBelowPlayed &&
          window.location.hash === "#/recently-added" &&
          document.querySelector('[data-library-view="recentlyAdded"]')?.getAttribute("aria-current") === "page" &&
          document.querySelector("h2")?.textContent?.trim() === "Recently Added" &&
          recentlyAddedFirstTitle === "Smoke Track 000"
        );
        const recentlyAddedDebug = {
          recentlyAddedBelowPlayed,
          hash: window.location.hash,
          current: document.querySelector('[data-library-view="recentlyAdded"]')
            ?.getAttribute("aria-current") ?? null,
          heading: document.querySelector("h2")?.textContent?.trim() ?? null,
          firstTitle: recentlyAddedFirstTitle ?? null,
        };

        window.location.hash = "#/collection/genres";
        await waitForCondition(() =>
          document.querySelectorAll(
            '[data-collection-index="genres"] [data-collection-value]'
          ).length === 2
        );
        const genreItems = document.querySelectorAll('[data-collection-index="genres"] [data-collection-value]');
        const electronicGenre = document.querySelector('[data-collection-value="Electronic"]');
        const houseGenre = document.querySelector('[data-collection-value="House"]');
        const genreIndexReady =
          genreItems.length === 2 &&
          electronicGenre?.getAttribute("data-collection-count") === "125" &&
          houseGenre?.getAttribute("data-collection-count") === "125";
        electronicGenre?.click();
        await waitForCondition(() =>
          window.location.hash.includes("/collection/genres") &&
          window.location.hash.includes("value=Electronic") &&
          document.querySelector("h2")?.textContent?.trim() === "Electronic" &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "125"
        );
        const genreDrilldownReady =
          window.location.hash.includes("/collection/genres") &&
          window.location.hash.includes("value=Electronic") &&
          document.querySelector("h2")?.textContent?.trim() === "Electronic" &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "125";
        window.history.back();
        await waitForSelector('[data-collection-index="genres"]');
        const genreHistoryReady = Boolean(document.querySelector('[data-collection-index="genres"]'));

        window.location.hash = "#/collection/labels";
        await waitForCondition(() =>
          document.querySelectorAll(
            '[data-collection-index="labels"] [data-collection-value]'
          ).length === 2
        );
        const labelItems = document.querySelectorAll('[data-collection-index="labels"] [data-collection-value]');
        const muroRecordsLabel = document.querySelector(
          '[data-collection-index="labels"] [data-collection-value="Muro Records"]'
        );
        const labelIndexReady =
          labelItems.length === 2 &&
          muroRecordsLabel?.getAttribute("data-collection-count") === "125";
        muroRecordsLabel?.click();
        await waitForCondition(() =>
          window.location.hash.includes("/collection/labels") &&
          window.location.hash.includes("value=Muro+Records") &&
          document.querySelector("h2")?.textContent?.trim() === "Muro Records" &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "125"
        );
        const labelDrilldownReady =
          window.location.hash.includes("/collection/labels") &&
          window.location.hash.includes("value=Muro+Records") &&
          document.querySelector("h2")?.textContent?.trim() === "Muro Records" &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "125";

        window.location.hash = "#/collection/keys";
        await waitForCondition(() =>
          document.querySelectorAll(
            '[data-collection-index="keys"] [data-collection-value]'
          ).length === 5
        );
        const keyItems = document.querySelectorAll('[data-collection-index="keys"] [data-collection-value]');
        const camelot8A = document.querySelector('[data-collection-index="keys"] [data-collection-value="8A"]');
        const keyIndexReady =
          keyItems.length === 5 &&
          camelot8A?.getAttribute("data-collection-count") === "84" &&
          camelot8A?.getAttribute("data-collection-color") === "#E9AEE1";
        camelot8A?.click();
        await waitForCondition(() =>
          window.location.hash.includes("/collection/keys") &&
          window.location.hash.includes("value=8A") &&
          document.querySelector("h2")?.textContent?.trim() === "8A" &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "84"
        );
        const keyDrilldownReady =
          window.location.hash.includes("/collection/keys") &&
          window.location.hash.includes("value=8A") &&
          document.querySelector("h2")?.textContent?.trim() === "8A" &&
          document.querySelector('[role="grid"]')?.getAttribute("aria-rowcount") === "84";
        const removedCollectionLinksReady =
          !document.querySelector('[data-collection-facet="bpm"]') &&
          !document.querySelector('[data-collection-facet="formats"]');

        document.querySelector('[data-smart-crate-create]')?.click();
        await waitForSelector("[data-smart-crate-modal]");
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
        await waitForCondition(() => {
          const saveButton = document.querySelector('[data-smart-crate-save]');
          return Boolean(
            smartCrateName instanceof HTMLInputElement &&
            smartCrateName.value === "Warm-up House" &&
            saveButton instanceof HTMLButtonElement &&
            !saveButton.disabled
          );
        });
        document.querySelector('[data-smart-crate-save]')?.click();
        await waitForCondition(() =>
          !document.querySelector('[data-smart-crate-modal]') &&
          Boolean(
            document.querySelector('[data-smart-crate-id]') &&
            window.location.hash.includes("/smart-crates/") &&
            document.querySelector("h2")?.textContent?.trim() === "Warm-up House"
          )
        );
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
        await waitForSelector('[data-queue-section="queue"]');
        const clearQueueButton = document.querySelector('[aria-label="Clear queue"]');
        clearQueueButton?.click();
        const queueClearedReady = await waitForCondition(() =>
          !document.querySelector("[data-queue-track]")
        );
        window.location.hash = "#/playlists/smoke-next-playlist";
        await waitForCondition(() => Boolean(
          window.location.hash === "#/playlists/smoke-next-playlist" &&
          document.querySelector("h2")?.textContent?.trim() === "Next Context" &&
          document.querySelectorAll('[data-remove-from-playlist]').length === 3 &&
          document.querySelector('[data-track-index="0"] [data-column-key="title"]')
            ?.textContent?.trim() === "Smoke Track 000"
        ));
        document.querySelector('[data-track-index="0"]')?.dispatchEvent(new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
        }));
        await waitForCondition(() => {
          const queue = document.querySelector('[data-queue-section="queue"]');
          const playingNext = document.querySelector('[data-queue-section="playing-next"]');
          const rows = Array.from(document.querySelectorAll("[data-playing-next-track]"));
          return Boolean(
            queue &&
            playingNext &&
            rows.length === 2 &&
            rows[0]?.textContent?.includes("Smoke Track 010") &&
            rows[1]?.textContent?.includes("Smoke Track 020")
          );
        });
        const queueSection = document.querySelector('[data-queue-section="queue"]');
        const playingNextSection = document.querySelector('[data-queue-section="playing-next"]');
        const stackedQueueSectionsReady = Boolean(
          queueSection &&
          playingNextSection &&
          (queueSection.compareDocumentPosition(playingNextSection) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
        const initialPlayingNextRows = Array.from(
          document.querySelectorAll("[data-playing-next-track]")
        );
        const playingNextViewReady = Boolean(
          queueClearedReady &&
          stackedQueueSectionsReady &&
          initialPlayingNextRows.length === 2 &&
          initialPlayingNextRows[0]?.textContent?.includes("Smoke Track 010") &&
          initialPlayingNextRows[1]?.textContent?.includes("Smoke Track 020")
        );
        const playingNextDebug = JSON.stringify({
          queueSectionFound: Boolean(queueSection),
          playingNextSectionFound: Boolean(playingNextSection),
          queueClearedReady,
          stacked: stackedQueueSectionsReady,
          rowCount: initialPlayingNextRows.length,
          rows: initialPlayingNextRows.map((row) => row.textContent?.trim().slice(0, 48)),
        });
        const firstPlayingNextRow = initialPlayingNextRows[0];
        const secondPlayingNextRow = initialPlayingNextRows[1];
        if (firstPlayingNextRow && secondPlayingNextRow) {
          const firstBounds = firstPlayingNextRow.getBoundingClientRect();
          const secondBounds = secondPlayingNextRow.getBoundingClientRect();
          firstPlayingNextRow.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: firstBounds.left + 20,
            clientY: firstBounds.top + firstBounds.height / 2,
          }));
          window.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            buttons: 1,
            clientX: firstBounds.left + 20,
            clientY: firstBounds.top + firstBounds.height / 2 + 8,
          }));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          window.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            buttons: 1,
            clientX: secondBounds.left + 20,
            clientY: secondBounds.bottom + 4,
          }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          window.dispatchEvent(new MouseEvent("mouseup", {
            bubbles: true,
            button: 0,
            clientX: secondBounds.left + 20,
            clientY: secondBounds.bottom + 4,
          }));
        }
        await waitForCondition(() => {
          const rows = Array.from(document.querySelectorAll("[data-playing-next-track]"));
          return Boolean(
            rows[0]?.textContent?.includes("Smoke Track 020") &&
            rows[1]?.textContent?.includes("Smoke Track 010")
          );
        });
        const reorderedPlayingNextRows = Array.from(
          document.querySelectorAll("[data-playing-next-track]")
        );
        const playingNextReorderReady = Boolean(
          reorderedPlayingNextRows[0]?.textContent?.includes("Smoke Track 020") &&
          reorderedPlayingNextRows[1]?.textContent?.includes("Smoke Track 010")
        );
        const trackToQueue = reorderedPlayingNextRows[1];
        const queueDropSection = document.querySelector('[data-queue-section="queue"]');
        let crossSectionDropTargetReady = false;
        if (trackToQueue && queueDropSection) {
          const trackBounds = trackToQueue.getBoundingClientRect();
          const queueBounds = queueDropSection.getBoundingClientRect();
          trackToQueue.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: trackBounds.left + 20,
            clientY: trackBounds.top + trackBounds.height / 2,
          }));
          window.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            buttons: 1,
            clientX: trackBounds.left + 20,
            clientY: trackBounds.top + trackBounds.height / 2 - 8,
          }));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          window.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            buttons: 1,
            clientX: queueBounds.left + 30,
            clientY: queueBounds.top + queueBounds.height / 2,
          }));
          await new Promise((resolve) => requestAnimationFrame(resolve));
          crossSectionDropTargetReady =
            document.querySelector('[data-queue-drop-target="active"]') !== null;
          window.dispatchEvent(new MouseEvent("mouseup", {
            bubbles: true,
            button: 0,
            clientX: queueBounds.left + 30,
            clientY: queueBounds.top + queueBounds.height / 2,
          }));
        }
        await waitForCondition(() =>
          Boolean(
            document.querySelector("[data-queue-track]")
              ?.textContent?.includes("Smoke Track 010") &&
            document.querySelectorAll("[data-playing-next-track]").length === 1 &&
            document.querySelector("[data-playing-next-track]")
              ?.textContent?.includes("Smoke Track 020")
          )
        );
        const priorityQueueVisible = Boolean(
          document.querySelector("[data-queue-track]")?.textContent?.includes("Smoke Track 010") &&
          document.querySelectorAll("[data-playing-next-track]").length === 1 &&
          document.querySelector("[data-playing-next-track]")?.textContent?.includes("Smoke Track 020")
        );
        document.querySelector('button[title="Next"]')?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector('[data-track-index="1"][data-track-playing="true"]') &&
            document.querySelector('[data-track-index="1"]')
              ?.textContent?.includes("Smoke Track 010")
          )
        );
        const queueHasPriority = Boolean(
          document.querySelector('[data-track-index="1"][data-track-playing="true"]') &&
          document.querySelector('[data-track-index="1"]')?.textContent?.includes("Smoke Track 010")
        );
        document.querySelector('button[title="Next"]')?.click();
        await waitForCondition(() =>
          Boolean(
            document.querySelector('[data-track-index="2"][data-track-playing="true"]') &&
            document.querySelector('[data-track-index="2"]')
              ?.textContent?.includes("Smoke Track 020")
          )
        );
        const playingNextFollowsQueue = Boolean(
          document.querySelector('[data-track-index="2"][data-track-playing="true"]') &&
          document.querySelector('[data-track-index="2"]')?.textContent?.includes("Smoke Track 020")
        );
        window.location.hash = "#/";
        await waitForCondition(() => Boolean(
          window.location.hash === "#/" &&
          document.querySelector('[data-library-view="library"]')
            ?.getAttribute("aria-current") === "page" &&
          document.querySelector("h2")?.textContent?.trim() === "All Songs" &&
          document.querySelector('[data-now-playing-link]')
            ?.textContent?.includes("Smoke Track 020")
        ));
        document.querySelector('[data-now-playing-link]')?.click();
        await waitForCondition(() =>
          window.location.hash.includes("/playlists/smoke-next-playlist") &&
          Boolean(
            document.querySelector(
              '[data-track-index="2"][data-track-playing="true"][data-track-selected="true"]'
            )
          ) &&
          document.activeElement?.matches('[data-track-table-scroll]')
        );
        const revealedPlayingTrack = document.querySelector(
          '[data-track-index="2"][data-track-playing="true"][data-track-selected="true"]',
        );
        const nowPlayingHashOk = window.location.hash.includes("/playlists/smoke-next-playlist");
        const nowPlayingRowOk = Boolean(revealedPlayingTrack?.textContent?.includes("Smoke Track 020"));
        const nowPlayingFocusOk = Boolean(document.activeElement?.matches('[data-track-table-scroll]'));
        const nowPlayingDebugRow = document.querySelector('[data-track-index="2"]');
        const nowPlayingDebug = JSON.stringify({
          hash: window.location.hash,
          rowExists: Boolean(nowPlayingDebugRow),
          rowPlaying: nowPlayingDebugRow?.getAttribute("data-track-playing") ?? null,
          rowSelected: nowPlayingDebugRow?.getAttribute("data-track-selected") ?? null,
          rowTitle: nowPlayingDebugRow?.textContent?.slice(0, 24) ?? null,
          activeElement: document.activeElement
            ? document.activeElement.tagName + "#" +
              (document.activeElement.hasAttribute("data-track-table-scroll")
                ? "track-table-scroll"
                : (document.activeElement.getAttribute("class") ?? "").slice(0, 60))
            : null,
        });
        const nowPlayingReturnsToSource = nowPlayingHashOk && nowPlayingRowOk && nowPlayingFocusOk;

        document.querySelector('[data-selection-clear]')?.click();
        document.querySelector('[data-library-view="recentlyAdded"]')?.click();
        await waitForCondition(() =>
          window.location.hash === "#/recently-added" &&
          document.querySelector('[data-library-view="recentlyAdded"]')
            ?.getAttribute("aria-current") === "page" &&
          Boolean(document.querySelector('[data-track-index="0"]'))
        );
        const recentScroller = document.querySelector('[data-track-table-scroll]');
        if (recentScroller) {
          recentScroller.scrollTop = 0;
          recentScroller.dispatchEvent(new Event("scroll"));
        }
        const recentFirstRow = recentScroller?.querySelector('[data-track-index="0"]');
        recentFirstRow?.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        document.querySelector('[data-selection-edit]')?.click();
        await waitForSelector('[data-edit-track-modal]');
        const editModalBeforeDrag = document.querySelector('[data-edit-track-modal]');
        const revealRegressionArtist = document.querySelector(
          '[data-autocomplete-field="artist"]'
        );
        if (
          editModalBeforeDrag &&
          revealRegressionArtist instanceof HTMLInputElement
        ) {
          revealRegressionArtist.focus();
          revealRegressionArtist.setSelectionRange(
            0,
            Math.min(3, revealRegressionArtist.value.length)
          );
          revealRegressionArtist.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            buttons: 1,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }));
          revealRegressionArtist.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true,
            button: 0,
            buttons: 1,
          }));
          editModalBeforeDrag.dispatchEvent(new PointerEvent("pointerup", {
            bubbles: true,
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }));
          editModalBeforeDrag.dispatchEvent(new MouseEvent("mouseup", {
            bubbles: true,
            button: 0,
          }));
          editModalBeforeDrag.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
          }));
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const editModalSurvivesOutsideSelectionRelease = Boolean(
          document.querySelector('[data-edit-track-modal]')
        );
        const metadataUpdatesBeforeEnter = await window.muro.invoke("test_get_metadata_updates");
        const enterSaveArtist = "Enter Save Artist";
        const liveRevealRegressionArtist = document.querySelector(
          '[data-autocomplete-field="artist"]'
        );
        if (liveRevealRegressionArtist instanceof HTMLInputElement && nativeValueSetter) {
          nativeValueSetter.call(liveRevealRegressionArtist, enterSaveArtist);
          liveRevealRegressionArtist.dispatchEvent(new Event("input", { bubbles: true }));
          liveRevealRegressionArtist.focus();
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await window.muro.invoke("test_press_enter");
        await waitForCondition(() => !document.querySelector('[data-edit-track-modal]'));
        const metadataUpdatesAfterEnter = await window.muro.invoke("test_get_metadata_updates");
        const enterSaveUpdate = metadataUpdatesAfterEnter.at(-1);
        const editModalOpenAfterEnter = Boolean(
          document.querySelector('[data-edit-track-modal]')
        );
        const enterSavesEditModal = Boolean(
          !editModalOpenAfterEnter &&
          metadataUpdatesAfterEnter.length === metadataUpdatesBeforeEnter.length + 1 &&
          enterSaveUpdate?.trackIds?.length === 1 &&
          enterSaveUpdate.trackIds[0] === "smoke-track-0" &&
          enterSaveUpdate.updates?.artist === enterSaveArtist
        );
        const recentScrollerAfterEdit = document.querySelector('[data-track-table-scroll]');
        const selectedAfterRevealRegressionEdit = recentScrollerAfterEdit
          ?.querySelector('[data-track-selected="true"]')
          ?.getAttribute("data-track-index") ?? null;
        const metadataEditDidNotReplayReveal = Boolean(
          selectedAfterRevealRegressionEdit === "0" &&
          (recentScrollerAfterEdit?.scrollTop ?? Infinity) < 48
        );

        let directEditModalReady = Boolean(document.querySelector('[data-edit-track-modal]'));
        if (!directEditModalReady) {
          document.querySelector('[data-selection-edit]')?.click();
          directEditModalReady = Boolean(await waitForSelector('[data-edit-track-modal]'));
        }
        const directEditBackdrop = document.querySelector('[data-edit-track-modal]');
        directEditBackdrop?.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          isPrimary: true,
          pointerId: 2,
          pointerType: "mouse",
        }));
        const directBackdropClosed = directEditBackdrop
          ? await waitForCondition(() => !document.querySelector('[data-edit-track-modal]'))
          : false;
        const directBackdropDismissesEdit = Boolean(
          directEditModalReady && directEditBackdrop && directBackdropClosed
        );

        document.querySelector('[data-selection-clear]')?.click();
        if (recentScrollerAfterEdit) {
          recentScrollerAfterEdit.scrollTop = 0;
          recentScrollerAfterEdit.dispatchEvent(new Event("scroll"));
        }
        document.querySelector('[data-library-view="library"]')?.click();
        await waitForCondition(() =>
          window.location.hash === "#/" &&
          document.querySelector('[data-library-view="library"]')
            ?.getAttribute("aria-current") === "page"
        );
        document.querySelector('[data-library-view="recentlyAdded"]')?.click();
        const viewReturnSettled = await waitForCondition(() => {
          const returnedScroller = document.querySelector('[data-track-table-scroll]');
          return Boolean(
            window.location.hash === "#/recently-added" &&
            document.querySelector('[data-library-view="recentlyAdded"]')
              ?.getAttribute("aria-current") === "page" &&
            document.querySelector("h2")?.textContent?.trim() === "Recently Added" &&
            returnedScroller &&
            !returnedScroller.querySelector('[data-track-selected="true"]') &&
            returnedScroller.scrollTop < 48
          );
        });
        const recentScrollerAfterReturn = document.querySelector('[data-track-table-scroll]');
        const viewReturnDidNotReplayReveal = Boolean(
          viewReturnSettled &&
          window.location.hash === "#/recently-added" &&
          document.querySelector('[data-library-view="recentlyAdded"]')
            ?.getAttribute("aria-current") === "page" &&
          !recentScrollerAfterReturn?.querySelector('[data-track-selected="true"]') &&
          (recentScrollerAfterReturn?.scrollTop ?? Infinity) < 48
        );
        const revealRequestConsumptionDebug = JSON.stringify({
          selectedAfterEdit: selectedAfterRevealRegressionEdit,
          scrollAfterEdit: recentScrollerAfterEdit?.scrollTop ?? null,
          selectedAfterReturn: recentScrollerAfterReturn
            ?.querySelector('[data-track-selected="true"]')
            ?.getAttribute("data-track-index") ?? null,
          scrollAfterReturn: recentScrollerAfterReturn?.scrollTop ?? null,
          hashAfterReturn: window.location.hash,
        });
        const editModalInteractionDebug = JSON.stringify({
          editModalSurvivesOutsideSelectionRelease,
          metadataUpdatesBeforeEnter: metadataUpdatesBeforeEnter.length,
          metadataUpdatesAfterEnter: metadataUpdatesAfterEnter.length,
          enterSaveTrackIds: enterSaveUpdate?.trackIds ?? null,
          enterSaveArtist: enterSaveUpdate?.updates?.artist ?? null,
          editModalOpenAfterEnter,
          directBackdropDismissesEdit,
        });
        return {
          childCount: root?.childElementCount ?? 0,
          textLength: root?.textContent?.trim().length ?? 0,
          stickyHeaderReady: true,
          beforeTop,
          afterTop,
          scrollTop: scrolledTop,
          scrollLeft: scrolledLeft,
          headerScrollLeft: synchronizedHeaderLeft,
          farRightScrollLeft,
          farRightHeaderScrollLeft,
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
          linkedPlaylistIndicatorReady,
          playlistsUnderCollection,
          collapsedQueueControlsReady,
          collapsedQueueWidth,
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
          autocompleteFieldsReady,
          sameAsArtistReady,
          batchCommonValuesReady,
          manualCoverMenuReady,
          manualCoverFetchReady,
          manualCoverCopyReady,
          coverAppliedToSelectionReady,
          braveCoverPickerReady,
          rowThumbnailReady,
          ratingFitsCell,
          tableAlbumMetadataMenuReady,
          ratingSetToThree,
          ratingStarsRedReady,
          threeStarRatingClearsToZero,
          selectedRowUsesGreyHighlight,
          keyColumnColorReady,
          playingRowUsesRedHighlight,
          playingAfterSpace,
          pausedAfterSecondSpace,
          pausedRowUsesGreyHighlight,
          mediaSessionPlayingReady,
          repeatOneReady,
          repeatOneDebug,
          mediaSessionPausedReady,
          remoteFallbackReady,
          playerMetadataReady,
          playerRatingSetToFour,
          playerRatingClearsToZero,
          playerVolumeEndSpacingReady,
          queueOutputRemoved,
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
          queuedFromMixDebug,
          playlistDropTargetReady,
          contextAddToPlaylistReady,
          truthfulPlaylistUndoReady,
          mixedDuplicateUndoReady,
          mixedDuplicateUndoDebug,
          dragAddToPlaylistReady,
          nativeMultiFileDragReady,
          nativeDragDefaultPrevented,
          settingsNavigationReady,
          artistInformationSettingsReady,
          acoustIdSettingsReady,
          djMixFeatureGateReady,
          djMixManualSurfaceReady,
          mixWithCurrentActionReady,
          mixIndicatorReady,
          analysisNotationSettingsReady,
          contextMenuOpened,
          contextMenuViewportReady,
          contextMenuStayedOpenInside,
          contextMenuClosedOutside,
          showInFinderReady,
          searchMetadataMenuReady,
          acoustIdMenuReady,
          acoustIdModalReady,
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
          tableTextOnlyNavigationReady,
          recentlyAddedViewReady,
          recentlyAddedDebug,
          genreIndexReady,
          genreDrilldownReady,
          genreHistoryReady,
          labelIndexReady,
          labelDrilldownReady,
          keyIndexReady,
          keyDrilldownReady,
          removedCollectionLinksReady,
          smartCrateModalReady,
          smartCrateCreated,
          smartCrateMatchedTracks,
          persistedSmartCrateCount,
          playingNextViewReady,
          playingNextReorderReady,
          playingNextDebug,
          crossSectionDropTargetReady,
          priorityQueueVisible,
          queueHasPriority,
          playingNextFollowsQueue,
          nowPlayingReturnsToSource,
          nowPlayingHashOk,
          nowPlayingRowOk,
          nowPlayingFocusOk,
          nowPlayingDebug,
          metadataEditDidNotReplayReveal,
          viewReturnDidNotReplayReveal,
          revealRequestConsumptionDebug,
          editModalSurvivesOutsideSelectionRelease,
          enterSavesEditModal,
          directBackdropDismissesEdit,
          editModalInteractionDebug,
        };
      }
      return {
        childCount: root?.childElementCount ?? 0,
        textLength: root?.textContent?.trim().length ?? 0,
        stickyHeaderReady: false,
      };
      })()`);
    } catch (error) {
      fail(
        `Renderer smoke sequence failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    if (result.childCount > 0 && result.textLength > 0 && result.stickyHeaderReady) {
      if (settingsSmokeOnly) {
        if (!result.settingsOrganizationReady) {
          fail(
            `Settings organization regression failed: ${JSON.stringify(
              result.settingsOrganizationDebug
            )}`
          );
          return;
        }
        clearTimeout(timeout);
        console.log("Settings organization renderer smoke test passed.");
        app.exit(0);
        return;
      }
      if (libraryExportSmokeOnly) {
        if (!result.organizedLibraryExportReady) {
          fail(
            `Organized library export regression failed: ${JSON.stringify(
              result.organizedLibraryExportDebug
            )}`
          );
          return;
        }
        clearTimeout(timeout);
        console.log("Organized library export renderer smoke test passed.");
        app.exit(0);
        return;
      }
      if (artistSeparatorSmokeOnly) {
        if (!result.artistSeparatorReviewReady) {
          fail(
            `Artist separator review regression failed: ${JSON.stringify(
              result.artistSeparatorReviewDebug
            )}`
          );
          return;
        }
        clearTimeout(timeout);
        console.log("Artist separator renderer smoke test passed.");
        app.exit(0);
        return;
      }
      if (autoMixQueueSmokeOnly) {
        if (!result.autoMixQueueResponsive) {
          fail(`Auto-mix queue regression failed: responsive=${result.autoMixQueueResponsive}`);
          return;
        }
        clearTimeout(timeout);
        console.log("Auto-mix queue smoke test passed.");
        app.exit(0);
        return;
      }
      if (!result.analysisNotationSettingsReady) {
        fail("Key notation and analysis performance settings are not working");
        return;
      }
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
      if (Math.abs(result.farRightHeaderScrollLeft - result.farRightScrollLeft) > 1) {
        fail(
          `Header and rows diverged at the far-right edge: ` +
          `${result.farRightHeaderScrollLeft} != ${result.farRightScrollLeft}`
        );
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
      if (result.collapsedQueueWidth > 40 || result.collapsedQueueWidth < 32) {
        fail(`Collapsed queue sidebar is not compact: ${result.collapsedQueueWidth}px`);
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
          `expanded=${result.mixExpanded}, queued=${result.queuedFromMix}, ` +
          `queueDebug=${JSON.stringify(result.queuedFromMixDebug)}`
        );
        return;
      }
      if (
        !result.playlistDropTargetReady ||
        !result.contextAddToPlaylistReady ||
        !result.truthfulPlaylistUndoReady ||
        !result.mixedDuplicateUndoReady ||
        !result.dragAddToPlaylistReady ||
        !result.nativeMultiFileDragReady ||
        !result.nativeDragDefaultPrevented ||
        nativeDraggedFilePaths.length !== 2 ||
        new Set(nativeDraggedFilePaths).size !== 2 ||
        !nativeDraggedFilePaths.every((filePath) => fs.existsSync(filePath))
      ) {
        fail(
          `Adding tracks to playlists failed: dropTarget=${result.playlistDropTargetReady}, ` +
          `contextMenu=${result.contextAddToPlaylistReady}, ` +
          `undo=${result.truthfulPlaylistUndoReady}, ` +
          `duplicates=${result.mixedDuplicateUndoReady} ` +
          `${JSON.stringify(result.mixedDuplicateUndoDebug)}, drag=${result.dragAddToPlaylistReady}, ` +
          `native=${result.nativeMultiFileDragReady}, prevented=${result.nativeDragDefaultPrevented}, ` +
          `paths=${JSON.stringify(nativeDraggedFilePaths)}`
        );
        return;
      }
      if (
        !result.rowThumbnailReady ||
        !result.ratingFitsCell ||
        !result.ratingSetToThree ||
        !result.ratingStarsRedReady ||
        !result.threeStarRatingClearsToZero ||
        !ratingUpdates.some((update) => update.updates?.rating === 3) ||
        !ratingUpdates.some((update) => update.updates?.rating === 0) ||
        !result.selectedRowUsesGreyHighlight ||
        !result.playingRowUsesRedHighlight
      ) {
        fail(
          `Track row selection UI failed: thumbnail=${result.rowThumbnailReady}, ` +
          `ratingFits=${result.ratingFitsCell}, ratingSet=${result.ratingSetToThree}, ` +
          `ratingRed=${result.ratingStarsRedReady}, ` +
          `ratingCleared=${result.threeStarRatingClearsToZero}, ratingUpdates=${JSON.stringify(ratingUpdates)}, ` +
          `selectedGrey=${result.selectedRowUsesGreyHighlight}, ` +
          `playingRed=${result.playingRowUsesRedHighlight}`
        );
        return;
      }
      if (
        !result.playerMetadataReady ||
        !result.playerRatingSetToFour ||
        !result.playerRatingClearsToZero ||
        !result.playerVolumeEndSpacingReady ||
        !result.queueOutputRemoved
      ) {
        fail(
          `Player metadata layout failed: metadata=${result.playerMetadataReady}, ` +
          `ratingSet=${result.playerRatingSetToFour}, ratingCleared=${result.playerRatingClearsToZero}, ` +
          `volumeSpacing=${result.playerVolumeEndSpacingReady}, outputRemoved=${result.queueOutputRemoved}`
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
      if (
        !result.playingNextViewReady ||
        !result.playingNextReorderReady ||
        !result.crossSectionDropTargetReady ||
        !result.priorityQueueVisible ||
        !result.queueHasPriority ||
        !result.playingNextFollowsQueue
      ) {
        fail(
          `Playing-next order failed: view=${result.playingNextViewReady}, ` +
          `reorder=${result.playingNextReorderReady}, crossDrop=${result.crossSectionDropTargetReady}, ` +
          `queueVisible=${result.priorityQueueVisible}, ` +
          `queuePriority=${result.queueHasPriority}, resumesNext=${result.playingNextFollowsQueue}, ` +
          `debug=${result.playingNextDebug}`
        );
        return;
      }
      if (!result.nowPlayingReturnsToSource) {
        fail(
          "Now-playing link did not return to and reveal the current track's source list " +
          `(hash=${result.nowPlayingHashOk}, row=${result.nowPlayingRowOk}, ` +
          `focus=${result.nowPlayingFocusOk}, debug=${result.nowPlayingDebug})`
        );
        return;
      }
      if (!result.metadataEditDidNotReplayReveal || !result.viewReturnDidNotReplayReveal) {
        fail(
          "Handled now-playing reveal replayed after editing or returning to Recently Added: " +
          result.revealRequestConsumptionDebug
        );
        return;
      }
      if (
        !result.editModalSurvivesOutsideSelectionRelease ||
        !result.enterSavesEditModal ||
        !result.directBackdropDismissesEdit
      ) {
        fail(
          "Edit modal Enter or backdrop interaction failed: " +
          result.editModalInteractionDebug
        );
        return;
      }
      if (!result.showInFinderReady || shownItemPaths.at(-1) !== smokeTracks[0].source_path) {
        fail(
          `Show in Finder failed: item=${result.showInFinderReady}, ` +
          `revealed=${shownItemPaths.at(-1)}, expected=${smokeTracks[0].source_path}`
        );
        return;
      }
      if (
        !result.tableArtistNavigationReady ||
        !result.tableAlbumNavigationReady ||
        !result.tableTextOnlyNavigationReady
      ) {
        fail(
          `Table metadata navigation failed: artist=${result.tableArtistNavigationReady}, ` +
          `album=${result.tableAlbumNavigationReady}, textOnly=${result.tableTextOnlyNavigationReady}`
        );
        return;
      }
      if (
        !result.manualCoverMenuReady ||
        !result.manualCoverFetchReady ||
        !result.manualCoverCopyReady ||
        !result.coverAppliedToSelectionReady ||
        !result.braveCoverPickerReady
      ) {
        fail(
          `Manual cover fetch failed: menu=${result.manualCoverMenuReady}, ` +
          `fetch=${result.manualCoverFetchReady}, copy=${result.manualCoverCopyReady}, ` +
          `selection=${result.coverAppliedToSelectionReady}, bravePicker=${result.braveCoverPickerReady}`
        );
        return;
      }
      if (
        !result.searchMetadataMenuReady ||
        !result.acoustIdMenuReady ||
        !result.acoustIdModalReady ||
        !result.metadataSearchReady ||
        !result.metadataFieldSelectionReady
      ) {
        fail(
          `Metadata search failed: menu=${result.searchMetadataMenuReady}, ` +
          `acoustid=${result.acoustIdMenuReady}, acoustidModal=${result.acoustIdModalReady}, ` +
          `modal=${result.metadataSearchReady}, ` +
          `fields=${result.metadataFieldSelectionReady}`
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
      if (!result.repeatOneReady) {
        fail(
          "Repeat-one advanced the queue instead of replaying the current track: " +
          JSON.stringify(result.repeatOneDebug)
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
      if (!result.remoteFallbackReady) {
        fail("A failed remote load did not restore paused local playback");
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
      if (!result.settingsNavigationReady) {
        fail("Settings categories or settings search are missing");
        return;
      }
      if (!result.artistInformationSettingsReady) {
        fail("Artist information provider settings are not visible in Metadata & Artwork");
        return;
      }
      if (!result.recentlyAddedViewReady) {
        fail(
          "Recently Added navigation or newest-first ordering failed: " +
          JSON.stringify(result.recentlyAddedDebug)
        );
        return;
      }
      if (!result.autocompleteFieldsReady) {
        fail("Edit metadata autocomplete suggestions were not populated from the library");
        return;
      }
      if (!result.sameAsArtistReady) {
        fail("Album artist could not be copied from the artist field");
        return;
      }
      if (!result.batchCommonValuesReady) {
        fail("Batch metadata editing did not show common values and mark differing values as mixed");
        return;
      }
      if (!result.acoustIdSettingsReady) {
        fail("AcoustID client key settings are not visible in Metadata & Artwork");
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
        !result.contextMenuViewportReady ||
        !result.contextMenuStayedOpenInside ||
        !result.contextMenuClosedOutside ||
        !result.showInFinderReady ||
        shownItemPaths.at(-1) !== smokeTracks[0].source_path
      ) {
        fail(
          `Context-menu dismissal failed: opened=${result.contextMenuOpened}, ` +
          `viewport=${result.contextMenuViewportReady}, ` +
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
        !result.linkedPlaylistIndicatorReady ||
        !result.playlistsUnderCollection ||
        !result.playlistExportMoveMenuReady ||
        !result.playlistReorderReady
      ) {
        fail(
          `Playlist organization failed: folder=${result.playlistFolderReady}, ` +
          `nested=${result.nestedPlaylistFolderReady}, controls=${result.playlistTransferControlsReady}, ` +
          `linked=${result.linkedPlaylistIndicatorReady}, ` +
          `underCollection=${result.playlistsUnderCollection}, ` +
          `menu=${result.playlistExportMoveMenuReady}, reorder=${result.playlistReorderReady}`
        );
        return;
      }
      if (
        !result.genreIndexReady ||
        !result.genreDrilldownReady ||
        !result.genreHistoryReady ||
        !result.labelIndexReady ||
        !result.labelDrilldownReady ||
        !result.keyIndexReady ||
        !result.keyDrilldownReady ||
        !result.removedCollectionLinksReady
      ) {
        fail(
          `Collection indexes failed: genres=${result.genreIndexReady}, ` +
          `genreDrilldown=${result.genreDrilldownReady}, genreHistory=${result.genreHistoryReady}, ` +
          `labels=${result.labelIndexReady}, labelDrilldown=${result.labelDrilldownReady}, ` +
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
