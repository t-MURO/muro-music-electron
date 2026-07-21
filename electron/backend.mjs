import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeDatabases,
  loadPlaylists,
  loadRecentlyPlayed,
  loadTracks,
  openDatabase,
  refreshSearchText,
} from "./database.mjs";
import {
  AUDIO_EXTENSIONS,
  cacheCoverBytes,
  cacheCoverFile,
  collectAudioPaths,
  extractCoverMetadata,
  extractTechnicalMetadata,
  importAudioFile,
  writeMetadataToFile,
} from "./metadata.mjs";
import { createWaveformCache } from "./waveformCache.mjs";
import { createArtistProfileService } from "./artistProfiles.mjs";
import { createAlbumCoverService } from "./albumCovers.mjs";
import { createCastService } from "./cast/castService.mjs";
import { createDlnaService } from "./dlna/dlnaService.mjs";
import { createAcoustIdService } from "./acoustid.mjs";

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
const MUSICBRAINZ_USER_AGENT = "MuroMusicElectron/0.1.0 (https://github.com/t-MURO/muro-music-electron)";
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

const normalizePlaylistPath = (value) => {
  const resolved = path.resolve(String(value || ""));
  const normalized = path.normalize(resolved);
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
};

const PLAYLIST_EXTENSIONS = new Set([".m3u", ".m3u8", ".pls"]);

const listPlaylistFilesForImport = async (directoryPath) => {
  const root = path.resolve(String(directoryPath || ""));
  const rootStats = await fs.promises.stat(root);
  if (!rootStats.isDirectory()) throw new Error("Playlist import path is not a directory");

  const files = [];
  let audioFileCount = 0;
  const visit = async (directory) => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (PLAYLIST_EXTENSIONS.has(extension)) files.push(entryPath);
        if (AUDIO_EXTENSIONS.has(extension)) audioFileCount += 1;
      }
    }
  };

  await visit(root);
  files.sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));
  const entries = files.map((filePath) => {
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    const directory = path.posix.dirname(relativePath);
    return {
      path: filePath,
      relativePath,
      folderPath: directory === "." ? null : directory,
    };
  });
  const folderPaths = new Set();
  for (const entry of entries) {
    if (!entry.folderPath) continue;
    const segments = entry.folderPath.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      folderPaths.add(segments.slice(0, index).join("/"));
    }
  }
  return {
    name: path.basename(root) || root,
    audioFileCount,
    files,
    entries,
    folders: [...folderPaths]
      .sort((a, b) => (
        a.split("/").length - b.split("/").length || a.localeCompare(b)
      ))
      .map((folderPath) => {
        const segments = folderPath.split("/");
        return {
          path: folderPath,
          name: segments.at(-1),
          parentPath: segments.length > 1 ? segments.slice(0, -1).join("/") : null,
        };
      }),
  };
};

const resolvePlaylistEntry = (entry, playlistDirectory) => {
  const trimmed = String(entry || "").trim().replace(/^"|"$/g, "");
  if (!trimmed) return null;
  try {
    if (/^file:/i.test(trimmed)) return fileURLToPath(trimmed);
  } catch {
    return null;
  }
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(playlistDirectory, trimmed);
};

const parsePlaylistFile = async (filePath) => {
  const buffer = await fs.promises.readFile(filePath);
  const text = buffer[0] === 0xff && buffer[1] === 0xfe
    ? buffer.subarray(2).toString("utf16le")
    : buffer.toString("utf8").replace(/^\uFEFF/, "");
  const extension = path.extname(filePath).toLocaleLowerCase();
  const lines = text.split(/\r?\n/);
  const rawEntries = extension === ".pls"
    ? lines
        .map((line) => /^File\d+=(.*)$/i.exec(line.trim())?.[1])
        .filter(Boolean)
    : lines
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
  const directory = path.dirname(filePath);
  return rawEntries
    .map((entry) => resolvePlaylistEntry(entry, directory))
    .filter(Boolean);
};

const readPlaylistForImport = async (dbPath, filePath) => {
  const entries = await parsePlaylistFile(filePath);
  const rows = openDatabase(dbPath)
    .prepare("SELECT id, source_path FROM tracks")
    .all();
  const trackIdByPath = new Map(
    rows.map((row) => [normalizePlaylistPath(row.source_path), String(row.id)])
  );
  return {
    name: path.basename(filePath, path.extname(filePath)),
    entries: entries.map((entry) => ({
      path: entry,
      track_id: trackIdByPath.get(normalizePlaylistPath(entry)) ?? null,
      exists: fs.existsSync(entry),
    })),
  };
};

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

