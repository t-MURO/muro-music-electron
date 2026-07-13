import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseFile } from "music-metadata";
import sharp from "sharp";
import { TagLib } from "taglib-wasm";
import { normalizeSearchText, openDatabase, rowToTrack } from "./database.mjs";

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".aiff", ".aif", ".alac",
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
  const fullPath = path.join(cacheDir, `${hash}_full.jpg`);
  const thumbPath = path.join(cacheDir, `${hash}_thumb.jpg`);
  await fs.promises.mkdir(cacheDir, { recursive: true });
  if (!fs.existsSync(fullPath)) {
    await sharp(bytes).resize(512, 512, { fit: "cover" }).jpeg({ quality: 88 }).toFile(fullPath);
  }
  if (!fs.existsSync(thumbPath)) {
    await sharp(bytes).resize(128, 128, { fit: "cover" }).jpeg({ quality: 84 }).toFile(thumbPath);
  }
  return { fullPath, thumbPath };
};

export const cacheCoverFile = async (filePath, cacheDir) =>
  cacheCoverBytes(await fs.promises.readFile(filePath), cacheDir);

const ratingFromMetadata = (common) => {
  const rating = first(common.rating);
  if (typeof rating === "number") return Math.max(0, Math.min(5, rating <= 1 ? rating * 5 : rating));
  if (typeof rating?.rating === "number") return Math.max(0, Math.min(5, rating.rating * 5));
  return 0;
};

const fallbackTitle = (filePath) =>
  path.basename(filePath, path.extname(filePath)).replace(/^\s*\d+[\s._-]+/, "") || "Unknown Title";

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
  const picture = first(common.picture);
  const cached = picture?.data ? await cacheCoverBytes(picture.data, cacheDir) : undefined;
  const now = Math.floor(Date.now() / 1000);
  const stat = await fs.promises.stat(filePath);
  const id = randomUUID();
  const trackNumber = common.track?.no ?? undefined;
  const trackTotal = common.track?.of ?? undefined;
  const discNumber = common.disk?.no ?? undefined;
  const discTotal = common.disk?.of ?? undefined;
  const year = common.year ?? (common.date ? Number(String(common.date).slice(0, 4)) || undefined : undefined);
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
    rating: ratingFromMetadata(common),
    raw_tags_json: cleanRawTags(metadata.native),
    source_path: filePath,
    search_text: searchText,
    import_status: "staged",
    duration_seconds: format.duration || 0,
    bitrate_kbps: format.bitrate ? Math.round(format.bitrate / 1000) : 0,
    added_at: now,
    updated_at: Math.floor(stat.mtimeMs / 1000) || now,
    cover_art_path: cached?.fullPath ?? null,
    cover_art_thumb_path: cached?.thumbPath ?? null,
  };

  db.prepare(`
    INSERT OR IGNORE INTO tracks (
      id, title, artist, album, album_artist, genre_json, comment_json, label,
      filename, year, date, track_number, track_total, disc_number, disc_total,
      key, bpm, rating, raw_tags_json, source_path, search_text, import_status,
      duration_seconds, bitrate_kbps, added_at, updated_at, is_missing,
      cover_art_path, cover_art_thumb_path
    ) VALUES (
      @id, @title, @artist, @album, @album_artist, @genre_json, @comment_json, @label,
      @filename, @year, @date, @track_number, @track_total, @disc_number, @disc_total,
      @key, @bpm, @rating, @raw_tags_json, @source_path, @search_text, @import_status,
      @duration_seconds, @bitrate_kbps, @added_at, @updated_at, 0,
      @cover_art_path, @cover_art_thumb_path
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
  rating: "RATING",
};

export const writeMetadataToFile = async (sourcePath, updates) => {
  const taglib = await getTagLib();
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
    if (updates.coverArtPath) {
      const data = await fs.promises.readFile(updates.coverArtPath);
      file.setPictures([{ mimeType: "image/jpeg", data, type: "Cover (front)" }]);
    }
  });
};

export const extractAndCacheCover = async (sourcePath, cacheDir) => {
  const metadata = await parseFile(sourcePath, { skipCovers: false });
  const picture = first(metadata.common.picture);
  return picture?.data ? cacheCoverBytes(picture.data, cacheDir) : null;
};
