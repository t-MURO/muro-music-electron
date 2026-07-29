import fs from "node:fs";
import path from "node:path";
import {
  closeDatabases,
  loadPlaylists,
  loadRecentlyPlayed,
  loadTracks,
  openDatabase,
  rebuildSearchIndex,
  refreshSearchText,
  searchTrackIds,
} from "./database.mjs";
import { createLibraryBackup, restoreLibraryBackup } from "./dataArchive.mjs";
import {
  createPlaylistSnapshot,
  deletePlaylistSnapshot,
  listPlaylistHistory,
  listPlaylistSnapshots,
  redoPlaylistHistory,
  restorePlaylistSnapshot,
  undoPlaylistHistory,
  withPlaylistHistory,
} from "./history.mjs";
import {
  AUDIO_EXTENSIONS,
  cacheCoverBytes,
  cacheCoverFile,
  collectAudioPaths,
  extractCoverMetadata,
  extractTechnicalMetadata,
  importAudioFile,
  readAudioDuration,
  writeMetadataToFile,
} from "./metadata.mjs";
import { createWaveformCache } from "./waveformCache.mjs";
import { createArtistProfileService } from "./artistProfiles.mjs";
import { createAlbumCoverService } from "./albumCovers.mjs";
import { createCastService } from "./cast/castService.mjs";
import { createDlnaService } from "./dlna/dlnaService.mjs";
import { createAcoustIdService } from "./acoustid.mjs";
import { exportAllPlaylists, exportOrganizedLibrary } from "./libraryExport.mjs";
import { createLibraryWatcher } from "./libraryWatcher.mjs";
import {
  acceptInboxTracks,
  findContainingWatchedFolder,
  isPathInsideOrEqual,
} from "./inboxOrganizer.mjs";
import {
  listPlaylistFilesForImport,
  readPlaylistForImport,
} from "./playlistFiles.mjs";
import { createPlaylistSyncService } from "./playlistSync.mjs";

const allowedUpdates = {
  title: "title",
  artist: "artist",
  artists: "album_artist",
  album: "album",
  trackNumber: "track_number",
  trackTotal: "track_total",
  discNumber: "disc_number",
  discTotal: "disc_total",
  year: "year",
  genre: "genre_json",
  comment: "comment_json",
  label: "label",
  bpm: "bpm",
  key: "key",
  rating: "rating",
  coverArtPath: "cover_art_path",
  coverArtThumbPath: "cover_art_thumb_path",
  musicBrainzTrackId: "musicbrainz_trackid",
  musicBrainzAlbumId: "musicbrainz_albumid",
  musicBrainzReleaseGroupId: "musicbrainz_releasegroupid",
  acoustIdId: "acoustid_id",
};

const MUSICBRAINZ_RECORDING_SEARCH = "https://musicbrainz.org/ws/2/recording/";
const MUSICBRAINZ_RELEASE_SEARCH = "https://musicbrainz.org/ws/2/release/";
const MUSICBRAINZ_USER_AGENT = "MuroMusicElectron/0.1.2 (https://github.com/t-MURO/muro-music-electron)";
const MUSICBRAINZ_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const createMusicBrainzFetcher = ({
  fetchImpl = globalThis.fetch,
  intervalMs = 1_100,
  requestTimeoutMs = 15_000,
  retryCount = 2,
} = {}) => {
  let requestQueue = Promise.resolve();
  let nextRequestAt = 0;

  const requestOnce = async (url) => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    nextRequestAt = Date.now() + intervalMs;
    return fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": MUSICBRAINZ_USER_AGENT },
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(requestTimeoutMs)
        : undefined,
    });
  };

  return (url) => {
    const request = requestQueue.then(async () => {
      let lastError;
      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          const response = await requestOnce(url);
          if (!MUSICBRAINZ_RETRYABLE_STATUSES.has(response.status) || attempt === retryCount) {
            return response;
          }
          await response.body?.cancel().catch(() => undefined);
        } catch (error) {
          lastError = error;
          if (attempt === retryCount) break;
        }
      }
      const cause = lastError?.cause ?? lastError;
      const code = typeof cause?.code === "string" ? ` (${cause.code})` : "";
      throw new Error(
        `MusicBrainz is temporarily unreachable${code}. Check your connection and try again.`,
        { cause: lastError },
      );
    });
    requestQueue = request.then(() => undefined, () => undefined);
    return request;
  };
};

const quotedMusicBrainzTerm = (value) => `"${String(value ?? "")
  .trim()
  .replace(/([\\"])/g, "\\$1")}"`;

const artistCreditName = (credit) => Array.isArray(credit)
  ? credit.map((entry) => `${entry?.name ?? entry?.artist?.name ?? ""}${entry?.joinphrase ?? ""}`).join("").trim()
  : "";

const searchTrackMetadata = async ({ title, artist, album }, fetchMusicBrainz) => {
  const cleanTitle = String(title ?? "").trim();
  const cleanArtist = String(artist ?? "").trim();
  if (!cleanTitle || !cleanArtist) throw new Error("Title and artist are required to search for metadata");

  const url = new URL(MUSICBRAINZ_RECORDING_SEARCH);
  url.searchParams.set(
    "query",
    `recording:${quotedMusicBrainzTerm(cleanTitle)} AND artist:${quotedMusicBrainzTerm(cleanArtist)}`,
  );
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "10");
  const response = await fetchMusicBrainz(url);
  if (!response.ok) throw new Error(`MusicBrainz metadata search failed (${response.status})`);
  const payload = await response.json();
  const candidates = [];
  for (const recording of Array.isArray(payload?.recordings) ? payload.recordings : []) {
    const releases = Array.isArray(recording?.releases) && recording.releases.length > 0
      ? recording.releases
      : [null];
    for (const release of releases) {
      const releaseTitle = String(release?.title ?? "").trim();
      const releaseArtist = artistCreditName(release?.["artist-credit"]);
      const tags = Array.isArray(recording?.tags) ? [...recording.tags] : [];
      tags.sort((left, right) => Number(right?.count ?? 0) - Number(left?.count ?? 0));
      candidates.push({
        id: `${recording.id}:${release?.id ?? "recording"}`,
        score: Number(recording?.score ?? 0),
        recordingId: recording?.id ?? null,
        releaseId: release?.id ?? null,
        releaseGroupId: release?.["release-group"]?.id ?? null,
        title: String(recording?.title ?? cleanTitle),
        artist: artistCreditName(recording?.["artist-credit"]) || cleanArtist,
        album: releaseTitle,
        albumArtist: releaseArtist || artistCreditName(recording?.["artist-credit"]) || cleanArtist,
        year: /^\d{4}/.test(String(release?.date ?? "")) ? Number(String(release.date).slice(0, 4)) : null,
        country: release?.country ?? null,
        status: release?.status ?? null,
        genre: tags[0]?.name ?? null,
        albumMatch: Boolean(album && releaseTitle.localeCompare(String(album), undefined, { sensitivity: "base" }) === 0),
      });
    }
  }
  candidates.sort((left, right) => (
    Number(right.albumMatch) - Number(left.albumMatch)
    || right.score - left.score
    || (left.year ?? 9999) - (right.year ?? 9999)
  ));
  return candidates.slice(0, 30);
};

const releaseYear = (release) => /^\d{4}/.test(String(release?.date ?? ""))
  ? Number(String(release.date).slice(0, 4))
  : null;

const releaseLabel = (release) => {
  const labels = Array.isArray(release?.["label-info"]) ? release["label-info"] : [];
  return labels.map((entry) => entry?.label?.name).filter(Boolean).join(", ") || null;
};

