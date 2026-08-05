import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeLibraryRoot,
  portablePathKey,
  resolveStoredTrackPath,
  toStoredTrackPath,
} from "./libraryPaths.mjs";

const connections = new Map();
const SEARCH_TEXT_VERSION = 3;
const LIBRARY_ROOT_METADATA_KEY = "library_root";
const ARTIST_CREDIT_MIGRATION_METADATA_KEY = "artist_credit_migration_v1";
const ARTIST_CREDIT_SCOPES = new Set(["track", "album"]);
const LEGACY_ARTIST_SEPARATOR_PATTERN = /\s*,\s*|\s+&\s+|\s+feat\.?\s+/giu;

export const normalizeArtistName = (value) => String(value ?? "")
  .normalize("NFKC")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase();

const canonicalArtistName = (value) => String(value ?? "")
  .normalize("NFKC")
  .trim()
  .replace(/\s+/g, " ");

const escapeRegularExpression = (value) =>
  String(value).replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");

const protectedArtistExceptionRanges = (displayText, exceptions) => {
  const ranges = [];
  const unique = [...new Set(
    Array.from(exceptions ?? [], (exception) => String(exception ?? "").trim())
      .filter(Boolean),
  )].sort((left, right) => right.length - left.length);

  for (const exception of unique) {
    const flexiblePattern = exception
      .split(/\s+/u)
      .map(escapeRegularExpression)
      .join("\\s+");
    const matcher = new RegExp(flexiblePattern, "giu");
    let match;
    while ((match = matcher.exec(displayText)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) matcher.lastIndex += 1;
    }
  }
  return ranges;
};

/**
 * Recover ordered credits from a legacy display string without changing a
 * single display character. Exceptions are atomic names: an exact normalized
 * match disables splitting, while an occurrence inside a larger credit string
 * protects only that substring.
 */
