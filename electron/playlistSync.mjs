import fs from "node:fs";
import path from "node:path";
import {
  openDatabase,
  resolveLibraryPath,
  resolveTrackPath,
  storeLibraryPath,
  storeTrackPath,
} from "./database.mjs";
import { AUDIO_EXTENSIONS, importAudioFile } from "./metadata.mjs";
import { normalizePlaylistPath, parsePlaylistFile } from "./playlistFiles.mjs";

const WATCH_DEBOUNCE_MS = 400;

const arraysEqual = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const playlistTrackIds = (db, playlistId) => db.prepare(`
  SELECT track_id
  FROM playlist_tracks
  WHERE playlist_id = ?
  ORDER BY position
`).all(playlistId).map((row) => String(row.track_id));

const updateSyncError = (db, playlistId, message) => {
  db.prepare(`
    UPDATE playlists
    SET source_sync_error = ?, last_synced_at = ?
    WHERE id = ?
  `).run(message, Math.floor(Date.now() / 1000), playlistId);
};

/**
 * Make one source-linked playlist mirror its M3U/M3U8/PLS file.
 *
 * The source file is authoritative. Referenced local audio that is not yet in
 * Muro is imported into the Inbox before the playlist membership is replaced.
 */
export const syncLinkedPlaylist = async ({
  dbPath,
  playlistId,
  cacheDir,
  force = false,
  reason = "manual",
}) => {
  const db = openDatabase(dbPath);
  const playlist = db.prepare(`
    SELECT id, name, source_path, source_mtime_ms, source_size, source_sync_error
    FROM playlists
    WHERE id = ?
  `).get(playlistId);
  if (!playlist?.source_path) return null;

  const sourcePath = resolveLibraryPath(dbPath, playlist.source_path);
  let stats;
  try {
    if (!path.isAbsolute(sourcePath)) {
      throw new Error("Choose the music library folder to sync this playlist");
    }
    stats = await fs.promises.stat(sourcePath);
    if (!stats.isFile()) throw new Error("Playlist source is not a file");
  } catch {
    const message = "The playlist source file is unavailable";
    updateSyncError(db, playlistId, message);
    return {
      playlistId: String(playlist.id),
      name: String(playlist.name),
      sourcePath,
      trackIds: playlistTrackIds(db, playlistId),
      imported: [],
      added: 0,
      removed: 0,
      skipped: 0,
      changed: false,
      sourceSyncError: message,
      errorChanged: playlist.source_sync_error !== message,
      reason,
    };
  }

  const unchangedOnDisk =
    Number(playlist.source_mtime_ms) === stats.mtimeMs
    && Number(playlist.source_size) === stats.size;
  if (!force && unchangedOnDisk && !playlist.source_sync_error) {
    return {
      playlistId: String(playlist.id),
      name: String(playlist.name),
      sourcePath,
      trackIds: playlistTrackIds(db, playlistId),
      imported: [],
      added: 0,
      removed: 0,
      skipped: 0,
      changed: false,
      sourceSyncError: null,
      errorChanged: false,
      reason,
    };
  }

  let entries;
  try {
    entries = await parsePlaylistFile(sourcePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateSyncError(db, playlistId, message);
    return {
      playlistId: String(playlist.id),
      name: String(playlist.name),
      sourcePath,
      trackIds: playlistTrackIds(db, playlistId),
      imported: [],
      added: 0,
      removed: 0,
      skipped: 0,
      changed: false,
      sourceSyncError: message,
      errorChanged: playlist.source_sync_error !== message,
      reason,
    };
  }

  const trackIdByPath = new Map(
    db.prepare("SELECT id, source_path FROM tracks").all()
      .flatMap((row) => {
        try {
          return [[
            normalizePlaylistPath(resolveTrackPath(dbPath, row.source_path)),
            String(row.id),
          ]];
        } catch {
          return [];
        }
      }),
  );
  const imported = [];
  const orderedTrackIds = [];
  const seenTrackIds = new Set();
  let skipped = 0;

  for (const entry of entries) {
    const normalizedEntry = normalizePlaylistPath(entry);
    let trackId = trackIdByPath.get(normalizedEntry) ?? null;
    if (!trackId) {
      let entryStats = null;
      try {
        entryStats = await fs.promises.stat(entry);
      } catch {
        // Missing references remain unavailable and are retried on the next sync.
      }
      if (
        entryStats?.isFile()
        && AUDIO_EXTENSIONS.has(path.extname(entry).toLocaleLowerCase())
      ) {
        try {
          const importedTrack = await importAudioFile(dbPath, entry, cacheDir);
          if (importedTrack) {
            imported.push(importedTrack);
            trackId = String(importedTrack.id);
            trackIdByPath.set(normalizedEntry, trackId);
          } else {
            const existing = db.prepare(
              "SELECT id FROM tracks WHERE source_path = ?",
            ).get(storeTrackPath(dbPath, entry));
            trackId = existing ? String(existing.id) : null;
          }
        } catch {
          // A partially copied or unreadable audio file is skipped without
          // preventing the rest of the playlist from synchronizing.
        }
      }
    }

    if (!trackId) {
      skipped += 1;
      continue;
    }
    if (seenTrackIds.has(trackId)) continue;
    seenTrackIds.add(trackId);
    orderedTrackIds.push(trackId);
  }

  const previousTrackIds = playlistTrackIds(db, playlistId);
  const changed = !arraysEqual(previousTrackIds, orderedTrackIds);
  const previousSet = new Set(previousTrackIds);
  const nextSet = new Set(orderedTrackIds);
  const added = orderedTrackIds.filter((trackId) => !previousSet.has(trackId)).length;
  const removed = previousTrackIds.filter((trackId) => !nextSet.has(trackId)).length;
  const sourceSyncError = skipped > 0
    ? `${skipped} playlist ${skipped === 1 ? "entry is" : "entries are"} unavailable`
    : null;
  const errorChanged = (playlist.source_sync_error ?? null) !== sourceSyncError;
  const now = Math.floor(Date.now() / 1000);

  db.transaction(() => {
    if (changed) {
      db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
      const insert = db.prepare(`
        INSERT INTO playlist_tracks(playlist_id, track_id, position)
        VALUES (?, ?, ?)
      `);
      orderedTrackIds.forEach((trackId, position) => {
        insert.run(playlistId, trackId, position);
      });
    }
    db.prepare(`
      UPDATE playlists
      SET source_path = ?, source_mtime_ms = ?, source_size = ?,
        source_sync_error = ?, last_synced_at = ?
      WHERE id = ?
    `).run(
      storeLibraryPath(dbPath, sourcePath),
      stats.mtimeMs,
      stats.size,
      sourceSyncError,
      now,
      playlistId,
    );
  })();

  return {
    playlistId: String(playlist.id),
    name: String(playlist.name),
    sourcePath,
    trackIds: orderedTrackIds,
    imported,
    added,
    removed,
    skipped,
    changed,
    sourceSyncError,
    errorChanged,
    reason,
  };
};

export const createPlaylistSyncService = ({ cacheDir, emit, getSender }) => {
  const watchers = new Map();
  const pendingTimers = new Map();
  let currentDbPath = null;
  let sourceIdsByPath = new Map();
  let sourceIdsByDirectory = new Map();
  let syncQueue = Promise.resolve();

  const notify = (payload) => {
    const sender = getSender?.();
    if (sender && !sender.isDestroyed?.()) {
      emit(sender, "muro://playlist-source-synced", payload);
    }
  };

  const enqueueSync = ({ dbPath, playlistId, force, reason }) => {
    const task = syncQueue.then(async () => {
      const result = await syncLinkedPlaylist({
        dbPath,
        playlistId,
        cacheDir,
        force,
        reason,
      });
      if (
        result
        && reason !== "manual"
        && (
          result.changed
          || result.imported.length > 0
          || result.errorChanged
        )
      ) {
        notify(result);
      }
      return result;
    });
    syncQueue = task.catch(() => undefined);
    return task;
  };

  const scheduleSync = (playlistId) => {
    if (!currentDbPath) return;
    const existing = pendingTimers.get(playlistId);
    if (existing) clearTimeout(existing);
    pendingTimers.set(playlistId, setTimeout(() => {
      pendingTimers.delete(playlistId);
      void enqueueSync({
        dbPath: currentDbPath,
        playlistId,
        force: true,
        reason: "watch",
      }).catch((error) => {
        console.warn(`Playlist sync failed for ${playlistId}:`, error);
      });
    }, WATCH_DEBOUNCE_MS));
  };

  const watchDirectory = (directory) => {
    if (watchers.has(directory)) return;
    try {
      const watcher = fs.watch(directory, (eventType, filename) => {
        const directoryIds = sourceIdsByDirectory.get(directory) ?? [];
        if (!filename || eventType === "rename") {
          directoryIds.forEach(scheduleSync);
          return;
        }
        const changedPath = normalizePlaylistPath(
          path.resolve(directory, filename.toString()),
        );
        (sourceIdsByPath.get(changedPath) ?? []).forEach(scheduleSync);
      });
      watcher.on("error", (error) => {
        console.warn(`Stopped watching playlist sources in ${directory}:`, error.message);
        watchers.delete(directory);
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
      });
      watchers.set(directory, watcher);
    } catch (error) {
      console.warn(`Could not watch playlist sources in ${directory}:`, error);
    }
  };

  const rebuildWatchers = (dbPath) => {
    const rows = openDatabase(dbPath).prepare(`
      SELECT id, source_path
      FROM playlists
      WHERE source_path IS NOT NULL AND source_path <> ''
    `).all();
    const nextByPath = new Map();
    const nextByDirectory = new Map();
    for (const row of rows) {
      const sourcePath = resolveLibraryPath(dbPath, row.source_path);
      if (!path.isAbsolute(sourcePath)) continue;
      const normalizedSource = normalizePlaylistPath(sourcePath);
      const pathIds = nextByPath.get(normalizedSource) ?? [];
      pathIds.push(String(row.id));
      nextByPath.set(normalizedSource, pathIds);

      const directory = path.dirname(sourcePath);
      const directoryIds = nextByDirectory.get(directory) ?? [];
      directoryIds.push(String(row.id));
      nextByDirectory.set(directory, directoryIds);
    }
    sourceIdsByPath = nextByPath;
    sourceIdsByDirectory = nextByDirectory;

    for (const [directory, watcher] of watchers) {
      if (nextByDirectory.has(directory)) continue;
      try {
        watcher.close();
      } catch {
        // Already closed.
      }
      watchers.delete(directory);
    }
    for (const directory of nextByDirectory.keys()) {
      try {
        if (fs.statSync(directory).isDirectory()) watchDirectory(directory);
      } catch {
        // A missing parent directory is retried on the next refresh.
      }
    }
    return rows.map((row) => String(row.id));
  };

  return {
    async refreshSources({ dbPath, syncChanged = true }) {
      const nextDbPath = dbPath ?? currentDbPath;
      if (nextDbPath && currentDbPath && path.resolve(nextDbPath) !== path.resolve(currentDbPath)) {
        for (const timer of pendingTimers.values()) clearTimeout(timer);
        pendingTimers.clear();
      }
      currentDbPath = nextDbPath;
      if (!currentDbPath) return { linked: 0, synced: 0, changed: 0 };
      const playlistIds = rebuildWatchers(currentDbPath);
      if (!syncChanged) {
        return { linked: playlistIds.length, synced: 0, changed: 0 };
      }

      let synced = 0;
      let changed = 0;
      for (const playlistId of playlistIds) {
        const result = await enqueueSync({
          dbPath: currentDbPath,
          playlistId,
          // Always reconcile membership on startup. The source file may be
          // unchanged while the Muro playlist was edited or restored.
          force: true,
          reason: "startup",
        });
        if (!result) continue;
        synced += 1;
        if (result.changed) changed += 1;
      }
      return { linked: playlistIds.length, synced, changed };
    },

    syncPlaylist({ dbPath, playlistId, force = true, reason = "manual" }) {
      currentDbPath = dbPath ?? currentDbPath;
      if (!currentDbPath) throw new Error("Playlist sync database is not configured");
      return enqueueSync({
        dbPath: currentDbPath,
        playlistId: String(playlistId),
        force,
        reason,
      });
    },

    close() {
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
      for (const watcher of watchers.values()) {
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
      }
      watchers.clear();
      sourceIdsByPath.clear();
      sourceIdsByDirectory.clear();
    },
  };
};