const releaseTrackCount = (release) => {
  const media = Array.isArray(release?.media) ? release.media : [];
  return media.reduce((total, medium) => total + Number(medium?.["track-count"] ?? medium?.tracks?.length ?? 0), 0);
};

const searchAlbumMetadata = async ({ album, artist }, fetchMusicBrainz) => {
  const cleanAlbum = String(album ?? "").trim();
  const cleanArtist = String(artist ?? "").trim();
  if (!cleanAlbum || !cleanArtist) throw new Error("Album and album artist are required to search for metadata");
  const url = new URL(MUSICBRAINZ_RELEASE_SEARCH);
  url.searchParams.set(
    "query",
    `release:${quotedMusicBrainzTerm(cleanAlbum)} AND artist:${quotedMusicBrainzTerm(cleanArtist)}`,
  );
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "15");
  const response = await fetchMusicBrainz(url);
  if (!response.ok) throw new Error(`MusicBrainz album search failed (${response.status})`);
  const payload = await response.json();
  return (Array.isArray(payload?.releases) ? payload.releases : []).map((release) => ({
    id: release.id,
    score: Number(release?.score ?? 0),
    title: String(release?.title ?? cleanAlbum),
    artist: artistCreditName(release?.["artist-credit"]) || cleanArtist,
    releaseGroupId: release?.["release-group"]?.id ?? null,
    year: releaseYear(release),
    country: release?.country ?? null,
    status: release?.status ?? null,
    barcode: release?.barcode ?? null,
    trackCount: releaseTrackCount(release),
    disambiguation: release?.disambiguation ?? null,
  })).sort((left, right) => right.score - left.score || (left.year ?? 9999) - (right.year ?? 9999));
};