export const parseLegacyArtistCredits = (displayText, exceptions = []) => {
  const display = String(displayText ?? "");
  if (!display.trim()) return [];

  const exceptionKeys = new Set(
    Array.from(exceptions ?? [], normalizeArtistName).filter(Boolean),
  );
  if (exceptionKeys.has(normalizeArtistName(display))) {
    return [{
      name: canonicalArtistName(display),
      creditedName: display,
      joinPhrase: "",
    }];
  }

  const protectedRanges = protectedArtistExceptionRanges(display, exceptions);
  const separators = [];
  LEGACY_ARTIST_SEPARATOR_PATTERN.lastIndex = 0;
  let match;
  while ((match = LEGACY_ARTIST_SEPARATOR_PATTERN.exec(display)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (!protectedRanges.some((range) => start < range.end && end > range.start)) {
      separators.push({ start, end, text: match[0] });
    }
  }

  if (separators.length === 0) {
    return [{
      name: canonicalArtistName(display),
      creditedName: display,
      joinPhrase: "",
    }];
  }

  const credits = [];
  let cursor = 0;
  for (const separator of separators) {
    const creditedName = display.slice(cursor, separator.start);
    if (!creditedName.trim()) {
      return [{
        name: canonicalArtistName(display),
        creditedName: display,
        joinPhrase: "",
      }];
    }
    credits.push({
      name: canonicalArtistName(creditedName),
      creditedName,
      joinPhrase: separator.text,
    });
    cursor = separator.end;
  }

  const creditedName = display.slice(cursor);
  if (!creditedName.trim()) {
    return [{
      name: canonicalArtistName(display),
      creditedName: display,
      joinPhrase: "",
    }];
  }
  credits.push({
    name: canonicalArtistName(creditedName),
    creditedName,
    joinPhrase: "",
  });
  return credits;
};

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
    acoustid_id TEXT,
    source_path TEXT UNIQUE NOT NULL,
    search_text TEXT,
    import_status TEXT NOT NULL DEFAULT 'staged',
    move_to_watched_folder_on_accept INTEGER NOT NULL DEFAULT 0,
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
    beat_grid_json TEXT,
    loudness_lufs REAL,
    replaygain_track_gain_db REAL,
    replaygain_track_peak REAL,
    replaygain_album_gain_db REAL,
    replaygain_album_peak REAL,
    loudness_source TEXT
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
    source_path TEXT,
    source_mtime_ms REAL,
    source_size INTEGER,
    source_sync_error TEXT,
    last_synced_at INTEGER,
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

const ARTIST_CREDIT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS artist_entities (
    id TEXT PRIMARY KEY
      CHECK(
        length(id) = 36
        AND substr(id, 9, 1) = '-'
        AND substr(id, 14, 1) = '-'
        AND substr(id, 19, 1) = '-'
        AND substr(id, 24, 1) = '-'
        AND id NOT GLOB '*[^0-9A-Fa-f-]*'
      ),
    canonical_name TEXT NOT NULL CHECK(length(trim(canonical_name)) > 0),
    normalized_name TEXT NOT NULL CHECK(length(trim(normalized_name)) > 0),
    musicbrainz_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS artist_entities_normalized_name_idx
    ON artist_entities(normalized_name);
  CREATE UNIQUE INDEX IF NOT EXISTS artist_entities_musicbrainz_id_uidx
    ON artist_entities(musicbrainz_id COLLATE NOCASE)
    WHERE musicbrainz_id IS NOT NULL AND trim(musicbrainz_id) <> '';

  CREATE TABLE IF NOT EXISTS track_artist_credit_sets (
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK(scope IN ('track', 'album')),
    display_text TEXT NOT NULL,
    provenance TEXT NOT NULL,
    confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
    needs_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_review IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(track_id, scope)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS track_artist_credits (
    track_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('track', 'album')),
    position INTEGER NOT NULL CHECK(position >= 0),
    artist_id TEXT NOT NULL REFERENCES artist_entities(id) ON DELETE RESTRICT,
    credited_name TEXT NOT NULL CHECK(length(trim(credited_name)) > 0),
    join_phrase TEXT NOT NULL DEFAULT '',
    role TEXT CHECK(role IS NULL OR length(trim(role)) > 0),
    PRIMARY KEY(track_id, scope, position),
    FOREIGN KEY(track_id, scope)
      REFERENCES track_artist_credit_sets(track_id, scope) ON DELETE CASCADE
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS track_artist_credits_artist_idx
    ON track_artist_credits(artist_id, scope, track_id);

  CREATE TRIGGER IF NOT EXISTS tracks_artist_credits_invalidate
  AFTER UPDATE OF artist ON tracks
  WHEN OLD.artist IS NOT NEW.artist
  BEGIN
    DELETE FROM track_artist_credit_sets
    WHERE track_id = NEW.id AND scope = 'track';
  END;

  CREATE TRIGGER IF NOT EXISTS tracks_album_artist_credits_invalidate
  AFTER UPDATE OF album_artist ON tracks
  WHEN OLD.album_artist IS NOT NEW.album_artist
  BEGIN
    DELETE FROM track_artist_credit_sets
    WHERE track_id = NEW.id AND scope = 'album';
  END;
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

const ACOUSTID_CACHE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS acoustid_fingerprints (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    source_mtime_ms REAL NOT NULL,
    source_size INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    result_json TEXT,
    looked_up_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS acoustid_fingerprints_looked_up_idx
    ON acoustid_fingerprints(looked_up_at DESC);
`;

const HISTORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
    played_at TEXT NOT NULL,
    listened_seconds REAL NOT NULL DEFAULT 0,
    duration_seconds REAL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    track_added_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS play_history_played_at_idx
    ON play_history(played_at DESC);
  CREATE INDEX IF NOT EXISTS play_history_track_idx
    ON play_history(track_id, played_at DESC);

  CREATE TABLE IF NOT EXISTS metadata_change_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    changed_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    changes_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS metadata_change_track_idx
    ON metadata_change_history(track_id, changed_at DESC);

  CREATE TABLE IF NOT EXISTS playlist_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS playlist_history_state_idx
    ON playlist_history(undone, id DESC);

  CREATE TABLE IF NOT EXISTS playlist_snapshots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS playlist_snapshots_created_idx
    ON playlist_snapshots(created_at DESC);
`;

/**
 * Full-text index over the already-normalized `tracks.search_text`.
 *
 * External-content FTS5: the index stores only the inverted terms and reads
 * values back from `tracks`, so the text is not duplicated. The triggers keep
 * both sides in step — every delete has to replay the old value so FTS can
 * retire the right terms.
 */
const SEARCH_INDEX_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
    search_text,
    content='tracks',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER IF NOT EXISTS tracks_fts_insert AFTER INSERT ON tracks BEGIN
    INSERT INTO tracks_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
  END;
  CREATE TRIGGER IF NOT EXISTS tracks_fts_delete AFTER DELETE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, search_text)
      VALUES ('delete', old.rowid, old.search_text);
  END;
  CREATE TRIGGER IF NOT EXISTS tracks_fts_update AFTER UPDATE OF search_text ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, search_text)
      VALUES ('delete', old.rowid, old.search_text);
    INSERT INTO tracks_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
  END;
`;

export const rebuildSearchIndex = (db) => {
  db.exec("INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild')");
};

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
  acoustid_id: "TEXT",
  source_path: "TEXT",
  search_text: "TEXT",
  import_status: "TEXT DEFAULT 'staged'",
  move_to_watched_folder_on_accept: "INTEGER NOT NULL DEFAULT 0",
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
  loudness_lufs: "REAL",
  replaygain_track_gain_db: "REAL",
  replaygain_track_peak: "REAL",
  replaygain_album_gain_db: "REAL",
  replaygain_album_peak: "REAL",
  // "tag" when read from the file's own ReplayGain frames, "analyzed" when
  // Muro measured it.
  loudness_source: "TEXT",
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
  db.exec(ACOUSTID_CACHE_SCHEMA);
  db.exec(HISTORY_SCHEMA);
  db.exec(ARTIST_CREDIT_SCHEMA);
  const playlistColumns = new Set(
    db.prepare("PRAGMA table_info(playlists)").all().map((column) => column.name)
  );
  if (!playlistColumns.has("folder_id")) {
    db.exec("ALTER TABLE playlists ADD COLUMN folder_id TEXT");
  }
  if (!playlistColumns.has("source_path")) {
    db.exec("ALTER TABLE playlists ADD COLUMN source_path TEXT");
  }
  if (!playlistColumns.has("source_mtime_ms")) {
    db.exec("ALTER TABLE playlists ADD COLUMN source_mtime_ms REAL");
  }
  if (!playlistColumns.has("source_size")) {
    db.exec("ALTER TABLE playlists ADD COLUMN source_size INTEGER");
  }
  if (!playlistColumns.has("source_sync_error")) {
    db.exec("ALTER TABLE playlists ADD COLUMN source_sync_error TEXT");
  }
  if (!playlistColumns.has("last_synced_at")) {
    db.exec("ALTER TABLE playlists ADD COLUMN last_synced_at INTEGER");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS playlists_source_path_idx
    ON playlists(source_path)
  `);
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
  // The index is created after the column migrations so `search_text` is
  // guaranteed to exist on databases written by older versions.
  const hadSearchIndex = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tracks_fts'")
    .get();
  db.exec(SEARCH_INDEX_SCHEMA);
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  const storedSearchTextVersion = Number(
    db.prepare("SELECT value FROM app_metadata WHERE key = 'search_text_version'").get()?.value,
  ) || 0;
  if (storedSearchTextVersion < SEARCH_TEXT_VERSION) {
    const refreshAllSearchText = db.transaction(() => {
      for (const row of db.prepare("SELECT id FROM tracks").all()) {
        refreshSearchText(db, row.id);
      }
      db.prepare(`
        INSERT INTO app_metadata(key, value) VALUES ('search_text_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(SEARCH_TEXT_VERSION));
    });
    refreshAllSearchText();
    rebuildSearchIndex(db);
  } else if (!hadSearchIndex) {
    rebuildSearchIndex(db);
  }

  connections.set(resolved, db);
  return db;
};

const musicBrainzArtistId = (value) => {
  const candidate = String(value ?? "").trim();
  return candidate || null;
};

const creditValue = (credit, ...keys) => {
  for (const key of keys) {
    if (credit?.[key] !== undefined && credit[key] !== null) return credit[key];
  }
  return undefined;
};

const normalizedCreditInput = (credit) => {
  const raw = typeof credit === "string" ? { creditedName: credit } : credit;
  if (!raw || typeof raw !== "object") {
    throw new TypeError("Artist credits must be strings or objects");
  }
  const creditedName = String(
    creditValue(raw, "creditedName", "credited_name", "name", "canonicalName", "canonical_name")
      ?? "",
  );
  const canonicalName = canonicalArtistName(
    creditValue(raw, "name", "canonicalName", "canonical_name") ?? creditedName,
  );
  if (!creditedName.trim() || !canonicalName) {
    throw new Error("Artist credits require a non-empty name");
  }
  const joinPhrase = String(creditValue(raw, "joinPhrase", "join_phrase") ?? "");
  const roleValue = creditValue(raw, "role");
  const role = roleValue == null || !String(roleValue).trim()
    ? null
    : String(roleValue).trim();
  return {
    artistId: String(creditValue(raw, "artistId", "artist_id") ?? "").trim() || null,
    canonicalName,
    normalizedName: normalizeArtistName(canonicalName),
    creditedName,
    joinPhrase,
    role,
    musicBrainzId: musicBrainzArtistId(
      creditValue(raw, "musicBrainzId", "musicbrainzId", "musicbrainz_id"),
    ),
  };
};

const ensureArtistEntity = (db, credit, timestamp) => {
  let row;
  let matchedByMusicBrainzId = false;
  if (credit.musicBrainzId) {
    row = db.prepare(`
      SELECT id, canonical_name, normalized_name, musicbrainz_id
      FROM artist_entities
      WHERE musicbrainz_id = ? COLLATE NOCASE
      LIMIT 1
    `).get(credit.musicBrainzId);
    matchedByMusicBrainzId = Boolean(row);
  }
  if (!row && credit.artistId) {
    row = db.prepare(`
      SELECT id, canonical_name, normalized_name, musicbrainz_id
      FROM artist_entities
      WHERE id = ?
    `).get(credit.artistId);
    const storedMusicBrainzId = musicBrainzArtistId(row?.musicbrainz_id);
    if (
      row
      && credit.musicBrainzId
      && storedMusicBrainzId
      && storedMusicBrainzId.toLocaleLowerCase()
        !== credit.musicBrainzId.toLocaleLowerCase()
    ) {
      row = undefined;
    }
  }
  if (!row) {
    row = credit.musicBrainzId
      ? db.prepare(`
          SELECT id, canonical_name, normalized_name, musicbrainz_id
          FROM artist_entities
          WHERE normalized_name = ?
            AND (musicbrainz_id IS NULL OR trim(musicbrainz_id) = '')
          ORDER BY created_at, id
          LIMIT 1
        `).get(credit.normalizedName)
      : db.prepare(`
          SELECT id, canonical_name, normalized_name, musicbrainz_id
          FROM artist_entities
          WHERE normalized_name = ?
            AND (musicbrainz_id IS NULL OR trim(musicbrainz_id) = '')
          ORDER BY created_at, id
          LIMIT 1
        `).get(credit.normalizedName);
  }

  if (row) {
    const hasDistinctCanonicalName = credit.canonicalName
      !== canonicalArtistName(credit.creditedName);
    if (
      matchedByMusicBrainzId
      && hasDistinctCanonicalName
      && (
        row.canonical_name !== credit.canonicalName
        || row.normalized_name !== credit.normalizedName
      )
    ) {
      db.prepare(`
        UPDATE artist_entities
        SET canonical_name = ?, normalized_name = ?, updated_at = ?
        WHERE id = ?
      `).run(
        credit.canonicalName,
        credit.normalizedName,
        timestamp,
        row.id,
      );
      row.canonical_name = credit.canonicalName;
      row.normalized_name = credit.normalizedName;
    }
    if (credit.musicBrainzId && !musicBrainzArtistId(row.musicbrainz_id)) {
      db.prepare(`
        UPDATE artist_entities
        SET musicbrainz_id = ?, updated_at = ?
        WHERE id = ?
      `).run(credit.musicBrainzId, timestamp, row.id);
      row.musicbrainz_id = credit.musicBrainzId;
    }
    return row;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO artist_entities(
      id, canonical_name, normalized_name, musicbrainz_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    credit.canonicalName,
    credit.normalizedName,
    credit.musicBrainzId,
    timestamp,
    timestamp,
  );
  return {
    id,
    canonical_name: credit.canonicalName,
    normalized_name: credit.normalizedName,
    musicbrainz_id: credit.musicBrainzId,
  };
};

/**
 * Atomically replace one track- or album-artist credit set. The caller keeps
 * the legacy scalar authoritative by updating tracks.artist/album_artist
 * first; the invalidation triggers clear stale sets before this replacement.
 */
export const replaceTrackArtistCredits = (
  db,
  {
    trackId,
    scope,
    displayText,
    credits,
    provenance = "user",
    confidence = 100,
    needsReview = false,
  },
) => {
  const normalizedTrackId = String(trackId ?? "").trim();
  const normalizedScope = String(scope ?? "").trim();
  const display = String(displayText ?? "");
  if (!normalizedTrackId) throw new Error("Artist credits require a track id");
  if (!ARTIST_CREDIT_SCOPES.has(normalizedScope)) {
    throw new Error("Artist credit scope must be track or album");
  }
  if (!display.trim()) throw new Error("Artist credits require display text");

  const normalizedCredits = (Array.isArray(credits) ? credits : [])
    .map(normalizedCreditInput);
  if (normalizedCredits.length === 0) {
    throw new Error("Artist credit sets require at least one credit");
  }
  const rendered = normalizedCredits
    .map((credit) => credit.creditedName + credit.joinPhrase)
    .join("");
  if (rendered !== display) {
    throw new Error("Artist credit names and join phrases must reproduce display text exactly");
  }

  const numericConfidence = Number(confidence);
  const boundedConfidence = Number.isFinite(numericConfidence)
    ? Math.max(0, Math.min(100, Math.round(numericConfidence)))
    : 100;
  const normalizedProvenance = String(provenance ?? "").trim() || "user";

  const replace = () => {
    if (!db.prepare("SELECT 1 FROM tracks WHERE id = ?").get(normalizedTrackId)) {
      throw new Error("Artist credit track was not found");
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const entities = normalizedCredits.map((credit) => ({
      credit,
      entity: ensureArtistEntity(db, credit, timestamp),
    }));
    db.prepare(`
      DELETE FROM track_artist_credits
      WHERE track_id = ? AND scope = ?
    `).run(normalizedTrackId, normalizedScope);
    db.prepare(`
      INSERT INTO track_artist_credit_sets(
        track_id, scope, display_text, provenance, confidence, needs_review,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(track_id, scope) DO UPDATE SET
        display_text = excluded.display_text,
        provenance = excluded.provenance,
        confidence = excluded.confidence,
        needs_review = excluded.needs_review,
        updated_at = excluded.updated_at
    `).run(
      normalizedTrackId,
      normalizedScope,
      display,
      normalizedProvenance,
      boundedConfidence,
      needsReview ? 1 : 0,
      timestamp,
      timestamp,
    );
    const insert = db.prepare(`
      INSERT INTO track_artist_credits(
        track_id, scope, position, artist_id, credited_name, join_phrase, role
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    entities.forEach(({ credit, entity }, position) => {
      insert.run(
        normalizedTrackId,
        normalizedScope,
        position,
        entity.id,
        credit.creditedName,
        credit.joinPhrase,
        credit.role,
      );
    });
    refreshSearchText(db, normalizedTrackId);
    return {
      trackId: normalizedTrackId,
      scope: normalizedScope,
      displayText: display,
      provenance: normalizedProvenance,
      confidence: boundedConfidence,
      needsReview: Boolean(needsReview),
      credits: entities.map(({ credit, entity }) => ({
        artistId: String(entity.id),
        name: String(entity.canonical_name),
        creditedName: credit.creditedName,
        joinPhrase: credit.joinPhrase,
        ...(entity.musicbrainz_id
          ? { musicBrainzId: String(entity.musicbrainz_id) }
          : {}),
        ...(credit.role ? { role: credit.role } : {}),
      })),
    };
  };
  return db.inTransaction ? replace() : db.transaction(replace)();
};

const artistCreditRows = (db, trackIds) => {
  const baseQuery = `
    SELECT
      credit_sets.track_id,
      credit_sets.scope,
      credits.position,
      credits.artist_id,
      credits.credited_name,
      credits.join_phrase,
      credits.role,
      entities.canonical_name,
      entities.musicbrainz_id
    FROM track_artist_credit_sets AS credit_sets
    JOIN tracks
      ON tracks.id = credit_sets.track_id
    JOIN track_artist_credits AS credits
      ON credits.track_id = credit_sets.track_id
      AND credits.scope = credit_sets.scope
    JOIN artist_entities AS entities
      ON entities.id = credits.artist_id
    WHERE credit_sets.display_text = CASE credit_sets.scope
      WHEN 'track' THEN tracks.artist
      ELSE tracks.album_artist
    END
  `;
  if (trackIds === undefined) {
    return db.prepare(baseQuery + `
      ORDER BY credit_sets.track_id, credit_sets.scope, credits.position
    `).all();
  }

  const ids = [...new Set(
    (Array.isArray(trackIds) ? trackIds : [trackIds])
      .map((trackId) => String(trackId ?? "").trim())
      .filter(Boolean),
  )];
  if (ids.length === 0) return [];
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    const placeholders = chunk.map(() => "?").join(", ");
    rows.push(...db.prepare(
      baseQuery
      + " AND credit_sets.track_id IN (" + placeholders + ")"
      + " ORDER BY credit_sets.track_id, credit_sets.scope, credits.position",
    ).all(...chunk));
  }
  return rows;
};

/**
 * Return hydrated renderer DTO arrays keyed by track id.
 */
export const loadArtistCredits = (db, trackIds) => {
  const byTrack = new Map();
  for (const row of artistCreditRows(db, trackIds)) {
    const trackId = String(row.track_id);
    const payload = byTrack.get(trackId) ?? {
      artist_credits: [],
      album_artist_credits: [],
    };
    const credit = {
      artistId: String(row.artist_id),
      name: String(row.canonical_name),
      creditedName: String(row.credited_name),
      joinPhrase: String(row.join_phrase ?? ""),
      ...(row.musicbrainz_id
        ? { musicBrainzId: String(row.musicbrainz_id) }
        : {}),
      ...(row.role ? { role: String(row.role) } : {}),
    };
    if (row.scope === "album") payload.album_artist_credits.push(credit);
    else payload.artist_credits.push(credit);
    byTrack.set(trackId, payload);
  }
  return byTrack;
};

/**
 * Idempotently populate missing or stale structured sets from legacy scalar
 * metadata. The original display string is always retained byte-for-byte.
 */
export const ensureStructuredArtistCredits = (
  dbPath,
  exceptions = [],
  { overrideExactExceptions = false } = {},
) => {
  const db = openDatabase(dbPath);
  const exceptionList = Array.from(exceptions ?? [], (value) => String(value ?? ""))
    .filter((value) => value.trim());
  const existingSets = new Map();
  for (const row of db.prepare(`
    SELECT
      credit_sets.track_id,
      credit_sets.scope,
      credit_sets.display_text,
      credit_sets.provenance,
      credits.position,
      credits.credited_name,
      credits.join_phrase
    FROM track_artist_credit_sets AS credit_sets
    LEFT JOIN track_artist_credits AS credits
      ON credits.track_id = credit_sets.track_id
      AND credits.scope = credit_sets.scope
    ORDER BY credit_sets.track_id, credit_sets.scope, credits.position
  `).all()) {
    const key = String(row.track_id) + "\0" + String(row.scope);
    const set = existingSets.get(key) ?? {
      displayText: String(row.display_text),
      provenance: String(row.provenance),
      credits: [],
    };
    if (row.position != null) {
      set.credits.push({
        creditedName: String(row.credited_name),
        joinPhrase: String(row.join_phrase ?? ""),
      });
    }
    existingSets.set(key, set);
  }
  const tracks = db.prepare(`
    SELECT
      id,
      artist,
      album_artist,
      musicbrainz_artistid,
      musicbrainz_albumartistid
    FROM tracks
  `).all();
  const result = {
    tracksChecked: tracks.length,
    setsCreated: 0,
    setsReplaced: 0,
    creditsCreated: 0,
  };

  const populate = () => {
    for (const track of tracks) {
      const candidates = [
        ["track", track.artist, track.musicbrainz_artistid],
        ["album", track.album_artist, track.musicbrainz_albumartistid],
      ];
      for (const [scope, rawDisplay, legacyMusicBrainzId] of candidates) {
        const displayText = String(rawDisplay ?? "");
        if (!displayText.trim()) continue;
        const key = String(track.id) + "\0" + scope;
        const credits = parseLegacyArtistCredits(displayText, exceptionList);
        const exactException = exceptionList.some(
          (exception) => normalizeArtistName(exception) === normalizeArtistName(displayText),
        );
        const existingSet = existingSets.get(key);
        const sameParsedCredits = existingSet
          && existingSet.credits.length === credits.length
          && existingSet.credits.every((credit, index) => (
            credit.creditedName === credits[index].creditedName
            && credit.joinPhrase === credits[index].joinPhrase
          ));
        if (
          existingSet
          && (
            (existingSet.provenance !== "legacy"
              && !(overrideExactExceptions && exactException))
            || (
              existingSet.displayText === displayText
              && sameParsedCredits
            )
          )
        ) {
          continue;
        }
        if (credits.length === 1) {
          const id = musicBrainzArtistId(legacyMusicBrainzId);
          if (id) credits[0].musicBrainzId = id;
        }
        replaceTrackArtistCredits(db, {
          trackId: String(track.id),
          scope,
          displayText,
          credits,
          provenance: "legacy",
          confidence: credits.length > 1 ? 75 : 100,
          needsReview: credits.length > 1,
        });
        if (existingSet === undefined) result.setsCreated += 1;
        else result.setsReplaced += 1;
        result.creditsCreated += credits.length;
        existingSets.set(key, {
          displayText,
          provenance: "legacy",
          credits: credits.map((credit) => ({
            creditedName: credit.creditedName,
            joinPhrase: credit.joinPhrase,
          })),
        });
      }
    }
  };
  if (db.inTransaction) populate();
  else db.transaction(populate)();
  return result;
};

/**
 * Run the legacy-credit migration only for a new database or changed exception
 * set. This avoids a persistent whole-library write during ordinary loads while
 * still giving existing libraries durable artist identities after upgrade.
 */
export const migrateStructuredArtistCredits = (dbPath, exceptions = []) => {
  const db = openDatabase(dbPath);
  const migrationState = JSON.stringify({
    version: 1,
    exceptions: [...new Set(
      Array.from(exceptions ?? [], normalizeArtistName).filter(Boolean),
    )].sort(),
  });
  const storedState = db.prepare(
    "SELECT value FROM app_metadata WHERE key = ?",
  ).get(ARTIST_CREDIT_MIGRATION_METADATA_KEY)?.value;
  if (storedState === migrationState) {
    return {
      skipped: true,
      tracksChecked: 0,
      setsCreated: 0,
      setsReplaced: 0,
      creditsCreated: 0,
    };
  }

  const result = ensureStructuredArtistCredits(dbPath, exceptions, {
    overrideExactExceptions: true,
  });
  db.prepare(`
    INSERT INTO app_metadata(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(ARTIST_CREDIT_MIGRATION_METADATA_KEY, migrationState);
  return { skipped: false, ...result };
};

export const getLibraryRoot = (dbPath) => {
  const value = openDatabase(dbPath)
    .prepare("SELECT value FROM app_metadata WHERE key = ?")
    .get(LIBRARY_ROOT_METADATA_KEY)?.value;
  return normalizeLibraryRoot(value);
};

/**
 * Store the machine-specific library root and convert paths already beneath it
 * to portable, forward-slash relative values. Absolute paths outside the root
 * remain supported for Inbox and legacy imports.
 */
export const configureLibraryRoot = (dbPath, requestedRoot) => {
  const root = normalizeLibraryRoot(requestedRoot);
  if (!root) return { libraryRoot: getLibraryRoot(dbPath), migrated: 0 };

  const db = openDatabase(dbPath);
  db.prepare(`
    INSERT INTO app_metadata(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(LIBRARY_ROOT_METADATA_KEY, root);

  const rows = db.prepare("SELECT id, source_path FROM tracks").all();
  const used = new Map(
    rows.map((row) => [portablePathKey(row.source_path), String(row.id)]),
  );
  const update = db.prepare("UPDATE tracks SET source_path = ? WHERE id = ?");
  let migrated = 0;

  db.transaction(() => {
    for (const row of rows) {
      const stored = String(row.source_path ?? "");
      const portable = toStoredTrackPath(stored, root);
      if (!portable || portable === stored) continue;

      const collision = used.get(portablePathKey(portable));
      if (collision && collision !== String(row.id)) continue;
      used.delete(portablePathKey(stored));
      update.run(portable, row.id);
      used.set(portablePathKey(portable), String(row.id));
      migrated += 1;
    }
    const updatePlaylist = db.prepare(
      "UPDATE playlists SET source_path = ? WHERE id = ?",
    );
    for (const playlist of db.prepare(`
      SELECT id, source_path
      FROM playlists
      WHERE source_path IS NOT NULL AND source_path <> ''
    `).all()) {
      const stored = String(playlist.source_path);
      const portable = toStoredTrackPath(stored, root);
      if (!portable || portable === stored) continue;
      updatePlaylist.run(portable, playlist.id);
      migrated += 1;
    }
  })();

  return { libraryRoot: root, migrated };
};

export const resolveLibraryPath = (dbPath, storedPath, libraryRoot) =>
  resolveStoredTrackPath(
    storedPath,
    normalizeLibraryRoot(libraryRoot) ?? getLibraryRoot(dbPath),
  );

export const storeLibraryPath = (dbPath, filePath, libraryRoot) =>
  toStoredTrackPath(
    filePath,
    normalizeLibraryRoot(libraryRoot) ?? getLibraryRoot(dbPath),
  );

export const resolveTrackPath = (dbPath, storedPath, libraryRoot) => {
  const resolved = resolveLibraryPath(dbPath, storedPath, libraryRoot);
  if (!path.isAbsolute(resolved)) {
    throw new Error("Choose the music library folder to use this track");
  }
  return resolved;
};
export const storeTrackPath = storeLibraryPath;

/** FTS5 treats bare punctuation and operator words as syntax, so each term is
 * reduced to a quoted literal with a prefix wildcard. An empty result means the
 * query had nothing searchable in it. */
export const buildSearchMatchQuery = (query) => {
  const terms = normalizeSearchText(query)
    .split(" ")
    // A term of pure punctuation tokenizes to nothing, so an expression built
    // from it would match zero rows and read as a real "no results" answer.
    // Dropping it here lets the caller fall back instead.
    .filter((term) => /[\p{L}\p{N}]/u.test(term))
    // Quote the term and escape any embedded quote, then allow prefix matches
    // so results narrow while the user is still typing.
    .map((term) => `"${term.replace(/"/g, '""')}"*`);
  return terms.length > 0 ? terms.join(" AND ") : "";
};

/**
 * Track ids matching a query, ordered by FTS relevance. Returns null when the
 * query has no searchable terms so callers can skip filtering entirely.
 */
export const searchTrackIds = (dbPath, query, limit = 0) => {
  const match = buildSearchMatchQuery(query);
  if (!match) return null;

  const db = openDatabase(dbPath);
  const bounded = Number(limit) > 0 ? Math.min(Number(limit), 100_000) : 100_000;
  try {
    return db.prepare(`
      SELECT t.id AS id
      FROM tracks_fts f
      JOIN tracks t ON t.rowid = f.rowid
      WHERE tracks_fts MATCH ?
      ORDER BY bm25(tracks_fts)
      LIMIT ?
    `).all(match, bounded).map((row) => String(row.id));
  } catch {
    // A malformed FTS expression must degrade to "no index answer" rather than
    // breaking search; the caller falls back to its own filtering.
    return null;
  }
};

export const closeDatabases = () => {
  for (const db of connections.values()) db.close();
  connections.clear();
};

export const closeDatabase = (dbPath) => {
  const resolved = path.resolve(dbPath);
  const db = connections.get(resolved);
  if (!db) return false;
  db.close();
  connections.delete(resolved);
  return true;
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

export const rowToTrack = (row, { dbPath, libraryRoot } = {}) => ({
  id: String(row.id),
  title: row.title || "Unknown Title",
  artist: row.artist || "Unknown Artist",
  artist_credits: Array.isArray(row.artist_credits) ? row.artist_credits : [],
  album_artist: row.album_artist || undefined,
  album_artist_credits:
    Array.isArray(row.album_artist_credits) ? row.album_artist_credits : [],
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
  source_path: dbPath
    ? resolveLibraryPath(dbPath, row.source_path, libraryRoot)
    : row.source_path || "",
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
  loudness_lufs: row.loudness_lufs ?? undefined,
  replaygain_track_gain_db: row.replaygain_track_gain_db ?? undefined,
  replaygain_track_peak: row.replaygain_track_peak ?? undefined,
  replaygain_album_gain_db: row.replaygain_album_gain_db ?? undefined,
  replaygain_album_peak: row.replaygain_album_peak ?? undefined,
  loudness_source: row.loudness_source ?? undefined,
  is_missing:
    Number(row.is_missing) === 1
    || (dbPath && !path.isAbsolute(resolveLibraryPath(dbPath, row.source_path, libraryRoot)))
      ? 1
      : 0,
  musicbrainz_trackid: row.musicbrainz_trackid || undefined,
  musicbrainz_albumid: row.musicbrainz_albumid || undefined,
  musicbrainz_releasegroupid: row.musicbrainz_releasegroupid || undefined,
  acoustid_id: row.acoustid_id || undefined,
  move_to_watched_folder_on_accept:
    Number(row.move_to_watched_folder_on_accept) === 1 ? 1 : 0,
});

const TRACK_SELECT = `
  SELECT id, title, artist, album_artist, album, track_number, track_total,
    key, bpm, year, date, added_at, updated_at, rating, duration_seconds,
    bitrate_kbps, sample_rate_hz, bit_depth, file_size_bytes,
    import_status, move_to_watched_folder_on_accept, source_path, cover_art_path,
    cover_art_thumb_path, last_played_at, play_count, genre_json,
    comment_json, label, disc_number, disc_total, beat_grid_json,
    musicbrainz_trackid, musicbrainz_albumid, musicbrainz_artistid,
    musicbrainz_albumartistid, musicbrainz_releasegroupid, acoustid_id,
    loudness_lufs, replaygain_track_gain_db, replaygain_track_peak,
    replaygain_album_gain_db, replaygain_album_peak, loudness_source,
    is_missing
  FROM tracks`;

const legacyCreditPayload = (displayText, exceptions, legacyMusicBrainzId) => {
  const parsed = parseLegacyArtistCredits(displayText, exceptions);
  const onlyMusicBrainzId = parsed.length === 1
    ? musicBrainzArtistId(legacyMusicBrainzId)
    : null;
  return parsed.map((credit) => ({
    artistId: "legacy:" + normalizeArtistName(credit.name),
    name: credit.name,
    creditedName: credit.creditedName,
    joinPhrase: credit.joinPhrase,
    ...(onlyMusicBrainzId ? { musicBrainzId: onlyMusicBrainzId } : {}),
  }));
};

const hydratedArtistCreditPayload = (row, structured, exceptions) => ({
  artist_credits: structured?.artist_credits?.length
    ? structured.artist_credits
    : legacyCreditPayload(row.artist || "Unknown Artist", exceptions, row.musicbrainz_artistid),
  album_artist_credits: structured?.album_artist_credits?.length
    ? structured.album_artist_credits
    : legacyCreditPayload(row.album_artist, exceptions, row.musicbrainz_albumartistid),
});

export const loadTracks = (dbPath, libraryRoot, artistSeparatorExceptions = []) => {
  if (libraryRoot) configureLibraryRoot(dbPath, libraryRoot);
  const db = openDatabase(dbPath);
  const rows = db
    .prepare(`${TRACK_SELECT} ORDER BY added_at DESC`)
    .all();
  const creditsByTrack = loadArtistCredits(db, rows.map((row) => row.id));
  const snapshot = { library: [], inbox: [] };
  for (const row of rows) {
    (row.import_status === "staged" ? snapshot.inbox : snapshot.library).push(
      rowToTrack({
        ...row,
        ...hydratedArtistCreditPayload(
          row,
          creditsByTrack.get(String(row.id)),
          artistSeparatorExceptions,
        ),
      }, { dbPath, libraryRoot })
    );
  }
  return snapshot;
};

export const loadRecentlyPlayed = (
  dbPath,
  limit = 50,
  libraryRoot,
  artistSeparatorExceptions = [],
) => {
  if (libraryRoot) configureLibraryRoot(dbPath, libraryRoot);
  const db = openDatabase(dbPath);
  const rows = db
    .prepare(`${TRACK_SELECT} WHERE last_played_at IS NOT NULL ORDER BY last_played_at DESC LIMIT ?`)
    .all(Math.max(0, Number(limit) || 0));
  const creditsByTrack = loadArtistCredits(db, rows.map((row) => row.id));
  return rows.map((row) => rowToTrack({
    ...row,
    ...hydratedArtistCreditPayload(
      row,
      creditsByTrack.get(String(row.id)),
      artistSeparatorExceptions,
    ),
  }, { dbPath, libraryRoot }));
};

export const loadPlaylists = (dbPath, libraryRoot) => {
  if (libraryRoot) configureLibraryRoot(dbPath, libraryRoot);
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
    SELECT id, name, folder_id, sort_order, source_path,
      source_mtime_ms, source_size, source_sync_error, last_synced_at
    FROM playlists
    ORDER BY folder_id, sort_order ASC, created_at DESC, id
  `).all().map((playlist) => ({
    id: String(playlist.id),
    name: playlist.name,
    folder_id: playlist.folder_id == null ? null : String(playlist.folder_id),
    sort_order: Number(playlist.sort_order) || 0,
    source_path: playlist.source_path == null
      ? null
      : resolveLibraryPath(dbPath, playlist.source_path),
    source_mtime_ms: playlist.source_mtime_ms == null
      ? null
      : Number(playlist.source_mtime_ms),
    source_size: playlist.source_size == null ? null : Number(playlist.source_size),
    source_sync_error: playlist.source_sync_error == null
      ? null
      : String(playlist.source_sync_error),
    last_synced_at: playlist.last_synced_at == null
      ? null
      : Number(playlist.last_synced_at),
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
      label, filename, year, track_number, disc_number, key, bpm
    FROM tracks WHERE id = ?
  `).get(trackId);
  if (!row) return;
  const parse = (raw) => {
    try { return JSON.parse(raw || "[]"); } catch { return []; }
  };
  const structuredCredits = loadArtistCredits(db, [trackId]).get(String(trackId));
  const individualArtistNames = [
    ...(structuredCredits?.artist_credits ?? []),
    ...(structuredCredits?.album_artist_credits ?? []),
  ].flatMap((credit) => [credit.name, credit.creditedName]);
  const searchText = normalizeSearchText(
    row.title, row.artist, row.album, row.album_artist,
    individualArtistNames,
    parse(row.genre_json), parse(row.comment_json), row.label, row.filename,
    row.year, row.track_number, row.disc_number, row.key, row.bpm
  );
  db.prepare("UPDATE tracks SET search_text = ? WHERE id = ?").run(searchText, trackId);
};
