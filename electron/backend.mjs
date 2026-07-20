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
  const visit = async (directory) => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && PLAYLIST_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
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
  if (!trackIds.length || Object.keys(updates).length === 0) return;
  const db = openDatabase(dbPath);
  const entries = Object.entries(updates)
    .filter(([key]) => allowedUpdates[key])
    .map(([key, value]) => [
      allowedUpdates[key],
      key === "genre" || key === "comment" ? listJson(value) : value,
    ]);
  if (!entries.length) return;

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
  for (const id of trackIds) {
    const sourcePath = sourceQuery.get(id)?.source_path;
    if (!sourcePath) continue;
    try {
      await writeMetadataToFile(sourcePath, updates);
      errorUpdate.run(null, id);
    } catch (error) {
      errorUpdate.run(error instanceof Error ? error.message : String(error), id);
      console.warn(`Failed to write metadata to ${sourcePath}:`, error);
    }
  }
};

export const createBackend = ({
  cacheDir,
  emit,
  keyFinder,
  waveformCacheDir,
  artistProfileCacheDir,
}) => {
  const artistCacheDir = artistProfileCacheDir ?? path.join(path.dirname(cacheDir), "artists");
  const artistProfiles = createArtistProfileService({ cacheDir: artistCacheDir });
  const albumCovers = createAlbumCoverService({ cacheDir });
  const waveformCache = createWaveformCache({
    cacheDir: waveformCacheDir ?? path.join(path.dirname(cacheDir), "waveforms"),
  });
  const commands = {
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
    scan_artist_profiles: ({ dbPath, fanartApiKey, lastFmApiKey, theAudioDbApiKey, limit }) =>
      artistProfiles.scanProfiles(openDatabase(dbPath), {
        fanartApiKey,
        lastFmApiKey,
        theAudioDbApiKey,
        limit,
      }),
    scan_album_covers: ({ dbPath, limit }) =>
      albumCovers.scanCovers(openDatabase(dbPath), { limit }),

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
        WHERE cover_art_path IS NULL OR cover_art_path = ''
      `).all();
      const update = db.prepare(
        `UPDATE tracks SET
          cover_art_path = ?,
          cover_art_thumb_path = ?,
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
      let scanResult;
      do {
        scanResult = await albumCovers.scanCovers(db, { limit: 50 });
        count += scanResult.updated;
      } while (scanResult.queued > 0);
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
  };

  return {
    async invoke(command, args, sender) {
      const handler = commands[command];
      if (!handler) throw new Error(`Unsupported command: ${command}`);
      return handler(args, sender);
    },
    close() {
      keyFinder.close();
      closeDatabases();
    },
  };
};