const loadAlbumMetadata = async ({ releaseId }, fetchMusicBrainz) => {
  const id = String(releaseId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid MusicBrainz release ID");
  const url = new URL(`${MUSICBRAINZ_RELEASE_SEARCH}${id}`);
  url.searchParams.set("inc", "recordings+artist-credits+release-groups+labels+genres");
  url.searchParams.set("fmt", "json");
  const response = await fetchMusicBrainz(url);
  if (!response.ok) throw new Error(`MusicBrainz album lookup failed (${response.status})`);
  const release = await response.json();
  const media = Array.isArray(release?.media) ? release.media : [];
  const genres = Array.isArray(release?.genres) ? [...release.genres] : [];
  genres.sort((left, right) => Number(right?.count ?? 0) - Number(left?.count ?? 0));
  return {
    id: release.id,
    title: String(release?.title ?? ""),
    artist: artistCreditName(release?.["artist-credit"]),
    releaseGroupId: release?.["release-group"]?.id ?? null,
    year: releaseYear(release),
    country: release?.country ?? null,
    status: release?.status ?? null,
    label: releaseLabel(release),
    genre: genres[0]?.name ?? null,
    discTotal: media.length || null,
    tracks: media.flatMap((medium, mediumIndex) => {
      const tracks = Array.isArray(medium?.tracks) ? medium.tracks : [];
      return tracks.map((track, trackIndex) => ({
        id: track.id ?? `${mediumIndex + 1}:${trackIndex + 1}`,
        recordingId: track?.recording?.id ?? null,
        title: String(track?.title ?? track?.recording?.title ?? ""),
        artist: artistCreditName(track?.["artist-credit"])
          || artistCreditName(track?.recording?.["artist-credit"])
          || artistCreditName(release?.["artist-credit"]),
        trackNumber: Number(track?.position ?? trackIndex + 1),
        trackTotal: Number(medium?.["track-count"] ?? tracks.length),
        discNumber: Number(medium?.position ?? mediumIndex + 1),
        discTotal: media.length,
      }));
    }),
  };
};

const listJson = (value) => JSON.stringify(
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);

const exportPlaylistFile = async (dbPath, playlistId, filePath) => {
  const rows = openDatabase(dbPath).prepare(`
    SELECT t.source_path, t.duration_seconds, t.artist, t.title
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position ASC
  `).all(playlistId);
  const lines = ["#EXTM3U"];
  for (const row of rows) {
    const duration = Math.max(-1, Math.round(Number(row.duration_seconds) || -1));
    lines.push(`#EXTINF:${duration},${row.artist || "Unknown Artist"} - ${row.title || "Unknown Title"}`);
    lines.push(row.source_path);
  }
  await fs.promises.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await fs.promises.writeFile(filePath, `${lines.join("\r\n")}\r\n`, "utf8");
  return { exported: rows.length, filePath };
};

const bulkTrackOperation = (dbPath, trackIds, sqlPrefix) => {
  if (!trackIds.length) return;
  const db = openDatabase(dbPath);
  const placeholders = trackIds.map(() => "?").join(", ");
  db.prepare(`${sqlPrefix} (${placeholders})`).run(...trackIds);
};

const metadataValueFromDatabase = (key, value) => {
  if (key !== "genre" && key !== "comment") return value;
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const updateTrackMetadata = async (dbPath, trackIds, updates, source = "user") => {
  if (!trackIds.length || Object.keys(updates).length === 0) {
    return { updated: 0, filesWritten: 0, fileWriteErrors: [] };
  }
  const db = openDatabase(dbPath);
  const entries = Object.entries(updates)
    .filter(([key]) => allowedUpdates[key])
    .map(([key, value]) => [
      allowedUpdates[key],
      key === "genre" || key === "comment" ? listJson(value) : value,
    ]);
  if (!entries.length) return { updated: 0, filesWritten: 0, fileWriteErrors: [] };

  const updateDatabase = db.transaction(() => {
    const historyInsert = db.prepare(`
      INSERT INTO metadata_change_history(track_id, changed_at, source, changes_json)
      VALUES (?, ?, ?, ?)
    `);
    const selectCurrent = db.prepare(
      `SELECT ${entries.map(([column]) => column).join(", ")} FROM tracks WHERE id = ?`,
    );
    const changedAt = new Date().toISOString();
    for (const id of trackIds) {
      const current = selectCurrent.get(id);
      if (!current) continue;
      const changes = {};
      for (const [key, requestedValue] of Object.entries(updates)) {
        const column = allowedUpdates[key];
        if (!column) continue;
        const before = metadataValueFromDatabase(key, current[column]);
        const after = metadataValueFromDatabase(
          key,
          key === "genre" || key === "comment" ? listJson(requestedValue) : requestedValue,
        );
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          changes[key] = { before, after };
        }
      }
      if (Object.keys(changes).length) {
        historyInsert.run(id, changedAt, String(source || "user"), JSON.stringify(changes));
      }
    }
    const set = entries.map(([column]) => `${column} = ?`).join(", ");
    const placeholders = trackIds.map(() => "?").join(", ");
    db.prepare(`UPDATE tracks SET ${set}, updated_at = ? WHERE id IN (${placeholders})`)
      .run(...entries.map(([, value]) => value), Math.floor(Date.now() / 1000), ...trackIds);
    for (const id of trackIds) refreshSearchText(db, id);
  });
  updateDatabase();

  const sourceQuery = db.prepare("SELECT source_path FROM tracks WHERE id = ?");
  const errorUpdate = db.prepare("UPDATE tracks SET last_write_error = ? WHERE id = ?");
  let filesWritten = 0;
  const fileWriteErrors = [];
  for (const id of trackIds) {
    const sourcePath = sourceQuery.get(id)?.source_path;
    if (!sourcePath) continue;
    try {
      await writeMetadataToFile(sourcePath, updates);
      errorUpdate.run(null, id);
      filesWritten += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorUpdate.run(message, id);
      fileWriteErrors.push({ trackId: id, fileName: path.basename(sourcePath), message });
      console.warn(`Failed to write metadata to ${sourcePath}:`, error);
    }
  }
  return { updated: trackIds.length, filesWritten, fileWriteErrors };
};

export const createBackend = ({
  cacheDir,
  emit,
  keyFinder,
  waveformCacheDir,
  artistProfileCacheDir,
  metadataFetchImpl,
  musicBrainzIntervalMs,
  castService: castServiceOverride,
  dlnaService: dlnaServiceOverride,
  acoustIdService: acoustIdServiceOverride,
  fpcalcBinaryDirectories = [],
}) => {
  const artistCacheDir = artistProfileCacheDir ?? path.join(path.dirname(cacheDir), "artists");
  const artistProfiles = createArtistProfileService({ cacheDir: artistCacheDir });
  const acoustId = acoustIdServiceOverride ?? createAcoustIdService({
    binaryDirectories: fpcalcBinaryDirectories,
  });
  const albumCovers = createAlbumCoverService({ cacheDir });
  const fetchMusicBrainz = createMusicBrainzFetcher({
    fetchImpl: metadataFetchImpl,
    intervalMs: musicBrainzIntervalMs,
  });
  const waveformCache = createWaveformCache({
    cacheDir: waveformCacheDir ?? path.join(path.dirname(cacheDir), "waveforms"),
  });
  const castService = castServiceOverride ?? createCastService({ emit });
  const dlnaService = dlnaServiceOverride ?? createDlnaService({ emit });
  // The watcher fires outside any invoke() call, so it keeps a reference to the
  // most recent sender rather than receiving one per event.
  let lastSender = null;
  const libraryWatcher = createLibraryWatcher({
    cacheDir,
    emit,
    getSender: () => lastSender,
  });
  const playlistSync = createPlaylistSyncService({
    cacheDir,
    emit,
    getSender: () => lastSender,
  });
  const commands = {
    ...castService.commands,
    ...dlnaService.commands,
    async import_files({
      paths,
      dbPath,
      nativeFolderDrop,
      watchedFolders,
      moveToWatchedFolderOnAcceptPaths,
    }, sender) {
      const inputPaths = Array.isArray(paths) ? paths : [];
      const audioPaths = await collectAudioPaths(inputPaths);
      const normalizedWatchedFolders = Array.isArray(watchedFolders)
        ? watchedFolders
            .map((folder) => String(folder ?? "").trim())
            .filter(Boolean)
            .map((folder) => path.resolve(folder))
        : [];
      const explicitlyMarkedPaths = new Set(
        (Array.isArray(moveToWatchedFolderOnAcceptPaths)
          ? moveToWatchedFolderOnAcceptPaths
          : [])
          .map((filePath) => String(filePath ?? "").trim())
          .filter(Boolean)
          .map((filePath) => path.resolve(filePath)),
      );
      const droppedFolders = [];
      if (nativeFolderDrop) {
        for (const inputPath of inputPaths) {
          const resolvedPath = path.resolve(String(inputPath ?? ""));
          try {
            if ((await fs.promises.stat(resolvedPath)).isDirectory()) {
              droppedFolders.push(resolvedPath);
            }
          } catch {
            // The importer will report or ignore unreadable inputs normally.
          }
        }
      }
      const imported = [];
      const failures = [];
      for (let index = 0; index < audioPaths.length; index += 1) {
        try {
          const audioPath = audioPaths[index];
          const moveToWatchedFolderOnAccept =
            explicitlyMarkedPaths.has(path.resolve(audioPath))
            || (
              normalizedWatchedFolders.length > 0
              && droppedFolders.some((folder) => isPathInsideOrEqual(audioPath, folder))
              && !findContainingWatchedFolder(audioPath, normalizedWatchedFolders)
            );
          const track = await importAudioFile(dbPath, audioPath, cacheDir, {
            moveToWatchedFolderOnAccept,
          });
          if (track) imported.push(track);
          else if (moveToWatchedFolderOnAccept) {
            // A previous import of the same staged file may have won a race.
            // Preserve the folder-drop intent on that existing Inbox row.
            openDatabase(dbPath).prepare(`
              UPDATE tracks
              SET move_to_watched_folder_on_accept = 1
              WHERE source_path = ? AND import_status = 'staged'
            `).run(audioPath);
          }
        } catch (error) {
          console.warn(`Failed to import ${audioPaths[index]}:`, error);
          failures.push({
            path: audioPaths[index],
            message: error instanceof Error ? error.message : String(error),
          });
        }
        emit(sender, "muro://import-progress", {
          imported: index + 1,
          total: audioPaths.length,
          phase: "importing",
        });
      }
      return {
        imported,
        scanned: audioPaths.length,
        failures,
      };
    },

    load_tracks: ({ dbPath }) => loadTracks(dbPath),
    load_playlists: ({ dbPath }) => loadPlaylists(dbPath),
    load_recently_played: ({ dbPath, limit }) => loadRecentlyPlayed(dbPath, limit),
    create_library_backup: ({ dbPath, destinationPath, settingsJson, smartCratesJson }) =>
      createLibraryBackup({ dbPath, destinationPath, settingsJson, smartCratesJson }),
    restore_library_backup: ({ dbPath, archivePath }) =>
      restoreLibraryBackup({
        dbPath,
        archivePath,
        artworkRoot: path.dirname(cacheDir),
      }),
    load_cached_artist_profiles: ({ dbPath }) =>
      artistProfiles.loadCachedProfiles(openDatabase(dbPath)),
    get_artist_profile: ({ dbPath, artistName, force, fanartApiKey, lastFmApiKey, theAudioDbApiKey }) =>
      artistProfiles.getProfile(openDatabase(dbPath), artistName, {
        force: Boolean(force),
        fanartApiKey,
        lastFmApiKey,
        theAudioDbApiKey,
      }),
    search_artist_images: ({
      dbPath,
      artistName,
      braveSearchApiKey,
      fanartApiKey,
      lastFmApiKey,
      theAudioDbApiKey,
    }) =>
      artistProfiles.searchImages(openDatabase(dbPath), artistName, {
        braveSearchApiKey,
        fanartApiKey,
        lastFmApiKey,
        theAudioDbApiKey,
      }),
    set_artist_image: ({ dbPath, artistName, candidate }) =>
      artistProfiles.setImage(openDatabase(dbPath), artistName, candidate),
    scan_artist_profiles: ({ dbPath, fanartApiKey, lastFmApiKey, theAudioDbApiKey, limit }) =>
      artistProfiles.scanProfiles(openDatabase(dbPath), {
        fanartApiKey,
        lastFmApiKey,
        theAudioDbApiKey,
        limit,
      }),
    fetch_track_cover_art: ({ dbPath, trackId, album, artist }) =>
      albumCovers.fetchCoverForTrack(openDatabase(dbPath), {
        trackId,
        album,
        artist,
      }),
    search_album_cover_images: ({ album, artist, braveSearchApiKey }) =>
      albumCovers.searchBraveCovers({
        album,
        artist,
        apiKey: braveSearchApiKey,
      }),
    cache_album_cover_candidate: ({ candidate }) =>
      albumCovers.cacheCoverCandidate(candidate),
    search_track_metadata: ({ title, artist, album }) =>
      searchTrackMetadata({ title, artist, album }, fetchMusicBrainz),
    search_album_metadata: ({ album, artist }) =>
      searchAlbumMetadata({ album, artist }, fetchMusicBrainz),
    load_album_metadata: ({ releaseId }) =>
      loadAlbumMetadata({ releaseId }, fetchMusicBrainz),
    identify_track_acoustid: ({ dbPath, trackId, clientKey, force }) =>
      acoustId.identifyTrack(openDatabase(dbPath), { trackId, clientKey, force }),

    clear_tracks: async ({ dbPath }) => {
      const db = openDatabase(dbPath);
      db.prepare("DELETE FROM tracks").run();
      db.prepare("DELETE FROM artist_profiles").run();
      db.prepare("DELETE FROM album_cover_cache").run();
      if (fs.existsSync(cacheDir)) {
        for (const entry of fs.readdirSync(cacheDir)) {
          const candidate = path.join(cacheDir, entry);
          if (fs.statSync(candidate).isFile()) fs.unlinkSync(candidate);
        }
      }
      await waveformCache.clear();
      await fs.promises.rm(artistCacheDir, { recursive: true, force: true });
    },

    accept_tracks: ({ dbPath, trackIds, organize, watchedFolders }) =>
      acceptInboxTracks({ dbPath, trackIds, organize, watchedFolders }),
    unaccept_tracks: ({ dbPath, trackIds }) =>
      bulkTrackOperation(dbPath, trackIds, "UPDATE tracks SET import_status = 'staged' WHERE id IN"),
    reject_tracks: ({ dbPath, trackIds }) =>
      bulkTrackOperation(dbPath, trackIds, "DELETE FROM tracks WHERE id IN"),
    delete_tracks: async ({ dbPath, trackIds, deleteFromDisk }) => {
      const ids = [...new Set(
        (Array.isArray(trackIds) ? trackIds : [])
          .map((id) => String(id))
          .filter(Boolean),
      )];
      if (ids.length === 0) return { deletedTrackIds: [], failures: [] };

      let deletedTrackIds = ids;
      const failures = [];
      if (deleteFromDisk) {
        const db = openDatabase(dbPath);
        const findTrack = db.prepare("SELECT id, source_path FROM tracks WHERE id = ?");
        deletedTrackIds = [];
        for (const id of ids) {
          const row = findTrack.get(id);
          if (!row) continue;
          try {
            await fs.promises.unlink(row.source_path);
            await waveformCache.invalidateSource(row.source_path);
            deletedTrackIds.push(id);
          } catch (error) {
            if (error?.code === "ENOENT") {
              await waveformCache.invalidateSource(row.source_path);
              deletedTrackIds.push(id);
              continue;
            }
            failures.push({
              trackId: id,
              path: row.source_path,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      bulkTrackOperation(dbPath, deletedTrackIds, "DELETE FROM tracks WHERE id IN");
      return { deletedTrackIds, failures };
    },

    create_playlist: async ({
      dbPath,
      id,
      name,
      folderId,
      sortOrder,
      sourcePath,
    }) => {
      const db = openDatabase(dbPath);
      const linkedSourcePath = sourcePath
        ? path.resolve(String(sourcePath))
        : null;
      const result = withPlaylistHistory(db, `Create playlist: ${String(name).trim()}`, () => {
        const targetFolderId = folderId || null;
        const nextSortOrder = Number.isInteger(sortOrder)
          ? sortOrder
          : db.prepare(`
              SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
              FROM playlists
              WHERE folder_id = ? OR (folder_id IS NULL AND ? IS NULL)
            `).get(targetFolderId, targetFolderId).next;
        db.prepare(`
          INSERT INTO playlists(
            id, name, folder_id, sort_order, source_path, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          id,
          String(name).trim(),
          targetFolderId,
          nextSortOrder,
          linkedSourcePath,
          Math.floor(Date.now() / 1000),
        );
      });
      await playlistSync.refreshSources({ dbPath, syncChanged: false });
      return result;
    },
    update_playlist: ({ dbPath, playlistId, name, folderId, sortOrder }) => {
      const db = openDatabase(dbPath);
      return withPlaylistHistory(db, name !== undefined ? "Rename playlist" : "Move playlist", () => {
        if (name !== undefined) {
          db.prepare("UPDATE playlists SET name = ? WHERE id = ?")
            .run(String(name).trim(), playlistId);
        }
        if (folderId !== undefined) {
          const targetFolderId = folderId || null;
          const nextSortOrder = Number.isInteger(sortOrder)
            ? sortOrder
            : db.prepare(`
                SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
                FROM playlists
                WHERE folder_id = ? OR (folder_id IS NULL AND ? IS NULL)
              `).get(targetFolderId, targetFolderId).next;
          db.prepare("UPDATE playlists SET folder_id = ?, sort_order = ? WHERE id = ?")
            .run(targetFolderId, nextSortOrder, playlistId);
        } else if (Number.isInteger(sortOrder)) {
          db.prepare("UPDATE playlists SET sort_order = ? WHERE id = ?")
            .run(sortOrder, playlistId);
        }
      });
    },
    reorder_playlists: ({ dbPath, items }) => {
      const db = openDatabase(dbPath);
      const update = db.prepare(
        "UPDATE playlists SET folder_id = ?, sort_order = ? WHERE id = ?"
      );
      withPlaylistHistory(db, "Reorder playlists", () => {
        for (const item of Array.isArray(items) ? items : []) {
          update.run(item.folderId || null, Number(item.sortOrder) || 0, item.id);
        }
      });
    },
    delete_playlist: async ({ dbPath, playlistId }) => {
      const db = openDatabase(dbPath);
      const result = withPlaylistHistory(db, "Delete playlist", () =>
        db.prepare("DELETE FROM playlists WHERE id = ?").run(playlistId));
      await playlistSync.refreshSources({ dbPath, syncChanged: false });
      return result;
    },
    delete_playlists: async ({ dbPath, playlistIds }) => {
      const ids = [...new Set(
        (Array.isArray(playlistIds) ? playlistIds : [])
          .map((id) => String(id))
          .filter(Boolean),
      )];
      if (ids.length === 0) return { deleted: 0 };
      const db = openDatabase(dbPath);
      const placeholders = ids.map(() => "?").join(", ");
      const result = withPlaylistHistory(db, `Delete ${ids.length} playlists`, () => {
        const result = db.prepare(`DELETE FROM playlists WHERE id IN (${placeholders})`).run(...ids);
        return { deleted: Number(result.changes) || 0 };
      });
      await playlistSync.refreshSources({ dbPath, syncChanged: false });
      return result;
    },
    restore_playlists: async ({ dbPath, playlists }) => {
      const requested = Array.isArray(playlists) ? playlists : [];
      if (requested.length === 0) return { restored: 0 };
      const db = openDatabase(dbPath);
      const existingTrackIds = new Set(
        db.prepare("SELECT id FROM tracks").all().map((row) => String(row.id)),
      );
      const insertPlaylist = db.prepare(`
        INSERT INTO playlists(
          id, name, folder_id, sort_order, source_path, source_mtime_ms,
          source_size, source_sync_error, last_synced_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertTrack = db.prepare(`
        INSERT INTO playlist_tracks(playlist_id, track_id, position)
        VALUES (?, ?, ?)
      `);
      const result = withPlaylistHistory(db, `Restore ${requested.length} playlists`, () => {
        let restored = 0;
        for (const playlist of requested) {
          const id = String(playlist?.id ?? "");
          const name = String(playlist?.name ?? "").trim();
          if (!id || !name) throw new Error("Invalid playlist restore payload");
          insertPlaylist.run(
            id,
            name,
            playlist.folderId ? String(playlist.folderId) : null,
            Number(playlist.sortOrder) || 0,
            playlist.sourcePath ? path.resolve(String(playlist.sourcePath)) : null,
            playlist.sourceMtimeMs == null ? null : Number(playlist.sourceMtimeMs),
            playlist.sourceSize == null ? null : Number(playlist.sourceSize),
            playlist.sourceSyncError == null ? null : String(playlist.sourceSyncError),
            playlist.lastSyncedAt == null ? null : Number(playlist.lastSyncedAt),
            Math.floor(Date.now() / 1000),
          );
          const trackIds = [...new Set(
            (Array.isArray(playlist.trackIds) ? playlist.trackIds : [])
              .map((trackId) => String(trackId))
              .filter((trackId) => existingTrackIds.has(trackId)),
          )];
          trackIds.forEach((trackId, position) => insertTrack.run(id, trackId, position));
          restored += 1;
        }
        return { restored };
      });
      await playlistSync.refreshSources({ dbPath, syncChanged: false });
      return result;
    },
    create_playlist_folder: ({ dbPath, id, name, parentId, sortOrder }) => {
      const db = openDatabase(dbPath);
      const targetParentId = parentId || null;
      const nextSortOrder = Number.isInteger(sortOrder)
        ? sortOrder
        : db.prepare(`
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
            FROM playlist_folders
            WHERE parent_id = ? OR (parent_id IS NULL AND ? IS NULL)
          `).get(targetParentId, targetParentId).next;
      return withPlaylistHistory(db, `Create playlist folder: ${String(name).trim()}`, () =>
        db.prepare(`
          INSERT INTO playlist_folders(id, name, parent_id, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, String(name).trim(), targetParentId, nextSortOrder, Math.floor(Date.now() / 1000)));
    },
    update_playlist_folder: ({ dbPath, folderId, name, parentId, sortOrder }) => {
      const db = openDatabase(dbPath);
      return withPlaylistHistory(db, name !== undefined ? "Rename playlist folder" : "Move playlist folder", () => {
        if (name !== undefined) {
          db.prepare("UPDATE playlist_folders SET name = ? WHERE id = ?")
            .run(String(name).trim(), folderId);
        }
        if (parentId !== undefined) {
          db.prepare("UPDATE playlist_folders SET parent_id = ? WHERE id = ?")
            .run(parentId || null, folderId);
        }
        if (Number.isInteger(sortOrder)) {
          db.prepare("UPDATE playlist_folders SET sort_order = ? WHERE id = ?")
            .run(sortOrder, folderId);
        }
      });
    },
    delete_playlist_folder: ({ dbPath, folderId }) => {
      const db = openDatabase(dbPath);
      return withPlaylistHistory(db, "Delete playlist folder", () => {
        const parentId = db.prepare("SELECT parent_id FROM playlist_folders WHERE id = ?")
          .get(folderId)?.parent_id ?? null;
        let playlistSortOrder = db.prepare(`
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
          FROM playlists
          WHERE folder_id = ? OR (folder_id IS NULL AND ? IS NULL)
        `).get(parentId, parentId).next;
        const movePlaylist = db.prepare(
          "UPDATE playlists SET folder_id = ?, sort_order = ? WHERE id = ?"
        );
        for (const playlist of db.prepare(`
          SELECT id FROM playlists WHERE folder_id = ? ORDER BY sort_order, id
        `).all(folderId)) {
          movePlaylist.run(parentId, playlistSortOrder, playlist.id);
          playlistSortOrder += 1;
        }
        let folderSortOrder = db.prepare(`
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
          FROM playlist_folders
          WHERE id <> ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))
        `).get(folderId, parentId, parentId).next;
        const moveFolder = db.prepare(
          "UPDATE playlist_folders SET parent_id = ?, sort_order = ? WHERE id = ?"
        );
        for (const folder of db.prepare(`
          SELECT id FROM playlist_folders WHERE parent_id = ? ORDER BY sort_order, id
        `).all(folderId)) {
          moveFolder.run(parentId, folderSortOrder, folder.id);
          folderSortOrder += 1;
        }
        db.prepare("DELETE FROM playlist_folders WHERE id = ?").run(folderId);
      });
    },
    list_playlist_files: ({ directoryPath }) => listPlaylistFilesForImport(directoryPath),
    import_playlist_file: ({ dbPath, filePath }) => readPlaylistForImport(dbPath, filePath),
    configure_playlist_sync: ({ dbPath }) =>
      playlistSync.refreshSources({ dbPath, syncChanged: true }),
    sync_playlist_source: ({ dbPath, playlistId }) =>
      playlistSync.syncPlaylist({ dbPath, playlistId, force: true, reason: "manual" }),
    export_playlist_file: ({ dbPath, playlistId, filePath }) =>
      exportPlaylistFile(dbPath, playlistId, filePath),
    export_all_playlists: ({ dbPath, destinationPath }) =>
      exportAllPlaylists({ dbPath, destinationPath }),
    export_organized_library: ({ dbPath, destinationPath, useAsCurrentLibrary }, sender) =>
      exportOrganizedLibrary({
        dbPath,
        destinationPath,
        useAsCurrentLibrary: Boolean(useAsCurrentLibrary),
        onProgress: (progress) => emit(sender, "muro://library-export-progress", progress),
      }),
    add_tracks_to_playlist: ({ dbPath, playlistId, trackIds }) => {
      if (!trackIds.length) return;
      const db = openDatabase(dbPath);
      return withPlaylistHistory(db, "Add tracks to playlist", () => {
        let position = db.prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?"
        ).get(playlistId).next;
        const exists = db.prepare(
          "SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?"
        );
        const insert = db.prepare(
          "INSERT INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)"
        );
        for (const trackId of [...new Set(trackIds)]) {
          if (exists.get(playlistId, trackId)) continue;
          insert.run(playlistId, trackId, position++);
        }
      });
    },
    set_playlist_tracks: ({ dbPath, playlistId, trackIds }) => {
      const db = openDatabase(dbPath);
      const ids = [...new Set(
        (Array.isArray(trackIds) ? trackIds : [])
          .map((id) => String(id))
          .filter(Boolean),
      )];
      return withPlaylistHistory(db, "Reorder playlist tracks", () => {
        db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
        const insert = db.prepare(
          "INSERT INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)"
        );
        ids.forEach((trackId, position) => insert.run(playlistId, trackId, position));
      });
    },
    remove_last_tracks_from_playlist: ({ dbPath, playlistId, count }) => {
      const db = openDatabase(dbPath);
      return withPlaylistHistory(db, "Remove tracks from playlist", () =>
        db.prepare(`
          DELETE FROM playlist_tracks WHERE rowid IN (
            SELECT rowid FROM playlist_tracks WHERE playlist_id = ?
            ORDER BY position DESC LIMIT ?
          )
        `).run(playlistId, Math.max(0, Number(count) || 0)));
    },

    update_track_metadata: ({ dbPath, trackIds, updates }) =>
      updateTrackMetadata(dbPath, trackIds, updates),
    list_metadata_history: ({ dbPath, trackId, limit }) => {
      const db = openDatabase(dbPath);
      const bounded = Math.max(1, Math.min(Number(limit) || 100, 500));
      const where = trackId ? "WHERE h.track_id = ?" : "";
      return db.prepare(`
        SELECT h.id, h.track_id, h.changed_at, h.source, h.changes_json,
               t.title, t.artist
        FROM metadata_change_history h
        LEFT JOIN tracks t ON t.id = h.track_id
        ${where}
        ORDER BY h.id DESC
        LIMIT ?
      `).all(...(trackId ? [trackId, bounded] : [bounded])).map((row) => ({
        id: Number(row.id),
        trackId: String(row.track_id),
        changedAt: String(row.changed_at),
        source: String(row.source),
        changes: JSON.parse(row.changes_json),
        title: row.title ?? "Unknown Title",
        artist: row.artist ?? "Unknown Artist",
      }));
    },
    rollback_metadata_change: async ({ dbPath, historyId, field }) => {
      const row = openDatabase(dbPath).prepare(`
        SELECT track_id, changes_json FROM metadata_change_history WHERE id = ?
      `).get(historyId);
      if (!row) throw new Error("Metadata history entry was not found");
      const changes = JSON.parse(row.changes_json);
      if (!allowedUpdates[field] || !Object.hasOwn(changes, field)) {
        throw new Error("That field is not part of this metadata change");
      }
      return updateTrackMetadata(
        dbPath,
        [String(row.track_id)],
        { [field]: changes[field].before },
        "rollback",
      );
    },
    list_playlist_history: ({ dbPath, limit }) =>
      listPlaylistHistory(openDatabase(dbPath), limit),
    undo_playlist_history: async ({ dbPath }) => {
      const result = undoPlaylistHistory(openDatabase(dbPath));
      await playlistSync.refreshSources({ dbPath, syncChanged: false });
      return result;
    },
    redo_playlist_history: async ({ dbPath }) => {
      const result = redoPlaylistHistory(openDatabase(dbPath));
      await playlistSync.refreshSources({ dbPath, syncChanged: false });
      return result;
    },
    create_playlist_snapshot: ({ dbPath, name }) =>
      createPlaylistSnapshot(openDatabase(dbPath), name),
    list_playlist_snapshots: ({ dbPath }) =>
      listPlaylistSnapshots(openDatabase(dbPath)),
    restore_playlist_snapshot: async ({ dbPath, snapshotId }) => {
      const result = restorePlaylistSnapshot(openDatabase(dbPath), snapshotId);
      await playlistSync.refreshSources({ dbPath, syncChanged: false });
      return result;
    },
    delete_playlist_snapshot: ({ dbPath, snapshotId }) =>
      deletePlaylistSnapshot(openDatabase(dbPath), snapshotId),
    update_track_analysis: ({ dbPath, trackId, bpm, key }) => {
      openDatabase(dbPath)
        .prepare("UPDATE tracks SET bpm = ?, key = ?, updated_at = ? WHERE id = ?")
        .run(bpm ?? null, key ?? null, Math.floor(Date.now() / 1000), trackId);
    },
    update_track_beat_grid: ({ dbPath, trackId, beatGridJson }) => {
      const invalid = () => new Error("Invalid beat grid payload");
      if (typeof trackId !== "string" || trackId.length === 0) throw invalid();
      if (typeof beatGridJson !== "string" || beatGridJson.length > 4096) throw invalid();
      let parsed;
      try {
        parsed = JSON.parse(beatGridJson);
      } catch {
        throw invalid();
      }
      if (parsed == null || typeof parsed !== "object" || typeof parsed.bpm !== "number") {
        throw invalid();
      }
      const result = openDatabase(dbPath)
        .prepare("UPDATE tracks SET beat_grid_json = ?, updated_at = ? WHERE id = ?")
        .run(beatGridJson, Math.floor(Date.now() / 1000), trackId);
      return { updated: result.changes > 0 };
    },
    /**
     * Stat every library track and record whether its file is still there.
     * Inbox entries are included because a staged file can vanish too.
     */
    verify_library_files: ({ dbPath }) => {
      const db = openDatabase(dbPath);
      const rows = db.prepare("SELECT id, source_path, is_missing FROM tracks").all();
      const mark = db.prepare("UPDATE tracks SET is_missing = ? WHERE id = ?");

      let missing = 0;
      let restored = 0;
      let stillMissing = 0;
      db.transaction(() => {
        for (const row of rows) {
          const exists = Boolean(row.source_path) && fs.existsSync(row.source_path);
          const wasMissing = Number(row.is_missing) === 1;
          if (!exists) {
            stillMissing += 1;
            if (!wasMissing) {
              mark.run(1, row.id);
              missing += 1;
            }
          } else if (wasMissing) {
            mark.run(0, row.id);
            restored += 1;
          }
        }
      })();

      return { checked: rows.length, newlyMissing: missing, restored, missing: stillMissing };
    },

    list_missing_tracks: ({ dbPath }) =>
      openDatabase(dbPath).prepare(`
        SELECT id, title, artist, album, source_path, filename, duration_seconds
        FROM tracks
        WHERE is_missing = 1
        ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_number
      `).all().map((row) => ({
        id: String(row.id),
        title: row.title || "",
        artist: row.artist || "",
        album: row.album || "",
        source_path: row.source_path || "",
        filename: row.filename || "",
        duration_seconds: row.duration_seconds || 0,
      })),

    /** Point a track at a new file. The replacement must actually exist. */
    relink_track: ({ dbPath, trackId, newPath }) => {
      if (typeof trackId !== "string" || !trackId) throw new Error("A track is required");
      const resolved = path.resolve(String(newPath ?? ""));
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        throw new Error("The selected file does not exist");
      }
      if (!AUDIO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
        throw new Error("The selected file is not a supported audio format");
      }

      const db = openDatabase(dbPath);
      const clash = db
        .prepare("SELECT id FROM tracks WHERE source_path = ? AND id != ?")
        .get(resolved, trackId);
      if (clash) throw new Error("Another track already uses that file");

      db.prepare(`
        UPDATE tracks
        SET source_path = ?, filename = ?, is_missing = 0, updated_at = ?
        WHERE id = ?
      `).run(resolved, path.basename(resolved), Math.floor(Date.now() / 1000), trackId);
      refreshSearchText(db, trackId);
      return { relinked: true, sourcePath: resolved };
    },

    /**
     * Match missing tracks against the audio files under a directory.
     *
     * A file name alone is ambiguous across a large collection, so a candidate
     * only counts when the duration also matches within a second — enough to
     * absorb decoder rounding without pairing two different songs.
     */
    auto_relink_missing: async ({ dbPath, searchDir, dryRun }) => {
      const root = path.resolve(String(searchDir ?? ""));
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error("Choose a folder to search");
      }

      const db = openDatabase(dbPath);
      const missing = db.prepare(`
        SELECT id, filename, source_path, duration_seconds
        FROM tracks WHERE is_missing = 1
      `).all();
      if (missing.length === 0) return { matched: 0, relinked: 0, matches: [] };

      const candidatePaths = await collectAudioPaths([root]);
      const knownPaths = new Set(
        db.prepare("SELECT source_path FROM tracks WHERE is_missing = 0").all()
          .map((row) => row.source_path),
      );

      const byName = new Map();
      for (const candidate of candidatePaths) {
        if (knownPaths.has(candidate)) continue;
        const key = path.basename(candidate).toLowerCase();
        const bucket = byName.get(key) ?? [];
        bucket.push(candidate);
        byName.set(key, bucket);
      }

      const update = db.prepare(`
        UPDATE tracks
        SET source_path = ?, filename = ?, is_missing = 0, updated_at = ?
        WHERE id = ?
      `);
      const matches = [];
      const taken = new Set();

      for (const track of missing) {
        const name = String(track.filename || path.basename(track.source_path || "")).toLowerCase();
        if (!name) continue;
        const bucket = byName.get(name);
        if (!bucket) continue;

        const expected = Number(track.duration_seconds) || 0;
        // Without a known duration there is no safe automatic discriminator.
        // Leave the track for manual relinking rather than pairing by a common
        // file name alone.
        if (!(expected > 0)) continue;
        let chosen = null;
        for (const candidate of bucket) {
          if (taken.has(candidate)) continue;
          const probe = await readAudioDuration(candidate);
          if (!(probe > 0) || Math.abs(probe - expected) > 1) continue;
          chosen = candidate;
          break;
        }
        if (!chosen) continue;

        taken.add(chosen);
        matches.push({ trackId: String(track.id), sourcePath: chosen });
      }

      if (!dryRun && matches.length > 0) {
        const now = Math.floor(Date.now() / 1000);
        db.transaction(() => {
          for (const match of matches) {
            update.run(match.sourcePath, path.basename(match.sourcePath), now, match.trackId);
            refreshSearchText(db, match.trackId);
          }
        })();
      }

      return {
        matched: matches.length,
        relinked: dryRun ? 0 : matches.length,
        matches,
      };
    },

    update_track_loudness: ({ dbPath, trackId, integratedLufs, gainDb, peak, source }) => {
      if (typeof trackId !== "string" || trackId.length === 0) {
        throw new Error("Invalid loudness payload");
      }
      const number = (value) =>
        typeof value === "number" && Number.isFinite(value) ? value : null;
      const result = openDatabase(dbPath).prepare(`
        UPDATE tracks SET
          loudness_lufs = ?,
          replaygain_track_gain_db = ?,
          replaygain_track_peak = ?,
          loudness_source = ?
        WHERE id = ?
      `).run(
        number(integratedLufs),
        number(gainDb),
        number(peak),
        source === "tag" ? "tag" : "analyzed",
        trackId,
      );
      return { updated: result.changes > 0 };
    },

    /**
     * Tracks with no usable gain value yet. Files that arrived with ReplayGain
     * tags are already covered and are not returned.
     */
    list_tracks_needing_loudness: ({ dbPath, limit }) => {
      const max = Math.max(1, Math.min(Number(limit) || 250, 2000));
      return openDatabase(dbPath).prepare(`
        SELECT id, source_path
        FROM tracks
        WHERE replaygain_track_gain_db IS NULL
          AND import_status != 'staged'
          AND COALESCE(is_missing, 0) = 0
        ORDER BY added_at DESC
        LIMIT ?
      `).all(max).map((row) => ({ id: String(row.id), source_path: row.source_path }));
    },

    /**
     * Album gain is the loudness of the release as a whole, so it is derived
     * from the album's combined loudness rather than by averaging track gains.
     * Tracks are grouped the way the library groups them: album artist (falling
     * back to artist) plus album title.
     */
    recompute_album_gain: ({ dbPath, referenceLufs }) => {
      const db = openDatabase(dbPath);
      const reference =
        typeof referenceLufs === "number" && Number.isFinite(referenceLufs)
          ? referenceLufs
          : -18;
      const rows = db.prepare(`
        SELECT id, album, COALESCE(NULLIF(album_artist, ''), artist) AS grouping_artist,
          loudness_lufs, replaygain_track_peak
        FROM tracks
        WHERE loudness_lufs IS NOT NULL AND album IS NOT NULL AND album != ''
      `).all();

      const albums = new Map();
      for (const row of rows) {
        const key = `${String(row.grouping_artist ?? "").toLowerCase()} ${String(row.album).toLowerCase()}`;
        const bucket = albums.get(key) ?? { ids: [], meanSquares: [], peak: 0 };
        bucket.ids.push(row.id);
        // Undo the log so the release's blocks average in the energy domain.
        bucket.meanSquares.push(Math.pow(10, (Number(row.loudness_lufs) + 0.691) / 10));
        const peak = Number(row.replaygain_track_peak);
        if (Number.isFinite(peak) && peak > bucket.peak) bucket.peak = peak;
        albums.set(key, bucket);
      }

      const update = db.prepare(
        "UPDATE tracks SET replaygain_album_gain_db = ?, replaygain_album_peak = ? WHERE id = ?"
      );
      let updated = 0;
      db.transaction(() => {
        for (const bucket of albums.values()) {
          const mean =
            bucket.meanSquares.reduce((sum, value) => sum + value, 0) / bucket.meanSquares.length;
          if (!(mean > 0)) continue;
          const albumLufs = -0.691 + 10 * Math.log10(mean);
          const albumGain = reference - albumLufs;
          for (const id of bucket.ids) {
            update.run(albumGain, bucket.peak || null, id);
            updated += 1;
          }
        }
      })();
      return { albums: albums.size, updated };
    },

    keyfinder_health: () => keyFinder.health(),
    start_track_analysis: ({ tracks, settings, writeAuthorization }, sender) =>
      keyFinder.startAnalysis(
        Array.isArray(tracks) ? tracks : [],
        sender,
        settings,
        Boolean(writeAuthorization),
      ),
    cancel_track_analysis: ({ jobId }) => keyFinder.cancelAnalysis(jobId),
    recycle_keyfinder: () => keyFinder.recycle(),
    generate_track_waveform: ({ sourcePath, points }) =>
      waveformCache.getOrCreate(sourcePath, points, (normalizedPoints) =>
        keyFinder.generateWaveform(sourcePath, normalizedPoints)
      ),
    get_track_source_path: ({ dbPath, trackId }) =>
      openDatabase(dbPath).prepare("SELECT source_path FROM tracks WHERE id = ?").get(trackId)?.source_path ?? null,
    record_track_play: ({ dbPath, trackId }) => {
      const db = openDatabase(dbPath);
      return db.transaction(() => {
        const track = db.prepare(`
          SELECT id, title, artist, album, duration_seconds, added_at FROM tracks WHERE id = ?
        `).get(trackId);
        if (!track) throw new Error("Track was not found");
        const playedAt = new Date().toISOString();
        db.prepare(`
          UPDATE tracks SET last_played_at = ?, play_count = COALESCE(play_count, 0) + 1
          WHERE id = ?
        `).run(playedAt, trackId);
        const result = db.prepare(`
          INSERT INTO play_history(
            track_id, played_at, listened_seconds, duration_seconds,
            title, artist, album, track_added_at
          ) VALUES (?, ?, 30, ?, ?, ?, ?, ?)
        `).run(
          trackId,
          playedAt,
          track.duration_seconds ?? null,
          track.title || "Unknown Title",
          track.artist || "Unknown Artist",
          track.album || "Unknown Album",
          track.added_at ?? null,
        );
        return { historyId: Number(result.lastInsertRowid), playedAt };
      })();
    },
    update_play_history: ({ dbPath, historyId, listenedSeconds }) => {
      const value = Math.max(0, Math.min(Number(listenedSeconds) || 0, 86_400));
      const result = openDatabase(dbPath).prepare(`
        UPDATE play_history SET listened_seconds = ? WHERE id = ?
      `).run(value, historyId);
      return { updated: result.changes > 0 };
    },
    load_listening_statistics: ({ dbPath }) => {
      const db = openDatabase(dbPath);
      const totals = db.prepare(`
        SELECT COALESCE(SUM(listened_seconds), 0) AS listening_seconds,
               COUNT(*) AS plays,
               COUNT(DISTINCT track_id) AS unique_tracks,
               COALESCE(SUM(
                 CASE WHEN track_added_at IS NOT NULL
                   AND julianday(played_at) - julianday(datetime(track_added_at, 'unixepoch')) BETWEEN 0 AND 30
                 THEN 1 ELSE 0 END
               ), 0) AS discovery_plays
        FROM play_history
      `).get();
      const top = (field) => db.prepare(`
        SELECT ${field} AS name, COUNT(*) AS plays,
               COALESCE(SUM(listened_seconds), 0) AS listening_seconds
        FROM play_history
        GROUP BY ${field}
        ORDER BY listening_seconds DESC, plays DESC, name COLLATE NOCASE
        LIMIT 10
      `).all().map((row) => ({
        name: String(row.name),
        plays: Number(row.plays),
        listeningSeconds: Number(row.listening_seconds),
      }));
      const monthlyRows = new Map(db.prepare(`
        SELECT strftime('%Y-%m', played_at) AS month,
               COUNT(*) AS plays,
               COALESCE(SUM(listened_seconds), 0) AS listening_seconds
        FROM play_history
        WHERE played_at >= datetime('now', '-11 months', 'start of month')
        GROUP BY month
      `).all().map((row) => [row.month, row]));
      const monthly = [];
      const now = new Date();
      for (let offset = 11; offset >= 0; offset -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const row = monthlyRows.get(month);
        monthly.push({
          month,
          plays: Number(row?.plays) || 0,
          listeningSeconds: Number(row?.listening_seconds) || 0,
        });
      }
      const neglectedTracks = db.prepare(`
        SELECT id, title, artist, album, last_played_at, play_count
        FROM tracks
        WHERE import_status = 'accepted'
          AND (last_played_at IS NULL OR last_played_at < datetime('now', '-180 days'))
        ORDER BY CASE WHEN last_played_at IS NULL THEN 0 ELSE 1 END,
                 last_played_at ASC, added_at ASC
        LIMIT 50
      `).all().map((row) => ({
        id: String(row.id),
        title: row.title || "Unknown Title",
        artist: row.artist || "Unknown Artist",
        album: row.album || "Unknown Album",
        lastPlayedAt: row.last_played_at ?? null,
        playCount: Number(row.play_count) || 0,
      }));
      const plays = Number(totals.plays) || 0;
      return {
        listeningSeconds: Number(totals.listening_seconds) || 0,
        plays,
        uniqueTracks: Number(totals.unique_tracks) || 0,
        discoveryRate: plays ? (Number(totals.discovery_plays) / plays) * 100 : 0,
        topArtists: top("artist"),
        topAlbums: top("album"),
        monthly,
        neglectedTracks,
      };
    },

    backfill_search_text: ({ dbPath }) => {
      const db = openDatabase(dbPath);
      const rows = db.prepare("SELECT id FROM tracks").all();
      const update = db.transaction(() => {
        for (const row of rows) refreshSearchText(db, row.id);
      });
      update();
      // The triggers already mirrored each update, but a full rebuild also
      // clears anything an older version left behind.
      rebuildSearchIndex(db);
      return rows.length;
    },

    set_watched_folders: ({ dbPath, folders, isEnabled }) =>
      libraryWatcher.setFolders({ dbPath, folders, isEnabled }),

    /** Catch up on files added while the watcher was not running. */
    scan_watched_folders: ({ dbPath, folders }) =>
      libraryWatcher.scanNow({ dbPath, folders }),

    watched_folders_status: () => libraryWatcher.status(),

    /**
     * Track ids matching a query, ranked by the full-text index.
     *
     * null means the index has no opinion — the query held no searchable terms,
     * or the expression could not be evaluated. That is distinct from an empty
     * array, which means "searched, matched nothing", so the caller must not
     * collapse the two.
     */
    search_tracks: ({ dbPath, query, limit }) =>
      searchTrackIds(dbPath, String(query ?? ""), Number(limit) || 0),

    rebuild_search_index: ({ dbPath }) => {
      rebuildSearchIndex(openDatabase(dbPath));
      return { rebuilt: true };
    },
    backfill_cover_art: async ({ dbPath }) => {
      const db = openDatabase(dbPath);
      const rows = db.prepare(`
        SELECT id, source_path, musicbrainz_albumid, musicbrainz_releasegroupid FROM tracks
      `).all();
      const update = db.prepare(
        `UPDATE tracks SET
          cover_art_path = COALESCE(?, cover_art_path),
          cover_art_thumb_path = COALESCE(?, cover_art_thumb_path),
          musicbrainz_albumid = COALESCE(NULLIF(musicbrainz_albumid, ''), ?),
          musicbrainz_releasegroupid = COALESCE(NULLIF(musicbrainz_releasegroupid, ''), ?)
        WHERE id = ?`
      );
      let count = 0;
      for (const row of rows) {
        try {
          const metadata = await extractCoverMetadata(row.source_path, cacheDir);
          update.run(
            metadata.cached?.fullPath ?? null,
            metadata.cached?.thumbPath ?? null,
            metadata.musicbrainz_albumid,
            metadata.musicbrainz_releasegroupid,
            row.id,
          );
          if (metadata.cached) count += 1;
        } catch (error) {
          console.warn(`Failed to extract cover from ${row.source_path}:`, error);
        }
      }
      return count;
    },
    scan_technical_metadata: async ({ dbPath, limit }) => {
      const db = openDatabase(dbPath);
      const batchSize = Math.max(1, Math.min(200, Number(limit) || 25));
      const rows = db.prepare(`
        SELECT id, source_path FROM tracks
        WHERE sample_rate_hz IS NULL OR file_size_bytes IS NULL
        ORDER BY added_at DESC
        LIMIT ?
      `).all(batchSize);
      const update = db.prepare(`
        UPDATE tracks SET sample_rate_hz = ?, bit_depth = ?, file_size_bytes = ?
        WHERE id = ?
      `);
      let updated = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          const technical = await extractTechnicalMetadata(row.source_path);
          update.run(
            technical.sampleRateHz,
            technical.bitDepth,
            technical.fileSizeBytes,
            row.id,
          );
          updated += 1;
        } catch (error) {
          // Mark an unreadable file as scanned so it does not block future batches.
          update.run(0, 0, 0, row.id);
          failed += 1;
          console.warn(`Failed to extract technical metadata from ${row.source_path}:`, error);
        }
      }
      const remaining = db.prepare(`
        SELECT COUNT(*) AS count FROM tracks
        WHERE sample_rate_hz IS NULL OR file_size_bytes IS NULL
      `).get()?.count ?? 0;
      return { checked: rows.length, updated, failed, remaining };
    },
    cache_cover_art_from_file: ({ filePath }) => cacheCoverFile(filePath, cacheDir),
    cache_cover_art_from_bytes: ({ bytes }) => {
      const data = Buffer.from(bytes ?? []);
      if (data.length === 0 || data.length > 50 * 1024 * 1024) {
        throw new Error("Clipboard image is empty or too large");
      }
      return cacheCoverBytes(data, cacheDir);
    },
  };

  return {
    async invoke(command, args, sender) {
      const handler = commands[command];
      if (!handler) throw new Error(`Unsupported command: ${command}`);
      if (sender) lastSender = sender;
      return handler(args, sender);
    },
    close() {
      libraryWatcher.close();
      playlistSync.close();
      castService.close();
      dlnaService.close();
      keyFinder.close();
      closeDatabases();
    },
  };
};
