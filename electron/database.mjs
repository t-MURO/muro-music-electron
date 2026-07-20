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
    sample_rate_hz INTEGER,
    bit_depth INTEGER,
    file_size_bytes INTEGER,
    added_at INTEGER,
    updated_at INTEGER,
    last_write_error TEXT,
    is_missing INTEGER DEFAULT 0,
    cover_art_path TEXT,
    cover_art_thumb_path TEXT,
    last_played_at TEXT,
    play_count INTEGER DEFAULT 0,
    beat_grid_json TEXT
  );
  CREATE INDEX IF NOT EXISTS tracks_import_status_idx ON tracks(import_status);
  CREATE INDEX IF NOT EXISTS tracks_last_played_idx ON tracks(last_played_at DESC);
`;

const PLAYLIST_SCHEMA = `
  CREATE TABLE IF NOT EXISTS playlist_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
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

const ALBUM_COVER_CACHE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS album_cover_cache (
    cover_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    musicbrainz_id TEXT NOT NULL,
    status TEXT NOT NULL,
    full_path TEXT,
    thumb_path TEXT,
    source_url TEXT,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS album_cover_cache_fetched_at_idx
    ON album_cover_cache(fetched_at DESC);
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
  musicbrainz_albumid: "TEXT",
  musicbrainz_artistid: "TEXT",
  musicbrainz_albumartistid: "TEXT",
  musicbrainz_releasegroupid: "TEXT",
  musicbrainz_trackid: "TEXT",
  musicbrainz_releasetrackid: "TEXT",
  musicbrainz_albumstatus: "TEXT",
  musicbrainz_albumtype: "TEXT",
  source_path: "TEXT",
  search_text: "TEXT",
  import_status: "TEXT DEFAULT 'staged'",
  duration_seconds: "REAL",
  bitrate_kbps: "INTEGER",
  sample_rate_hz: "INTEGER",
  bit_depth: "INTEGER",
  file_size_bytes: "INTEGER",
  added_at: "INTEGER",
  updated_at: "INTEGER",
  last_write_error: "TEXT",
  is_missing: "INTEGER DEFAULT 0",
  cover_art_path: "TEXT",
  cover_art_thumb_path: "TEXT",
  last_played_at: "TEXT",
  play_count: "INTEGER DEFAULT 0",
  beat_grid_json: "TEXT",
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
  db.exec(ALBUM_COVER_CACHE_SCHEMA);
  const playlistColumns = new Set(
    db.prepare("PRAGMA table_info(playlists)").all().map((column) => column.name)
  );
  if (!playlistColumns.has("folder_id")) {
    db.exec("ALTER TABLE playlists ADD COLUMN folder_id TEXT");
  }
  const addedPlaylistSortOrder = !playlistColumns.has("sort_order");
  if (addedPlaylistSortOrder) {
    db.exec("ALTER TABLE playlists ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }
  const playlistFolderColumns = new Set(
    db.prepare("PRAGMA table_info(playlist_folders)").all().map((column) => column.name)
  );
  if (!playlistFolderColumns.has("parent_id")) {
    db.exec("ALTER TABLE playlist_folders ADD COLUMN parent_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL");
  }
  const addedFolderSortOrder = !playlistFolderColumns.has("sort_order");
  if (addedFolderSortOrder) {
    db.exec("ALTER TABLE playlist_folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }
  if (addedPlaylistSortOrder) {
    const rows = db.prepare(`
      SELECT id, folder_id
      FROM playlists
      ORDER BY folder_id, created_at DESC, id
    `).all();
    const nextByFolder = new Map();
    const update = db.prepare("UPDATE playlists SET sort_order = ? WHERE id = ?");
    db.transaction(() => {
      for (const row of rows) {
        const key = row.folder_id == null ? "" : String(row.folder_id);
        const position = nextByFolder.get(key) ?? 0;
        update.run(position, row.id);
        nextByFolder.set(key, position + 1);
      }
    })();
  }
  if (addedFolderSortOrder) {
    const rows = db.prepare(`
      SELECT id, parent_id
      FROM playlist_folders
      ORDER BY parent_id, created_at ASC, name COLLATE NOCASE ASC, id
    `).all();
    const nextByParent = new Map();
    const update = db.prepare("UPDATE playlist_folders SET sort_order = ? WHERE id = ?");
    db.transaction(() => {
      for (const row of rows) {
        const key = row.parent_id == null ? "" : String(row.parent_id);
        const position = nextByParent.get(key) ?? 0;
        update.run(position, row.id);
        nextByParent.set(key, position + 1);
      }
    })();
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
  sample_rate_hz: row.sample_rate_hz > 0 ? row.sample_rate_hz : undefined,
  bit_depth: row.bit_depth > 0 ? row.bit_depth : undefined,
  file_size_bytes: typeof row.file_size_bytes === "number" && row.file_size_bytes >= 0
    ? row.file_size_bytes
    : undefined,
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
  beat_grid_json: row.beat_grid_json ?? null,
});

const TRACK_SELECT = `
  SELECT id, title, artist, album_artist, album, track_number, track_total,
    key, bpm, year, date, added_at, updated_at, rating, duration_seconds,
    bitrate_kbps, sample_rate_hz, bit_depth, file_size_bytes,
    import_status, source_path, cover_art_path,
    cover_art_thumb_path, last_played_at, play_count, genre_json,
    comment_json, label, disc_number, disc_total, beat_grid_json
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
  const trackIdsByPlaylist = new Map();
  for (const row of db.prepare(`
    SELECT playlist_id, track_id
    FROM playlist_tracks
    ORDER BY playlist_id, position ASC
  `).all()) {
    const playlistId = String(row.playlist_id);
    const ids = trackIdsByPlaylist.get(playlistId) ?? [];
    ids.push(String(row.track_id));
    trackIdsByPlaylist.set(playlistId, ids);
  }
  const playlists = db.prepare(`
    SELECT id, name, folder_id, sort_order
    FROM playlists
    ORDER BY folder_id, sort_order ASC, created_at DESC, id
  `).all().map((playlist) => ({
    id: String(playlist.id),
    name: playlist.name,
    folder_id: playlist.folder_id == null ? null : String(playlist.folder_id),
    sort_order: Number(playlist.sort_order) || 0,
    track_ids: trackIdsByPlaylist.get(String(playlist.id)) ?? [],
  }));
  const folders = db.prepare(`
    SELECT id, name, parent_id, sort_order
    FROM playlist_folders
    ORDER BY parent_id, sort_order ASC, created_at ASC, name COLLATE NOCASE ASC
  `).all().map((folder) => ({
    id: String(folder.id),
    name: folder.name,
    parent_id: folder.parent_id == null ? null : String(folder.parent_id),
    sort_order: Number(folder.sort_order) || 0,
  }));
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
