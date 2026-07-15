import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const connections = new Map();

const TRACK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    album TEXT,
    album_artist TEXT,
    genre_json TEXT,
    comment_json TEXT,
    label TEXT,
    filename TEXT,
    year INTEGER,
    date TEXT,
    original_date TEXT,
    original_year INTEGER,
    track_number INTEGER,
    track_total INTEGER,
    disc_number INTEGER,
    disc_total INTEGER,
    key TEXT,
    bpm REAL,
    rating REAL,
    isrc_json TEXT,
    encoder TEXT,
    encoder_tag TEXT,
    encoder_tool TEXT,
    raw_tags_json TEXT,
    musicbrainz_albumid TEXT,
    musicbrainz_artistid TEXT,
    musicbrainz_albumartistid TEXT,
    musicbrainz_releasegroupid TEXT,
    musicbrainz_trackid TEXT,
    musicbrainz_releasetrackid TEXT,
    musicbrainz_albumstatus TEXT,
    musicbrainz_albumtype TEXT,
    source_path TEXT UNIQUE NOT NULL,
    search_text TEXT,
    import_status TEXT NOT NULL DEFAULT 'staged',
    duration_seconds REAL,
    bitrate_kbps INTEGER,
    added_at INTEGER,
    updated_at INTEGER,
    last_write_error TEXT,
    is_missing INTEGER DEFAULT 0,
    cover_art_path TEXT,
    cover_art_thumb_path TEXT,
    last_played_at TEXT,
    play_count INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS tracks_import_status_idx ON tracks(import_status);
  CREATE INDEX IF NOT EXISTS tracks_last_played_idx ON tracks(last_played_at DESC);
`;

const PLAYLIST_SCHEMA = `
  CREATE TABLE IF NOT EXISTS playlist_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    UNIQUE(playlist_id, track_id)
  );
  CREATE INDEX IF NOT EXISTS playlist_tracks_playlist_idx
    ON playlist_tracks(playlist_id, position);
`;

const ARTIST_PROFILE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS artist_profiles (
    artist_key TEXT PRIMARY KEY,
    requested_name TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS artist_profiles_fetched_at_idx
    ON artist_profiles(fetched_at DESC);
`;

const REQUIRED_TRACK_COLUMNS = {
  album_artist: "TEXT",
  genre_json: "TEXT",
  comment_json: "TEXT",
  label: "TEXT",
  filename: "TEXT",
  year: "INTEGER",
  date: "TEXT",
  track_number: "INTEGER",
  track_total: "INTEGER",
  disc_number: "INTEGER",
  disc_total: "INTEGER",
  key: "TEXT",
  bpm: "REAL",
  rating: "REAL",
  raw_tags_json: "TEXT",
  musicbrainz_artistid: "TEXT",
  source_path: "TEXT",
  search_text: "TEXT",
  import_status: "TEXT DEFAULT 'staged'",
  duration_seconds: "REAL",
  bitrate_kbps: "INTEGER",
  added_at: "INTEGER",
  updated_at: "INTEGER",
  last_write_error: "TEXT",
  is_missing: "INTEGER DEFAULT 0",
  cover_art_path: "TEXT",
  cover_art_thumb_path: "TEXT",
  last_played_at: "TEXT",
  play_count: "INTEGER DEFAULT 0",
};