const updateTrackMetadata = async (dbPath, trackIds, updates) => {
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
  const commands = {
    ...castService.commands,
    ...dlnaService.commands,
    async import_files({ paths, dbPath }, sender) {
      const audioPaths = await collectAudioPaths(Array.isArray(paths) ? paths : []);
      const imported = [];
      const failures = [];
      for (let index = 0; index < audioPaths.length; index += 1) {
        try {
          const track = await importAudioFile(dbPath, audioPaths[index], cacheDir);
          if (track) imported.push(track);
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
    load_cached_artist_profiles: ({ dbPath }) =>
      artistProfiles.loadCachedProfiles(openDatabase(dbPath)),
    get_artist_profile: ({ dbPath, artistName, force, fanartApiKey, lastFmApiKey, theAudioDbApiKey }) =>
      artistProfiles.getProfile(openDatabase(dbPath), artistName, {
        force: Boolean(force),
        fanartApiKey,
        lastFmApiKey,
        theAudioDbApiKey,
      }),
    search_artist_images: ({ dbPath, artistName, fanartApiKey, lastFmApiKey, theAudioDbApiKey }) =>
      artistProfiles.searchImages(openDatabase(dbPath), artistName, {
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

    accept_tracks: ({ dbPath, trackIds }) =>
      bulkTrackOperation(dbPath, trackIds, "UPDATE tracks SET import_status = 'accepted' WHERE id IN"),
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

    create_playlist: ({ dbPath, id, name, folderId, sortOrder }) => {
      const db = openDatabase(dbPath);
      const targetFolderId = folderId || null;
      const nextSortOrder = Number.isInteger(sortOrder)
        ? sortOrder
        : db.prepare(`
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
            FROM playlists
            WHERE folder_id = ? OR (folder_id IS NULL AND ? IS NULL)
          `).get(targetFolderId, targetFolderId).next;
      db.prepare("INSERT INTO playlists(id, name, folder_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, String(name).trim(), targetFolderId, nextSortOrder, Math.floor(Date.now() / 1000));
    },
    update_playlist: ({ dbPath, playlistId, name, folderId, sortOrder }) => {
      const db = openDatabase(dbPath);
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
    },
    reorder_playlists: ({ dbPath, items }) => {
      const db = openDatabase(dbPath);
      const update = db.prepare(
        "UPDATE playlists SET folder_id = ?, sort_order = ? WHERE id = ?"
      );
      db.transaction(() => {
        for (const item of Array.isArray(items) ? items : []) {
          update.run(item.folderId || null, Number(item.sortOrder) || 0, item.id);
        }
      })();
    },
    delete_playlist: ({ dbPath, playlistId }) => {
      openDatabase(dbPath).prepare("DELETE FROM playlists WHERE id = ?").run(playlistId);
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
      db.prepare(`
        INSERT INTO playlist_folders(id, name, parent_id, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, String(name).trim(), targetParentId, nextSortOrder, Math.floor(Date.now() / 1000));
    },
    update_playlist_folder: ({ dbPath, folderId, name, parentId, sortOrder }) => {
      const db = openDatabase(dbPath);
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
    },
    delete_playlist_folder: ({ dbPath, folderId }) => {
      const db = openDatabase(dbPath);
      db.transaction(() => {
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
      })();
    },
    list_playlist_files: ({ directoryPath }) => listPlaylistFilesForImport(directoryPath),
    import_playlist_file: ({ dbPath, filePath }) => readPlaylistForImport(dbPath, filePath),
    export_playlist_file: ({ dbPath, playlistId, filePath }) =>
      exportPlaylistFile(dbPath, playlistId, filePath),
    add_tracks_to_playlist: ({ dbPath, playlistId, trackIds }) => {
      if (!trackIds.length) return;
      const db = openDatabase(dbPath);
      const add = db.transaction(() => {
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
      add();
    },
    set_playlist_tracks: ({ dbPath, playlistId, trackIds }) => {
      const db = openDatabase(dbPath);
      const ids = [...new Set(
        (Array.isArray(trackIds) ? trackIds : [])
          .map((id) => String(id))
          .filter(Boolean),
      )];
      const replace = db.transaction(() => {
        db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
        const insert = db.prepare(
          "INSERT INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)"
        );
        ids.forEach((trackId, position) => insert.run(playlistId, trackId, position));
      });
      replace();
    },
    remove_last_tracks_from_playlist: ({ dbPath, playlistId, count }) => {
      openDatabase(dbPath).prepare(`
        DELETE FROM playlist_tracks WHERE rowid IN (
          SELECT rowid FROM playlist_tracks WHERE playlist_id = ?
          ORDER BY position DESC LIMIT ?
        )
      `).run(playlistId, Math.max(0, Number(count) || 0));
    },

    update_track_metadata: ({ dbPath, trackIds, updates }) =>
      updateTrackMetadata(dbPath, trackIds, updates),
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
      openDatabase(dbPath).prepare(`
        UPDATE tracks SET last_played_at = ?, play_count = COALESCE(play_count, 0) + 1
        WHERE id = ?
      `).run(new Date().toISOString(), trackId);
    },

    backfill_search_text: ({ dbPath }) => {
      const db = openDatabase(dbPath);
      const rows = db.prepare("SELECT id FROM tracks").all();
      const update = db.transaction(() => {
        for (const row of rows) refreshSearchText(db, row.id);
      });
      update();
      return rows.length;
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
      return handler(args, sender);
    },
    close() {
      castService.close();
      dlnaService.close();
      keyFinder.close();
      closeDatabases();
    },
  };
};
