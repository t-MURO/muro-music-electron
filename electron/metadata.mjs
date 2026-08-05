import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseFile } from "music-metadata";
import sharp from "sharp";
import { TagLib } from "taglib-wasm";
import {
  normalizeSearchText,
  openDatabase,
  replaceTrackArtistCredits,
  rowToTrack,
  storeTrackPath,
} from "./database.mjs";

export const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".aiff", ".aif", ".alac",
]);

let taglibPromise;
const getTagLib = () => (taglibPromise ??= TagLib.initialize());

const first = (value) => Array.isArray(value) ? value[0] : value;
const values = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const propertyValues = (properties, key) => (
  Array.isArray(properties[key]) ? properties[key].map(String) : []
);

const rawArtistValue = (value) => String(value ?? "");
const cleanArtistValue = (value) => rawArtistValue(value).trim();
const nonBlankArtistValue = (value) => {
  const raw = rawArtistValue(value);
  return raw.trim() ? raw : "";
};
const artistValueList = (value) => values(value)
  .map(nonBlankArtistValue)
  .filter(Boolean);
const cleanValueList = (value) => values(value)
  .map(cleanArtistValue)
  .filter(Boolean);

const creditValue = (credit, ...keys) => {
  for (const key of keys) {
    if (credit?.[key] != null) return credit[key];
  }
  return undefined;
};

const inferredJoinPhrases = (display, names) => {
  if (names.length === 0) return [];
  const exactDisplay = nonBlankArtistValue(display);
  if (names.length === 1) return exactDisplay === names[0] ? [""] : null;

  const starts = [];
  let cursor = 0;
  for (const name of names) {
    const start = exactDisplay.indexOf(name, cursor);
    if (start < 0 || (starts.length === 0 && start !== 0)) {
      return null;
    }
    starts.push(start);
    cursor = start + name.length;
  }

  return names.map((name, index) => {
    const end = starts[index] + name.length;
    return index < names.length - 1
      ? exactDisplay.slice(end, starts[index + 1])
      : exactDisplay.slice(end);
  });
};

/** Normalize the snake_case and camelCase credit DTOs used by metadata providers. */
export const normalizeArtistCredits = (
  input,
  { display = "", names = [], musicbrainzIds = [] } = {},
) => {
  const source = Array.isArray(input) ? input : [];
  if (source.length > 0) {
    const normalized = source.flatMap((raw) => {
      const credit = typeof raw === "string" ? { creditedName: raw } : raw;
      if (!credit || typeof credit !== "object") return [];
      const canonicalName = cleanArtistValue(creditValue(
        credit,
        "canonicalName",
        "canonical_name",
        "name",
      ));
      const creditedName = nonBlankArtistValue(creditValue(
        credit,
        "creditedName",
        "credited_name",
      )) || canonicalName;
      const name = canonicalName || cleanArtistValue(creditedName);
      if (!name) return [];
      const joinValue = creditValue(credit, "joinPhrase", "join_phrase");
      const musicBrainzId = cleanArtistValue(creditValue(
        credit,
        "musicBrainzId",
        "musicbrainzId",
        "musicbrainz_id",
      ));
      return [{
        name,
        creditedName,
        joinPhrase: joinValue == null ? null : String(joinValue),
        ...(musicBrainzId ? { musicBrainzId } : {}),
      }];
    });
    return normalized.map((credit, index) => ({
      ...credit,
      joinPhrase: credit.joinPhrase ?? (index < normalized.length - 1 ? ", " : ""),
    }));
  }

  const normalizedNames = artistValueList(names);
  const exactDisplay = nonBlankArtistValue(display);
  if (normalizedNames.length === 0 && exactDisplay) {
    normalizedNames.push(exactDisplay);
  }
  const ids = cleanValueList(musicbrainzIds);
  const positionalIds = ids.length === normalizedNames.length ? ids : [];
  const joinPhrases = inferredJoinPhrases(exactDisplay, normalizedNames);
  if (exactDisplay && joinPhrases === null) {
    const name = cleanArtistValue(exactDisplay);
    return name ? [{
      name,
      creditedName: exactDisplay,
      joinPhrase: "",
      ...(normalizedNames.length === 1 && ids.length === 1
        ? { musicBrainzId: ids[0] }
        : {}),
    }] : [];
  }
  return normalizedNames.map((name, index) => ({
    name: cleanArtistValue(name),
    creditedName: name,
    joinPhrase: joinPhrases?.[index] ?? (index < normalizedNames.length - 1 ? ", " : ""),
    ...(positionalIds[index] ? { musicBrainzId: positionalIds[index] } : {}),
  }));
};

