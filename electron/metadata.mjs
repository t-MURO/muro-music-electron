import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseFile } from "music-metadata";
import sharp from "sharp";
import { TagLib } from "taglib-wasm";
import { normalizeSearchText, openDatabase, rowToTrack } from "./database.mjs";

export const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".aiff", ".aif", ".alac",
]);

let taglibPromise;
const getTagLib = () => (taglibPromise ??= TagLib.initialize());

const first = (value) => Array.isArray(value) ? value[0] : value;
const values = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

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

export const importAudioFile = async (dbPath, filePath, cacheDir) => {
  const db = openDatabase(dbPath);
  if (db.prepare("SELECT 1 FROM tracks WHERE source_path = ?").get(filePath)) return null;

  const metadata = await parseFile(filePath, { duration: true, skipCovers: false });
  const { common, format } = metadata;
  const genres = values(common.genre).filter(Boolean).map(String);
  const comments = values(common.comment).map(cleanComment).filter(Boolean).map(String);
  const artists = values(common.artists).filter(Boolean).map(String);
  const title = common.title || fallbackTitle(filePath);
  const artist = common.artist || artists.join(", ") || "Unknown Artist";
  const album = common.album || "Unknown Album";
  const albumArtist = common.albumartist || undefined;
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
    path.basename(filePath), year, trackNumber, discNumber
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
    musicbrainz_artistid: first(common.musicbrainz_artistid) ?? null,
    musicbrainz_albumartistid: first(common.musicbrainz_albumartistid) ?? null,
    musicbrainz_releasegroupid: first(common.musicbrainz_releasegroupid) ?? null,
    musicbrainz_trackid: first(common.musicbrainz_trackid) ?? null,
    musicbrainz_releasetrackid: first(common.musicbrainz_releasetrackid) ?? null,
    musicbrainz_albumstatus: first(common.musicbrainz_albumstatus) ?? null,
    musicbrainz_albumtype: first(common.musicbrainz_albumtype) ?? null,
    acoustid_id: first(common.acoustid_id) ?? null,
    source_path: filePath,
    search_text: searchText,
    import_status: "staged",
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

  db.prepare(`
    INSERT OR IGNORE INTO tracks (
      id, title, artist, album, album_artist, genre_json, comment_json, label,
      filename, year, date, track_number, track_total, disc_number, disc_total,
      key, bpm, rating, raw_tags_json, musicbrainz_albumid, musicbrainz_artistid,
      musicbrainz_albumartistid, musicbrainz_releasegroupid, musicbrainz_trackid,
      musicbrainz_releasetrackid, musicbrainz_albumstatus, musicbrainz_albumtype, acoustid_id,
      source_path, search_text, import_status,
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
      @source_path, @search_text, @import_status,
      @duration_seconds, @bitrate_kbps, @sample_rate_hz, @bit_depth, @file_size_bytes,
      @added_at, @updated_at, 0,
      @cover_art_path, @cover_art_thumb_path,
      @replaygain_track_gain_db, @replaygain_track_peak,
      @replaygain_album_gain_db, @replaygain_album_peak, @loudness_source
    )
  `).run(record);

  return rowToTrack({ ...record, last_played_at: null, play_count: 0 });
};

const propertyMap = {
  artists: "ALBUMARTIST",
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
      if (updates.artist !== undefined) tag.setArtist(String(updates.artist));
      if (updates.album !== undefined) tag.setAlbum(String(updates.album));
      if (updates.comment !== undefined) tag.setComment(String(updates.comment));
      if (updates.genre !== undefined) tag.setGenre(String(updates.genre));
      if (updates.year !== undefined) tag.setYear(Number(updates.year) || 0);
      if (updates.trackNumber !== undefined) tag.setTrack(Number(updates.trackNumber) || 0);
      for (const [key, property] of Object.entries(propertyMap)) {
        if (updates[key] !== undefined) file.setProperty(property, String(updates[key] ?? ""));
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
    if (coverBytes || expectedRating !== undefined) {
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