export const openDatabase = (dbPath) => {
  const resolved = path.resolve(dbPath);
  if (connections.has(resolved)) return connections.get(resolved);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(TRACK_SCHEMA);

  const existing = new Set(
    db.prepare("PRAGMA table_info(tracks)").all().map((column) => column.name)
  );
  for (const [name, type] of Object.entries(REQUIRED_TRACK_COLUMNS)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE tracks ADD COLUMN ${name} ${type}`);
  }
  db.exec(PLAYLIST_SCHEMA);
  db.exec(ARTIST_PROFILE_SCHEMA);
  const playlistColumns = new Set(
    db.prepare("PRAGMA table_info(playlists)").all().map((column) => column.name)
  );
  if (!playlistColumns.has("folder_id")) {
    db.exec("ALTER TABLE playlists ADD COLUMN folder_id TEXT");
  }
  connections.set(resolved, db);
  return db;
};

export const closeDatabases = () => {
  for (const db of connections.values()) db.close();
  connections.clear();
};

const jsonList = (value) => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.join(", ") : undefined;
  } catch {
    return undefined;
  }
};

const isoTimestamp = (seconds) => {
  if (seconds == null) return undefined;
  const date = new Date(Number(seconds) * 1000);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
};

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return "--:--";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};

export const rowToTrack = (row) => ({
  id: String(row.id),
  title: row.title || "Unknown Title",
  artist: row.artist || "Unknown Artist",
  artists: row.album_artist || undefined,
  album: row.album || "Unknown Album",
  track_number: row.track_number ?? undefined,
  track_total: row.track_total ?? undefined,
  key: row.key ?? undefined,
  bpm: row.bpm ?? undefined,
  year: row.year ?? undefined,
  date: row.date ?? undefined,
  date_added: isoTimestamp(row.added_at),
  date_modified: isoTimestamp(row.updated_at),
  duration: formatDuration(row.duration_seconds),
  duration_seconds: row.duration_seconds || 0,
  bitrate: row.bitrate_kbps > 0 ? `${row.bitrate_kbps} kbps` : "--",
  rating: row.rating || 0,
  source_path: row.source_path || "",
  cover_art_path: row.cover_art_path || undefined,
  cover_art_thumb_path: row.cover_art_thumb_path || undefined,
  genre: jsonList(row.genre_json),
  comment: jsonList(row.comment_json),
  label: row.label || undefined,
  disc_number: row.disc_number ?? undefined,
  disc_total: row.disc_total ?? undefined,
  last_played_at: row.last_played_at || undefined,
  play_count: row.play_count || 0,
});

const TRACK_SELECT = `
  SELECT id, title, artist, album_artist, album, track_number, track_total,
    key, bpm, year, date, added_at, updated_at, rating, duration_seconds,
    bitrate_kbps, import_status, source_path, cover_art_path,
    cover_art_thumb_path, last_played_at, play_count, genre_json,
    comment_json, label, disc_number, disc_total
  FROM tracks`;

export const loadTracks = (dbPath) => {
  const rows = openDatabase(dbPath)
    .prepare(`${TRACK_SELECT} ORDER BY added_at DESC`)
    .all();
  const snapshot = { library: [], inbox: [] };
  for (const row of rows) {
    (row.import_status === "staged" ? snapshot.inbox : snapshot.library).push(
      rowToTrack(row)
    );
  }
  return snapshot;
};

export const loadRecentlyPlayed = (dbPath, limit = 50) =>
  openDatabase(dbPath)
    .prepare(`${TRACK_SELECT} WHERE last_played_at IS NOT NULL ORDER BY last_played_at DESC LIMIT ?`)
    .all(Math.max(0, Number(limit) || 0))
    .map(rowToTrack);

export const loadPlaylists = (dbPath) => {
  const db = openDatabase(dbPath);
  const rows = db
    .prepare(`
      SELECT p.id, p.name, p.folder_id, pt.track_id
      FROM playlists p
      LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
      ORDER BY p.created_at DESC, pt.position ASC
    `)
    .all();
  const playlists = [];
  const byId = new Map();
  for (const row of rows) {
    let playlist = byId.get(String(row.id));
    if (!playlist) {
      playlist = {
        id: String(row.id),
        name: row.name,
        folder_id: row.folder_id == null ? null : String(row.folder_id),
        track_ids: [],
      };
      byId.set(String(row.id), playlist);
      playlists.push(playlist);
    }
    if (row.track_id != null) playlist.track_ids.push(String(row.track_id));
  }
  const folders = db.prepare(`
    SELECT id, name
    FROM playlist_folders
    ORDER BY created_at ASC, name COLLATE NOCASE ASC
  `).all().map((folder) => ({ id: String(folder.id), name: folder.name }));
  return { playlists, folders };
};

export const normalizeSearchText = (...values) =>
  values
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      return value == null ? [] : [String(value)];
    })
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[._\\/:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const refreshSearchText = (db, trackId) => {
  const row = db.prepare(`
    SELECT title, artist, album, album_artist, genre_json, comment_json,
      label, filename, year, track_number, disc_number
    FROM tracks WHERE id = ?
  `).get(trackId);
  if (!row) return;
  const parse = (raw) => {
    try { return JSON.parse(raw || "[]"); } catch { return []; }
  };
  const searchText = normalizeSearchText(
    row.title, row.artist, row.album, row.album_artist,
    parse(row.genre_json), parse(row.comment_json), row.label, row.filename,
    row.year, row.track_number, row.disc_number
  );
  db.prepare("UPDATE tracks SET search_text = ? WHERE id = ?").run(searchText, trackId);
};