export const displayArtistCredits = (credits) => {
  const normalized = normalizeArtistCredits(credits);
  return normalized
    .map((credit) => `${credit.creditedName}${credit.joinPhrase}`)
    .join("");
};

export const artistMetadataFromCommon = (common = {}, propertyMetadata = {}) => {
  const propertyArtistNames = artistValueList(propertyMetadata.artistNames);
  const propertyArtistMusicbrainzIds = cleanValueList(propertyMetadata.artistMusicbrainzIds);
  const artistNames = propertyArtistNames.length > 0
    ? propertyArtistNames
    : artistValueList(common.artists);
  const artistMusicbrainzIds = propertyArtistMusicbrainzIds.length > 0
    ? propertyArtistMusicbrainzIds
    : cleanValueList(common.musicbrainz_artistid);
  const artist = nonBlankArtistValue(common.artist)
    || artistNames.join(", ")
    || "Unknown Artist";
  const propertyAlbumArtistNames = artistValueList(propertyMetadata.albumArtistNames);
  const propertyAlbumArtistMusicbrainzIds = cleanValueList(
    propertyMetadata.albumArtistMusicbrainzIds,
  );
  const albumArtistNames = propertyAlbumArtistNames.length > 0
    ? propertyAlbumArtistNames
    : artistValueList(common.albumartists);
  const albumArtistMusicbrainzIds = propertyAlbumArtistMusicbrainzIds.length > 0
    ? propertyAlbumArtistMusicbrainzIds
    : cleanValueList(common.musicbrainz_albumartistid);
  const albumArtist = nonBlankArtistValue(common.albumartist)
    || albumArtistNames.join(", ");

  return {
    artist,
    artistCredits: normalizeArtistCredits([], {
      display: artist,
      names: artistNames.length > 0 ? artistNames : [artist],
      musicbrainzIds: artistMusicbrainzIds,
    }),
    artistMusicbrainzIds,
    albumArtist: albumArtist || undefined,
    albumArtistCredits: normalizeArtistCredits([], {
      display: albumArtist,
      names: albumArtistNames.length > 0
        ? albumArtistNames
        : albumArtist ? [albumArtist] : [],
      musicbrainzIds: albumArtistMusicbrainzIds,
    }),
    albumArtistMusicbrainzIds,
  };
};

export const readArtistPropertiesFromFile = async (sourcePath) => {
  let file;
  try {
    const taglib = await getTagLib();
    file = await taglib.open(sourcePath);
    const properties = file.properties();
    return {
      artistNames: propertyValues(properties, "ARTISTS"),
      artistMusicbrainzIds: propertyValues(properties, "musicbrainzArtistId"),
      albumArtistNames: propertyValues(properties, "ALBUMARTISTS"),
      albumArtistMusicbrainzIds: propertyValues(
        properties,
        "musicbrainzReleaseArtistId",
      ),
    };
  } catch {
    return {};
  } finally {
    file?.dispose();
  }
};

const cleanComment = (comment) =>
  typeof comment === "string" ? comment : comment?.text;

