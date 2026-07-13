import fs from "node:fs";
import path from "node:path";
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
  extractAndCacheCover,
  importAudioFile,
  writeMetadataToFile,
} from "./metadata.mjs";

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

export const createBackend = ({ cacheDir, emit }) => {
  const commands = {
    async import_files({ paths, dbPath }, sender) {
      const audioPaths = await collectAudioPaths(Array.isArray(paths) ? paths : []);
      const imported = [];
      for (let index = 0; index < audioPaths.length; index += 1) {
        try {
          const track = await importAudioFile(dbPath, audioPaths[index], cacheDir);
          if (track) imported.push(track);
        } catch (error) {
          console.warn(`Failed to import ${audioPaths[index]}:`, error);
        }
        emit(sender, "muro://import-progress", {
          imported: index + 1,
          total: audioPaths.length,
          phase: "importing",
        });
      }
      return imported;
    },

    load_tracks: ({ dbPath }) => loadTracks(dbPath),
    load_playlists: ({ dbPath }) => loadPlaylists(dbPath),
    load_recently_played: ({ dbPath, limit }) => loadRecentlyPlayed(dbPath, limit),

    clear_tracks: ({ dbPath }) => {
      openDatabase(dbPath).prepare("DELETE FROM tracks").run();
      if (fs.existsSync(cacheDir)) {
        for (const entry of fs.readdirSync(cacheDir)) {
          const candidate = path.join(cacheDir, entry);
          if (fs.statSync(candidate).isFile()) fs.unlinkSync(candidate);
        }
      }
    },

    accept_tracks: ({ dbPath, trackIds }) =>
      bulkTrackOperation(dbPath, trackIds, "UPDATE tracks SET import_status = 'accepted' WHERE id IN"),
    unaccept_tracks: ({ dbPath, trackIds }) =>
      bulkTrackOperation(dbPath, trackIds, "UPDATE tracks SET import_status = 'staged' WHERE id IN"),
    reject_tracks: ({ dbPath, trackIds }) =>
      bulkTrackOperation(dbPath, trackIds, "DELETE FROM tracks WHERE id IN"),

    create_playlist: ({ dbPath, id, name }) => {
      openDatabase(dbPath)
        .prepare("INSERT INTO playlists(id, name, created_at) VALUES (?, ?, ?)")
        .run(id, String(name).trim(), Math.floor(Date.now() / 1000));
    },
    delete_playlist: ({ dbPath, playlistId }) => {
      openDatabase(dbPath).prepare("DELETE FROM playlists WHERE id = ?").run(playlistId);
    },
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
        SELECT id, source_path FROM tracks
        WHERE cover_art_path IS NULL OR cover_art_path = ''
      `).all();
      const update = db.prepare(
        "UPDATE tracks SET cover_art_path = ?, cover_art_thumb_path = ? WHERE id = ?"
      );
      let count = 0;
      for (const row of rows) {
        try {
          const cached = await extractAndCacheCover(row.source_path, cacheDir);
          if (!cached) continue;
          update.run(cached.fullPath, cached.thumbPath, row.id);
          count += 1;
        } catch (error) {
          console.warn(`Failed to extract cover from ${row.source_path}:`, error);
        }
      }
      return count;
    },
    cache_cover_art_from_file: ({ filePath }) => cacheCoverFile(filePath, cacheDir),
  };

  return {
    async invoke(command, args, sender) {
      const handler = commands[command];
      if (!handler) throw new Error(`Unsupported command: ${command}`);
      return handler(args, sender);
    },
    close: closeDatabases,
  };
};