const cleanRawTags = (native) => JSON.stringify(native, (_key, value) => {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[binary:${value.length}]`;
  if (typeof value === "bigint") return value.toString();
  return value;
});

export const collectAudioPaths = async (inputPaths) => {
  const found = [];
  const visit = async (candidate) => {
    let stat;
    try { stat = await fs.promises.stat(candidate); } catch { return; }
    if (stat.isFile()) {
      if (AUDIO_EXTENSIONS.has(path.extname(candidate).toLowerCase())) found.push(path.resolve(candidate));
      return;
    }
    if (!stat.isDirectory()) return;
    const entries = await fs.promises.readdir(candidate, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      await visit(path.join(candidate, entry.name));
    }
  };
  for (const inputPath of inputPaths) await visit(inputPath);
  return [...new Set(found)];
};

export const cacheCoverBytes = async (bytes, cacheDir) => {
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const fullPath = path.join(cacheDir, `${hash}_v2_full.jpg`);
  const thumbPath = path.join(cacheDir, `${hash}_v2_thumb.jpg`);
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const image = sharp(bytes).rotate();
  if (!fs.existsSync(fullPath)) {
    await image.clone()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#000000" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4", progressive: true })
      .toFile(fullPath);
  }
  if (!fs.existsSync(thumbPath)) {
    await image.clone()
      .resize(192, 192, { fit: "cover" })
      .flatten({ background: "#000000" })
      .jpeg({ quality: 86, progressive: true })
      .toFile(thumbPath);
  }
  return { fullPath, thumbPath };
};

export const cacheCoverFile = async (filePath, cacheDir) =>
  cacheCoverBytes(await fs.promises.readFile(filePath), cacheDir);

export const cacheEmbeddedCover = async (pictures, cacheDir, filePath) => {
  const candidates = values(pictures)
    .filter((picture) => picture?.data)
    .map((picture, index) => ({ picture, index }))
    .sort((left, right) => {
      const priority = ({ picture }) => /cover\s*\(front\)|front\s*cover/i.test(String(picture.type ?? ""))
        ? 0
        : 1;
      return priority(left) - priority(right) || left.index - right.index;
    });
  let lastError;
  for (const { picture } of candidates) {
    try {
      return await cacheCoverBytes(picture.data, cacheDir);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    // Malformed and uncommon embedded artwork should not make an otherwise
    // playable audio file impossible to import. Keep this concise because a
    // library import can encounter the same bad tag on many tracks.
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    console.warn(`No usable embedded artwork in ${filePath}: ${message}`);
  }
  return undefined;
};

const clampStars = (value) => Math.max(0, Math.min(5, value));
const MP3_POPM_BY_HALF_STAR = [0, 13, 1, 54, 64, 118, 128, 186, 196, 242, 255];
const VORBIS_RATING_EXTENSIONS = new Set([".flac", ".ogg", ".opus"]);

export const starsFromNormalizedRating = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  // Muro exposes half-star steps. Snapping also removes the small 8-bit
  // quantization error used by ID3 POPM ratings (for example 204 / 255).
  return Math.round(clampStars(value * 5) * 2) / 2;
};

export const normalizedRatingFromStars = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(clampStars(numeric) * 2) / 10;
};

export const starsFromMp3PopmRating = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const raw = Math.max(0, Math.min(255, Math.round(value * 255)));
  const exactHalfStar = MP3_POPM_BY_HALF_STAR.indexOf(raw);
  if (exactHalfStar >= 0) return exactHalfStar / 2;
  if (raw <= 31) return 1;
  if (raw <= 95) return 2;
  if (raw <= 159) return 3;
  if (raw <= 223) return 4;
  return 5;
};

export const starsFromVorbisRating = (value) => {
  const raw = first(value);
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const text = String(raw).trim();
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  if (numeric === 0) return 0;

  // A decimal in the normalized range is treated as 0.0–1.0. Preserve the
  // common integer 1–5 convention when the source is an integer string.
  if (numeric <= 1 && /[.eE]/.test(text)) {
    return starsFromNormalizedRating(numeric);
  }
  if (Number.isInteger(numeric) && numeric <= 5) {
    return numeric;
  }
  if (numeric <= 1) {
    return starsFromNormalizedRating(numeric);
  }
  if (numeric <= 100) {
    return Math.round(clampStars(numeric / 20) * 2) / 2;
  }
  if (numeric <= 255) {
    return starsFromMp3PopmRating(numeric / 255);
  }
  return undefined;
};

export const vorbisRatingFromStars = (value) => {
  const normalized = normalizedRatingFromStars(value);
  return Math.round(starsFromNormalizedRating(normalized) * 20);
};

const starsFromFileRating = (sourcePath, value) =>
  path.extname(sourcePath).toLowerCase() === ".mp3"
    ? starsFromMp3PopmRating(value)
    : starsFromNormalizedRating(value);

const mp3PopmRatingFromStars = (value) => {
  const stars = starsFromNormalizedRating(normalizedRatingFromStars(value));
  const raw = MP3_POPM_BY_HALF_STAR[Math.round(stars * 2)];
  // An exact 1.0 overflows in taglib-wasm 1.4.0; 0.999 serializes to 255.
  return raw === 255 ? 0.999 : raw / 255;
};

const ratingFromMetadata = (common, sourcePath) => {
  const rating = first(common.rating);
  if (typeof rating === "number") {
    return rating <= 1
      ? starsFromFileRating(sourcePath, rating)
      : Math.round(clampStars(rating) * 2) / 2;
  }
  if (typeof rating?.rating === "number") {
    return starsFromFileRating(sourcePath, rating.rating);
  }
  return 0;
};

/**
 * TagLib normalizes the format-specific rating fields used by ID3/MP3,
 * Vorbis/FLAC/Ogg, and MP4. Keep music-metadata as a fallback so an optional
 * rating never prevents an otherwise valid file from being imported.
 */
export const readRatingFromFile = async (sourcePath, common = {}) => {
  let file;
  try {
    const taglib = await getTagLib();
    file = await taglib.open(sourcePath);
    if (VORBIS_RATING_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) {
      const vorbisRating = starsFromVorbisRating(file.getProperty("RATING"));
      if (vorbisRating !== undefined) return vorbisRating;
    }
    const rating = file.getRating();
    if (typeof rating === "number" && Number.isFinite(rating)) {
      return starsFromFileRating(sourcePath, rating);
    }
  } catch {
    // Unsupported or damaged tags can still be exposed by music-metadata.
  } finally {
    file?.dispose();
  }
  return ratingFromMetadata(common, sourcePath);
};

const fallbackTitle = (filePath) =>
  path.basename(filePath, path.extname(filePath)).replace(/^\s*\d+[\s._-]+/, "") || "Unknown Title";

const finiteOrNull = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * ReplayGain values already written into the file by another tool. music-metadata
 * exposes these as { dB, ratio }; gains are read in dB and peaks as a linear
 * ratio. Files tagged this way need no analysis pass.
 */
export const replayGainFromTags = (common) => {
  const trackGainDb = finiteOrNull(common.replaygain_track_gain?.dB);
  const albumGainDb = finiteOrNull(common.replaygain_album_gain?.dB);
  const trackPeak =
    finiteOrNull(common.replaygain_track_peak?.ratio) ??
    finiteOrNull(common.replaygain_track_peak_ratio);
  const albumPeak = finiteOrNull(common.replaygain_album_peak?.ratio);

  const hasAny = trackGainDb !== null || albumGainDb !== null;
  return {
    replaygain_track_gain_db: trackGainDb,
    replaygain_track_peak: trackPeak,
    replaygain_album_gain_db: albumGainDb,
    replaygain_album_peak: albumPeak,
    loudness_source: hasAny ? "tag" : null,
  };
};

export const importAudioFile = async (
  dbPath,
  filePath,
  cacheDir,
  { moveToWatchedFolderOnAccept = false } = {},
) => {
  const db = openDatabase(dbPath);
  const storedSourcePath = storeTrackPath(dbPath, filePath);
  if (db.prepare("SELECT 1 FROM tracks WHERE source_path = ?").get(storedSourcePath)) return null;

  const metadata = await parseFile(filePath, { duration: true, skipCovers: false });
  const { common, format } = metadata;
  const artistPropertyMetadata = await readArtistPropertiesFromFile(filePath);
  const genres = values(common.genre).filter(Boolean).map(String);
  const comments = values(common.comment).map(cleanComment).filter(Boolean).map(String);
  const {
    artist,
    artistCredits,
    albumArtist,
    albumArtistCredits,
  } = artistMetadataFromCommon(common, artistPropertyMetadata);
  const title = common.title || fallbackTitle(filePath);
  const album = common.album || "Unknown Album";
  const label = first(common.label) || undefined;
  const cached = await cacheEmbeddedCover(common.picture, cacheDir, filePath);
  const now = Math.floor(Date.now() / 1000);
  const stat = await fs.promises.stat(filePath);
  const id = randomUUID();
  const trackNumber = common.track?.no ?? undefined;
  const trackTotal = common.track?.of ?? undefined;
  const discNumber = common.disk?.no ?? undefined;
  const discTotal = common.disk?.of ?? undefined;
  const year = common.year ?? (common.date ? Number(String(common.date).slice(0, 4)) || undefined : undefined);
  const rating = await readRatingFromFile(filePath, common);
  const searchText = normalizeSearchText(
    title, artist, album, albumArtist, genres, comments, label,
    path.basename(filePath), year, trackNumber, discNumber, common.key, common.bpm
  );

  const record = {
    id,
    title,
    artist,
    album,
    album_artist: albumArtist ?? null,
    genre_json: JSON.stringify(genres),
    comment_json: JSON.stringify(comments),
    label: label ?? null,
    filename: path.basename(filePath),
    year: year ?? null,
    date: common.date ?? null,
    track_number: trackNumber ?? null,
    track_total: trackTotal ?? null,
    disc_number: discNumber ?? null,
    disc_total: discTotal ?? null,
    key: common.key ?? null,
    bpm: common.bpm ?? null,
    rating,
    raw_tags_json: cleanRawTags(metadata.native),
    musicbrainz_albumid: first(common.musicbrainz_albumid) ?? null,
    musicbrainz_artistid: artistCredits[0]?.musicBrainzId ?? null,
    musicbrainz_albumartistid: albumArtistCredits[0]?.musicBrainzId ?? null,
    musicbrainz_releasegroupid: first(common.musicbrainz_releasegroupid) ?? null,
    musicbrainz_trackid: first(common.musicbrainz_trackid) ?? null,
    musicbrainz_releasetrackid: first(common.musicbrainz_releasetrackid) ?? null,
    musicbrainz_albumstatus: first(common.musicbrainz_albumstatus) ?? null,
    musicbrainz_albumtype: first(common.musicbrainz_albumtype) ?? null,
    acoustid_id: first(common.acoustid_id) ?? null,
    source_path: storedSourcePath,
    search_text: searchText,
    import_status: "staged",
    move_to_watched_folder_on_accept: moveToWatchedFolderOnAccept ? 1 : 0,
    duration_seconds: format.duration || 0,
    bitrate_kbps: format.bitrate ? Math.round(format.bitrate / 1000) : 0,
    sample_rate_hz: format.sampleRate ? Math.round(format.sampleRate) : 0,
    bit_depth: format.bitsPerSample ? Math.round(format.bitsPerSample) : 0,
    file_size_bytes: stat.size,
    added_at: now,
    updated_at: Math.floor(stat.mtimeMs / 1000) || now,
    cover_art_path: cached?.fullPath ?? null,
    cover_art_thumb_path: cached?.thumbPath ?? null,
    ...replayGainFromTags(common),
  };

  const insertTrack = db.prepare(`
    INSERT OR IGNORE INTO tracks (
      id, title, artist, album, album_artist, genre_json, comment_json, label,
      filename, year, date, track_number, track_total, disc_number, disc_total,
      key, bpm, rating, raw_tags_json, musicbrainz_albumid, musicbrainz_artistid,
      musicbrainz_albumartistid, musicbrainz_releasegroupid, musicbrainz_trackid,
      musicbrainz_releasetrackid, musicbrainz_albumstatus, musicbrainz_albumtype, acoustid_id,
      source_path, search_text, import_status, move_to_watched_folder_on_accept,
      duration_seconds, bitrate_kbps, sample_rate_hz, bit_depth, file_size_bytes,
      added_at, updated_at, is_missing,
      cover_art_path, cover_art_thumb_path,
      replaygain_track_gain_db, replaygain_track_peak,
      replaygain_album_gain_db, replaygain_album_peak, loudness_source
    ) VALUES (
      @id, @title, @artist, @album, @album_artist, @genre_json, @comment_json, @label,
      @filename, @year, @date, @track_number, @track_total, @disc_number, @disc_total,
      @key, @bpm, @rating, @raw_tags_json, @musicbrainz_albumid, @musicbrainz_artistid,
      @musicbrainz_albumartistid, @musicbrainz_releasegroupid, @musicbrainz_trackid,
      @musicbrainz_releasetrackid, @musicbrainz_albumstatus, @musicbrainz_albumtype, @acoustid_id,
      @source_path, @search_text, @import_status, @move_to_watched_folder_on_accept,
      @duration_seconds, @bitrate_kbps, @sample_rate_hz, @bit_depth, @file_size_bytes,
      @added_at, @updated_at, 0,
      @cover_art_path, @cover_art_thumb_path,
      @replaygain_track_gain_db, @replaygain_track_peak,
      @replaygain_album_gain_db, @replaygain_album_peak, @loudness_source
    )
  `);

  const persistTrack = () => {
    const insertResult = insertTrack.run(record);

    // Another import path (manual import, watcher scan, or a second renderer
    // request) may have inserted this source while metadata was being parsed.
    // Never return a generated ID that SQLite rejected, because the renderer
    // would otherwise display a track that does not exist in the database.
    if (Number(insertResult.changes) === 0) return null;

    const trackCreditSet = replaceTrackArtistCredits(db, {
      trackId: id,
      scope: "track",
      displayText: artist,
      credits: artistCredits,
      provenance: "file-tags",
      confidence: 100,
      needsReview: false,
    });
    const albumCreditSet = albumArtist && albumArtistCredits.length > 0
      ? replaceTrackArtistCredits(db, {
        trackId: id,
        scope: "album",
        displayText: albumArtist,
        credits: albumArtistCredits,
        provenance: "file-tags",
        confidence: 100,
        needsReview: false,
      })
      : null;
    return {
      artistCredits: trackCreditSet.credits,
      albumArtistCredits: albumCreditSet?.credits ?? [],
    };
  };
  const storedCredits = db.inTransaction
    ? persistTrack()
    : db.transaction(persistTrack)();

  if (!storedCredits) return null;
  const importedTrack = rowToTrack(
    { ...record, last_played_at: null, play_count: 0 },
    { dbPath },
  );
  return {
    ...importedTrack,
    artist_credits: storedCredits.artistCredits,
    album_artist_credits: storedCredits.albumArtistCredits,
  };
};

const propertyMap = {
  trackTotal: "TRACKTOTAL",
  discNumber: "DISCNUMBER",
  discTotal: "DISCTOTAL",
  label: "LABEL",
  bpm: "BPM",
  key: "INITIALKEY",
  musicBrainzTrackId: "MUSICBRAINZ_TRACKID",
  musicBrainzAlbumId: "MUSICBRAINZ_ALBUMID",
  musicBrainzReleaseGroupId: "MUSICBRAINZ_RELEASEGROUPID",
  acoustIdId: "ACOUSTID_ID",
};

const RATING_UNSUPPORTED_EXTENSIONS = new Set([".wav", ".aif", ".aiff"]);
const STRUCTURED_ARTIST_TAG_EXTENSIONS = new Set([
  ".mp3", ".flac", ".m4a", ".alac", ".aac", ".ogg", ".opus",
]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sameStringValues = (left, right) => (
  left.length === right.length
  && left.every((value, index) => value === right[index])
);
const completeMusicBrainzIds = (credits) => (
  credits.length > 0 && credits.every((credit) => Boolean(credit.musicBrainzId))
    ? credits.map((credit) => credit.musicBrainzId)
    : []
);

export const writeMetadataToFile = async (sourcePath, updates) => {
  const expectedRating = updates.rating === undefined
    ? undefined
    : normalizedRatingFromStars(updates.rating);
  const extension = path.extname(sourcePath).toLowerCase();
  if (expectedRating !== undefined && RATING_UNSUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`The ${extension.slice(1).toUpperCase()} format does not support embedded ratings`);
  }
  const taglib = await getTagLib();
  const coverBytes = updates.coverArtPath
    ? await fs.promises.readFile(updates.coverArtPath)
    : null;
  const vorbisRatingValue = expectedRating !== undefined
    && expectedRating > 0
    && VORBIS_RATING_EXTENSIONS.has(extension)
    ? String(vorbisRatingFromStars(updates.rating))
    : undefined;
  let replacedVorbisRating;
  const writesArtistCredits = hasOwn(updates, "artistCredits");
  const writesAlbumArtistCredits = hasOwn(updates, "albumArtistCredits");
  const artistCredits = writesArtistCredits
    ? normalizeArtistCredits(updates.artistCredits)
    : [];
  const albumArtistCredits = writesAlbumArtistCredits
    ? normalizeArtistCredits(updates.albumArtistCredits)
    : [];
  const artistDisplay = updates.artist !== undefined
    ? String(updates.artist)
    : writesArtistCredits ? displayArtistCredits(artistCredits) : undefined;
  const albumArtistDisplay = updates.albumArtist !== undefined
    ? String(updates.albumArtist)
    : updates.artists !== undefined
      ? String(updates.artists)
      : writesAlbumArtistCredits ? displayArtistCredits(albumArtistCredits) : undefined;

  // taglib-wasm exposes Vorbis RATING through both its complex rating API and
  // generic property API. When the field already exists, setting the generic
  // property is silently ignored. Clear it in one save so the following save
  // can create the MusicBee-compatible integer value.
  if (vorbisRatingValue !== undefined) {
    const file = await taglib.open(sourcePath);
    let currentRating;
    try {
      currentRating = file.getProperty("RATING") ?? "";
    } finally {
      file.dispose();
    }
    if (currentRating !== "" && currentRating !== vorbisRatingValue) {
      await taglib.edit(sourcePath, (editable) => editable.setRatings([]));
      replacedVorbisRating = currentRating;
    }
  }

  try {
    await taglib.edit(sourcePath, async (file) => {
      const tag = file.tag();
      if (updates.title !== undefined) tag.setTitle(String(updates.title));
      if (updates.album !== undefined) tag.setAlbum(String(updates.album));
      if (updates.comment !== undefined) tag.setComment(String(updates.comment));
      if (updates.genre !== undefined) tag.setGenre(String(updates.genre));
      if (updates.year !== undefined) tag.setYear(Number(updates.year) || 0);
      if (updates.trackNumber !== undefined) tag.setTrack(Number(updates.trackNumber) || 0);
      for (const [key, property] of Object.entries(propertyMap)) {
        if (updates[key] !== undefined) file.setProperty(property, String(updates[key] ?? ""));
      }
      if (
        artistDisplay !== undefined
        || albumArtistDisplay !== undefined
        || writesArtistCredits
        || writesAlbumArtistCredits
      ) {
        const preservedRatings = expectedRating === undefined ? file.getRatings() : null;
        const properties = { ...file.properties() };
        if (artistDisplay !== undefined) {
          properties.artist = artistDisplay ? [artistDisplay] : [];
        }
        if (albumArtistDisplay !== undefined) {
          properties.albumArtist = albumArtistDisplay ? [albumArtistDisplay] : [];
        }
        if (writesArtistCredits) {
          properties.ARTISTS = artistCredits.map((credit) => credit.creditedName);
          properties.musicbrainzArtistId = completeMusicBrainzIds(artistCredits);
        }
        if (writesAlbumArtistCredits) {
          // ALBUMARTIST is the interoperable display credit. ALBUMARTISTS is a
          // lossless multi-value companion understood by Muro and taggers that
          // preserve arbitrary PropertyMap fields.
          properties.ALBUMARTISTS = albumArtistCredits.map((credit) => credit.creditedName);
          properties.musicbrainzReleaseArtistId = completeMusicBrainzIds(albumArtistCredits);
        }
        file.setProperties(properties);
        // A full PropertyMap round-trip serializes MP3 POPM ratings through a
        // generic string representation. Restore the richer rating objects so
        // an artist-only edit cannot silently change an existing star rating.
        if (preservedRatings) {
          const safeRatings = extension === ".mp3"
            ? preservedRatings.map((rating) => ({
              ...rating,
              // taglib-wasm 1.4.0 serializes an exact 1.0 as POPM byte 1;
              // 0.999 is its documented/full-scale-safe representation.
              rating: rating.rating === 1 ? 0.999 : rating.rating,
            }))
            : preservedRatings;
          file.setRatings(safeRatings);
        }
      }
      if (expectedRating !== undefined) {
        if (expectedRating === 0) {
          file.setRatings([]);
        } else {
          if (vorbisRatingValue !== undefined) {
            // MusicBee and other common Vorbis Comment readers use an integer
            // percentage rather than a normalized decimal.
            file.setProperty("RATING", vorbisRatingValue);
          } else {
            // MP3 POPM uses application-defined 0–255 bands rather than a linear
            // five-star scale. Use values compatible with Windows Explorer and
            // common half-star-aware players. Other tag types stay normalized.
            const serializedRating = extension === ".mp3"
              ? mp3PopmRatingFromStars(updates.rating)
              : expectedRating === 1 ? 0.999 : expectedRating;
            file.setRating(serializedRating);
          }
        }
      }
      if (coverBytes) {
        file.setPictures([{
          mimeType: "image/jpeg",
          data: coverBytes,
          type: "FrontCover",
          description: "Front Cover",
        }]);
      }
    });

    // Reopen the file after TagLib's save. This distinguishes a real embedded
    // metadata write from formats that silently ignore an unsupported field.
    if (
      coverBytes
      || expectedRating !== undefined
      || artistDisplay !== undefined
      || albumArtistDisplay !== undefined
      || writesArtistCredits
      || writesAlbumArtistCredits
    ) {
      const file = await taglib.open(sourcePath);
      try {
        if (coverBytes) {
          const embeddedCover = file.getPictures()
            .find((picture) => picture.type === "FrontCover" && picture.data.length > 0);
          if (!embeddedCover) {
            throw new Error("The audio format did not retain the embedded front cover");
          }
        }
        if (expectedRating !== undefined) {
          const persistedRating = VORBIS_RATING_EXTENSIONS.has(extension)
            ? starsFromVorbisRating(file.getProperty("RATING"))
            : file.getRating();
          const persistedStars = VORBIS_RATING_EXTENSIONS.has(extension)
            ? persistedRating ?? 0
            : typeof persistedRating === "number" && Number.isFinite(persistedRating)
              ? starsFromFileRating(sourcePath, persistedRating)
              : 0;
          const expectedStars = starsFromNormalizedRating(expectedRating);
          if (persistedStars !== expectedStars) {
            throw new Error(
              `The audio format did not retain the embedded rating (${expectedStars} stars requested)`,
            );
          }
        }
        const persistedProperties = file.properties();
        if (
          artistDisplay !== undefined
          && propertyValues(persistedProperties, "artist")[0] !== artistDisplay
        ) {
          throw new Error("The audio format did not retain the artist display credit");
        }
        if (
          albumArtistDisplay !== undefined
          && STRUCTURED_ARTIST_TAG_EXTENSIONS.has(extension)
          && propertyValues(persistedProperties, "albumArtist")[0] !== albumArtistDisplay
        ) {
          throw new Error("The audio format did not retain the album artist display credit");
        }
        if (writesArtistCredits && STRUCTURED_ARTIST_TAG_EXTENSIONS.has(extension)) {
          const expectedNames = artistCredits.map((credit) => credit.creditedName);
          const expectedIds = completeMusicBrainzIds(artistCredits);
          if (!sameStringValues(propertyValues(persistedProperties, "ARTISTS"), expectedNames)) {
            throw new Error("The audio format did not retain the structured track artists");
          }
          if (
            !sameStringValues(
              propertyValues(persistedProperties, "musicbrainzArtistId"),
              expectedIds,
            )
          ) {
            throw new Error("The audio format did not retain the track artist identifiers");
          }
        }
        if (writesAlbumArtistCredits && STRUCTURED_ARTIST_TAG_EXTENSIONS.has(extension)) {
          const expectedNames = albumArtistCredits.map((credit) => credit.creditedName);
          const expectedIds = completeMusicBrainzIds(albumArtistCredits);
          if (!sameStringValues(
            propertyValues(persistedProperties, "ALBUMARTISTS"),
            expectedNames,
          )) {
            throw new Error("The audio format did not retain the structured album artists");
          }
          if (!sameStringValues(
            propertyValues(persistedProperties, "musicbrainzReleaseArtistId"),
            expectedIds,
          )) {
            throw new Error("The audio format did not retain the album artist identifiers");
          }
        }
      } finally {
        file.dispose();
      }
    }
  } catch (error) {
    if (replacedVorbisRating !== undefined) {
      try {
        await taglib.edit(sourcePath, (file) => file.setRatings([]));
        await taglib.edit(
          sourcePath,
          (file) => file.setProperty("RATING", replacedVorbisRating),
        );
      } catch (restoreError) {
        console.warn(`Failed to restore the previous rating in ${sourcePath}:`, restoreError);
      }
    }
    throw error;
  }
};

export const extractCoverMetadata = async (sourcePath, cacheDir) => {
  const metadata = await parseFile(sourcePath, { skipCovers: false });
  return {
    cached: await cacheEmbeddedCover(metadata.common.picture, cacheDir, sourcePath) ?? null,
    musicbrainz_albumid: first(metadata.common.musicbrainz_albumid) ?? null,
    musicbrainz_releasegroupid: first(metadata.common.musicbrainz_releasegroupid) ?? null,
  };
};

export const extractTechnicalMetadata = async (sourcePath) => {
  const [metadata, stat] = await Promise.all([
    parseFile(sourcePath, { duration: false, skipCovers: true }),
    fs.promises.stat(sourcePath),
  ]);
  return {
    sampleRateHz: metadata.format.sampleRate
      ? Math.round(metadata.format.sampleRate)
      : 0,
    bitDepth: metadata.format.bitsPerSample
      ? Math.round(metadata.format.bitsPerSample)
      : 0,
    fileSizeBytes: stat.size,
  };
};

export const extractAndCacheCover = async (sourcePath, cacheDir) => (
  await extractCoverMetadata(sourcePath, cacheDir)
).cached;

/** Duration in seconds, or 0 when the file cannot be parsed. */
export const readAudioDuration = async (sourcePath) => {
  try {
    const metadata = await parseFile(sourcePath, { duration: true, skipCovers: true });
    return metadata.format.duration || 0;
  } catch {
    return 0;
  }
};
