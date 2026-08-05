import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  configureLibraryRoot,
  openDatabase,
  refreshSearchText,
  resolveTrackPath,
  storeTrackPath,
} from "./database.mjs";

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export const sanitizeExportSegment = (value, fallback = "Unknown") => {
  const cleaned = String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[ .]+$/g, "")
    .trim()
    .slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
};

const portablePathKey = (value) => value.split(path.sep).join("/").toLocaleLowerCase();

const uniqueName = (directory, requestedName, usedPaths) => {
  const parsed = path.parse(requestedName);
  let candidate = requestedName;
  let suffix = 2;
  while (usedPaths.has(portablePathKey(path.join(directory, candidate)))) {
    candidate = `${parsed.name} (${suffix})${parsed.ext}`;
    suffix += 1;
  }
  usedPaths.add(portablePathKey(path.join(directory, candidate)));
  return candidate;
};

const createNamedExportRoot = async (destinationPath, rootName) => {
  const destination = path.resolve(String(destinationPath ?? ""));
  const stats = await fs.promises.stat(destination);
  if (!stats.isDirectory()) throw new Error("The export destination is not a directory");

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const name = suffix === 1 ? rootName : `${rootName} (${suffix})`;
    const exportRoot = path.join(destination, name);
    try {
      await fs.promises.mkdir(exportRoot);
      return exportRoot;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not create a unique ${rootName} export folder`);
};

const createExportRoot = (destinationPath) =>
  createNamedExportRoot(destinationPath, "Muro Library");

const albumArtistOrArtist = (track) =>
  String(track.album_artist ?? "").trim()
  || String(track.artist ?? "").trim()
  || "Unknown Artist";

const albumGroupKey = (track) => [
  albumArtistOrArtist(track).toLocaleLowerCase(),
  String(track.album || "Unknown Album").trim().toLocaleLowerCase(),
].join("\u0000");

const findMultiDiscAlbums = (tracks) => {
  const discsByAlbum = new Map();
  const explicitlyMultiDisc = new Set();
  for (const track of tracks) {
    const key = albumGroupKey(track);
    const discNumber = Number(track.disc_number);
    if (Number(track.disc_total) > 1) explicitlyMultiDisc.add(key);
    if (Number.isFinite(discNumber) && discNumber > 0) {
      if (discNumber > 1) explicitlyMultiDisc.add(key);
      const discs = discsByAlbum.get(key) ?? new Set();
      discs.add(discNumber);
      discsByAlbum.set(key, discs);
    }
  }
  return new Set([
    ...explicitlyMultiDisc,
    ...[...discsByAlbum]
      .filter(([, discs]) => discs.size > 1)
      .map(([key]) => key),
  ]);
};

const sourceFileName = (track) => {
  const parsed = path.parse(String(track.source_path || ""));
  const baseName = sanitizeExportSegment(parsed.name || track.title, "Unknown Track");
  const extension = /^\.[a-z0-9]{1,12}$/i.test(parsed.ext) ? parsed.ext : "";
  return `${baseName}${extension}`;
};

const buildPlaylistFolderPaths = (folders) => {
  const folderById = new Map(folders.map((folder) => [String(folder.id), folder]));
  const relativePathById = new Map();
  const usedPaths = new Set();

  const resolveFolder = (folderId, ancestors = new Set()) => {
    if (relativePathById.has(folderId)) return relativePathById.get(folderId);
    const folder = folderById.get(folderId);
    if (!folder) return "";

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(folderId);
    const parentId = folder.parent_id == null ? null : String(folder.parent_id);
    const parentPath = parentId && !nextAncestors.has(parentId)
      ? resolveFolder(parentId, nextAncestors)
      : "";
    const segment = uniqueName(
      parentPath,
      sanitizeExportSegment(folder.name, "Playlist Folder"),
      usedPaths,
    );
    const relativePath = path.join(parentPath, segment);
    relativePathById.set(folderId, relativePath);
    return relativePath;
  };

  for (const folder of folders) resolveFolder(String(folder.id));
  return relativePathById;
};

const cleanPlaylistText = (value, fallback) =>
  String(value || fallback).replace(/[\r\n]+/g, " ").trim() || fallback;

const cleanXmlText = (value) => String(value ?? "")
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const appendPlistKey = (lines, level, key) => {
  lines.push(`${"  ".repeat(level)}<key>${cleanXmlText(key)}</key>`);
};

const appendPlistString = (lines, level, key, value) => {
  if (value == null || String(value).trim() === "") return;
  appendPlistKey(lines, level, key);
  lines.push(`${"  ".repeat(level)}<string>${cleanXmlText(value)}</string>`);
};

const appendPlistInteger = (lines, level, key, value, { minimum = 0 } = {}) => {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < minimum) return;
  appendPlistKey(lines, level, key);
  lines.push(`${"  ".repeat(level)}<integer>${parsed}</integer>`);
};

const appendPlistBoolean = (lines, level, key, value) => {
  appendPlistKey(lines, level, key);
  lines.push(`${"  ".repeat(level)}<${value ? "true" : "false"}/>`);
};

const plistDate = (value, epochSeconds = false) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  const date = epochSeconds && Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const appendPlistDate = (lines, level, key, value) => {
  if (!value) return;
  appendPlistKey(lines, level, key);
  lines.push(`${"  ".repeat(level)}<date>${value}</date>`);
};

const readJsonText = (value) => {
  if (value == null || value === "") return "";
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).join(", ");
    return parsed == null ? "" : String(parsed);
  } catch {
    return String(value);
  }
};

const persistentId = (kind, value) => crypto
  .createHash("sha256")
  .update(`${kind}:${String(value)}`)
  .digest("hex")
  .slice(0, 16)
  .toUpperCase();

const itunesFileUrl = (filePath, directory = false) => {
  const href = pathToFileURL(path.resolve(String(filePath))).href
    .replace(/^file:\/\/\//, "file://localhost/");
  return directory && !href.endsWith("/") ? `${href}/` : href;
};

const itunesKind = (filePath) => {
  switch (path.extname(String(filePath)).toLowerCase()) {
    case ".mp3": return "MPEG audio file";
    case ".m4a": return "Apple MPEG-4 audio file";
    case ".m4b": return "Protected MPEG-4 audio file";
    case ".aac": return "AAC audio file";
    case ".aif":
    case ".aiff": return "AIFF audio file";
    case ".wav": return "WAV audio file";
    case ".flac": return "FLAC audio file";
    case ".ogg": return "Ogg Vorbis audio file";
    case ".opus": return "Opus audio file";
    case ".wma": return "Windows Media audio file";
    default: return "Audio file";
  }
};

const commonMusicDirectory = (tracks) => {
  const directories = tracks
    .map((track) => path.dirname(path.resolve(String(track.source_path || ""))))
    .filter(Boolean);
  if (directories.length === 0) return null;

  let common = directories[0];
  const pathKey = (value) => process.platform === "win32"
    ? value.toLocaleLowerCase()
    : value;
  while (
    common
    && !directories.every((directory) => {
      const relative = path.relative(common, directory);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    })
  ) {
    const parent = path.dirname(common);
    if (pathKey(parent) === pathKey(common)) return path.parse(common).root;
    common = parent;
  }
  return common || path.parse(directories[0]).root;
};

/**
 * Write the library in the XML property-list shape produced by iTunes/Music.
 * Only metadata, source-file URLs, playlist folders, and playlist membership
 * are written. The source audio files are never copied or modified.
 */
export const exportItunesLibrary = async ({ dbPath, destinationPath }) => {
  const db = openDatabase(dbPath);
  const tracks = db.prepare(`
    SELECT id, title, artist, album_artist, album, genre_json, comment_json,
      year, track_number, track_total, disc_number, disc_total, bpm, rating,
      source_path, duration_seconds, bitrate_kbps, sample_rate_hz,
      file_size_bytes, added_at, updated_at, last_played_at, play_count,
      is_missing
    FROM tracks
    WHERE import_status != 'staged'
    ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE,
      COALESCE(disc_number, 1), COALESCE(track_number, 0), title COLLATE NOCASE
  `).all().map((track) => ({
    ...track,
    source_path: resolveTrackPath(dbPath, track.source_path),
  }));
  const folders = db.prepare(`
    SELECT id, name, parent_id, sort_order
    FROM playlist_folders
    ORDER BY parent_id, sort_order, name COLLATE NOCASE
  `).all();
  const playlists = db.prepare(`
    SELECT id, name, folder_id, sort_order
    FROM playlists
    ORDER BY folder_id, sort_order, name COLLATE NOCASE
  `).all();
  const playlistEntries = db.prepare(`
    SELECT playlist_id, track_id
    FROM playlist_tracks
    ORDER BY playlist_id, position
  `).all();

  const destination = path.resolve(String(destinationPath ?? ""));
  if (!destination.toLowerCase().endsWith(".xml")) {
    throw new Error("The iTunes-compatible export must use an .xml file");
  }

  const numericTrackIdByMuroId = new Map(
    tracks.map((track, index) => [String(track.id), index + 1]),
  );
  const entriesByPlaylistId = new Map();
  let playlistEntriesExported = 0;
  let playlistEntriesSkipped = 0;
  for (const entry of playlistEntries) {
    const trackId = numericTrackIdByMuroId.get(String(entry.track_id));
    if (!trackId) {
      playlistEntriesSkipped += 1;
      continue;
    }
    const playlistId = String(entry.playlist_id);
    const entries = entriesByPlaylistId.get(playlistId) ?? [];
    entries.push(trackId);
    entriesByPlaylistId.set(playlistId, entries);
    playlistEntriesExported += 1;
  }

  const libraryPersistentId = persistentId("library", path.resolve(dbPath));
  const folderPersistentIdById = new Map(
    folders.map((folder) => [String(folder.id), persistentId("playlist-folder", folder.id)]),
  );
  const lines = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
  ];
  appendPlistInteger(lines, 1, "Major Version", 1);
  appendPlistInteger(lines, 1, "Minor Version", 1);
  appendPlistDate(lines, 1, "Date", plistDate(new Date()));
  appendPlistString(lines, 1, "Application Version", "Muro Music");
  appendPlistInteger(lines, 1, "Features", 5);
  appendPlistString(lines, 1, "Library Persistent ID", libraryPersistentId);
  const musicDirectory = commonMusicDirectory(tracks);
  if (musicDirectory) {
    appendPlistString(lines, 1, "Music Folder", itunesFileUrl(musicDirectory, true));
  }

  appendPlistKey(lines, 1, "Tracks");
  lines.push("  <dict>");
  tracks.forEach((track, index) => {
    const numericTrackId = index + 1;
    appendPlistKey(lines, 2, numericTrackId);
    lines.push("    <dict>");
    appendPlistInteger(lines, 3, "Track ID", numericTrackId);
    appendPlistString(lines, 3, "Persistent ID", persistentId("track", track.id));
    appendPlistString(lines, 3, "Name", track.title || "Unknown Title");
    appendPlistString(lines, 3, "Artist", track.artist || "Unknown Artist");
    appendPlistString(lines, 3, "Album Artist", track.album_artist);
    appendPlistString(lines, 3, "Album", track.album || "Unknown Album");
    appendPlistString(lines, 3, "Genre", readJsonText(track.genre_json));
    appendPlistString(lines, 3, "Comments", readJsonText(track.comment_json));
    appendPlistString(lines, 3, "Kind", itunesKind(track.source_path));
    appendPlistInteger(lines, 3, "Size", track.file_size_bytes, { minimum: 1 });
    appendPlistInteger(lines, 3, "Total Time", Number(track.duration_seconds) * 1000, { minimum: 1 });
    appendPlistInteger(lines, 3, "Disc Number", track.disc_number, { minimum: 1 });
    appendPlistInteger(lines, 3, "Disc Count", track.disc_total, { minimum: 1 });
    appendPlistInteger(lines, 3, "Track Number", track.track_number, { minimum: 1 });
    appendPlistInteger(lines, 3, "Track Count", track.track_total, { minimum: 1 });
    appendPlistInteger(lines, 3, "Year", track.year, { minimum: 1 });
    appendPlistInteger(lines, 3, "BPM", track.bpm, { minimum: 1 });
    appendPlistInteger(lines, 3, "Bit Rate", track.bitrate_kbps, { minimum: 1 });
    appendPlistInteger(lines, 3, "Sample Rate", track.sample_rate_hz, { minimum: 1 });
    appendPlistInteger(
      lines,
      3,
      "Rating",
      Math.min(100, Math.max(0, Number(track.rating) * 20)),
      { minimum: 1 },
    );
    appendPlistInteger(lines, 3, "Play Count", track.play_count, { minimum: 1 });
    appendPlistDate(lines, 3, "Date Modified", plistDate(track.updated_at, true));
    appendPlistDate(lines, 3, "Date Added", plistDate(track.added_at, true));
    appendPlistDate(lines, 3, "Play Date UTC", plistDate(track.last_played_at));
    appendPlistString(lines, 3, "Track Type", "File");
    appendPlistString(lines, 3, "Location", itunesFileUrl(track.source_path));
    lines.push("    </dict>");
  });
  lines.push("  </dict>");

  appendPlistKey(lines, 1, "Playlists");
  lines.push("  <array>");
  lines.push("    <dict>");
  appendPlistString(lines, 3, "Name", "Library");
  appendPlistBoolean(lines, 3, "Master", true);
  appendPlistInteger(lines, 3, "Playlist ID", 1);
  appendPlistString(lines, 3, "Playlist Persistent ID", persistentId("master", libraryPersistentId));
  appendPlistBoolean(lines, 3, "Visible", false);
  appendPlistBoolean(lines, 3, "All Items", true);
  appendPlistKey(lines, 3, "Playlist Items");
  lines.push("      <array>");
  tracks.forEach((_track, index) => {
    lines.push("        <dict>");
    appendPlistInteger(lines, 5, "Track ID", index + 1);
    lines.push("        </dict>");
  });
  lines.push("      </array>");
  lines.push("    </dict>");

  let nextPlaylistId = 2;
  for (const folder of folders) {
    lines.push("    <dict>");
    appendPlistString(lines, 3, "Name", folder.name || "Playlist Folder");
    appendPlistInteger(lines, 3, "Playlist ID", nextPlaylistId++);
    appendPlistString(
      lines,
      3,
      "Playlist Persistent ID",
      folderPersistentIdById.get(String(folder.id)),
    );
    if (folder.parent_id != null) {
      appendPlistString(
        lines,
        3,
        "Parent Persistent ID",
        folderPersistentIdById.get(String(folder.parent_id)),
      );
    }
    appendPlistBoolean(lines, 3, "Folder", true);
    lines.push("    </dict>");
  }

  for (const playlist of playlists) {
    lines.push("    <dict>");
    appendPlistString(lines, 3, "Name", playlist.name || "Playlist");
    appendPlistInteger(lines, 3, "Playlist ID", nextPlaylistId++);
    appendPlistString(
      lines,
      3,
      "Playlist Persistent ID",
      persistentId("playlist", playlist.id),
    );
    if (playlist.folder_id != null) {
      appendPlistString(
        lines,
        3,
        "Parent Persistent ID",
        folderPersistentIdById.get(String(playlist.folder_id)),
      );
    }
    appendPlistBoolean(lines, 3, "All Items", true);
    appendPlistKey(lines, 3, "Playlist Items");
    lines.push("      <array>");
    for (const trackId of entriesByPlaylistId.get(String(playlist.id)) ?? []) {
      lines.push("        <dict>");
      appendPlistInteger(lines, 5, "Track ID", trackId);
      lines.push("        </dict>");
    }
    lines.push("      </array>");
    lines.push("    </dict>");
  }
  lines.push("  </array>", "</dict>", "</plist>", "");

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, lines.join("\n"), "utf8");
  return {
    destinationPath: destination,
    tracksExported: tracks.length,
    missingTracksReferenced: tracks.filter((track) => Number(track.is_missing) === 1).length,
    playlistFoldersExported: folders.length,
    playlistsExported: playlists.length,
    playlistEntriesExported,
    playlistEntriesSkipped,
  };
};

export const exportAllPlaylists = async ({ dbPath, destinationPath }) => {
  const db = openDatabase(dbPath);
  const folders = db.prepare(`
    SELECT id, name, parent_id, sort_order
    FROM playlist_folders
    ORDER BY parent_id, sort_order, name COLLATE NOCASE
  `).all();
  const playlists = db.prepare(`
    SELECT id, name, folder_id, sort_order
    FROM playlists
    ORDER BY folder_id, sort_order, name COLLATE NOCASE
  `).all();
  const playlistEntries = db.prepare(`
    SELECT pt.playlist_id, t.source_path, t.duration_seconds, t.artist, t.title
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    ORDER BY pt.playlist_id, pt.position
  `).all();

  const exportRoot = await createNamedExportRoot(destinationPath, "Muro Playlists");
  const folderPathById = buildPlaylistFolderPaths(folders);
  const entriesByPlaylistId = new Map();
  const usedPlaylistPaths = new Set();
  let playlistEntriesExported = 0;

  await Promise.all(
    [...folderPathById.values()].map((relativePath) =>
      fs.promises.mkdir(path.join(exportRoot, relativePath), { recursive: true })
    )
  );

  for (const entry of playlistEntries) {
    const playlistId = String(entry.playlist_id);
    const entries = entriesByPlaylistId.get(playlistId) ?? [];
    entries.push(entry);
    entriesByPlaylistId.set(playlistId, entries);
  }

  for (const playlist of playlists) {
    const folderId = playlist.folder_id == null ? null : String(playlist.folder_id);
    const relativeDirectory = folderId ? folderPathById.get(folderId) ?? "" : "";
    const playlistName = `${sanitizeExportSegment(playlist.name, "Playlist")}.m3u8`;
    const fileName = uniqueName(relativeDirectory, playlistName, usedPlaylistPaths);
    const playlistPath = path.join(exportRoot, relativeDirectory, fileName);
    const lines = ["#EXTM3U"];

    for (const entry of entriesByPlaylistId.get(String(playlist.id)) ?? []) {
      const duration = Math.max(-1, Math.round(Number(entry.duration_seconds) || -1));
      const artist = cleanPlaylistText(entry.artist, "Unknown Artist");
      const title = cleanPlaylistText(entry.title, "Unknown Title");
      lines.push(`#EXTINF:${duration},${artist} - ${title}`);
      lines.push(resolveTrackPath(dbPath, entry.source_path));
      playlistEntriesExported += 1;
    }

    await fs.promises.mkdir(path.dirname(playlistPath), { recursive: true });
    await fs.promises.writeFile(playlistPath, `${lines.join("\r\n")}\r\n`, "utf8");
  }

  return {
    exportRoot,
    playlistsExported: playlists.length,
    playlistEntriesExported,
  };
};

export const exportOrganizedLibrary = async ({
  dbPath,
  destinationPath,
  useAsCurrentLibrary = false,
  onProgress = () => {},
}) => {
  const db = openDatabase(dbPath);
  const tracks = db.prepare(`
    SELECT id, title, artist, album_artist, album, track_number,
      disc_number, disc_total, duration_seconds, source_path
    FROM tracks
    ORDER BY COALESCE(NULLIF(album_artist, ''), artist) COLLATE NOCASE,
      album COLLATE NOCASE, COALESCE(disc_number, 1), COALESCE(track_number, 0), title COLLATE NOCASE
  `).all();
  const folders = db.prepare(`
    SELECT id, name, parent_id, sort_order
    FROM playlist_folders
    ORDER BY parent_id, sort_order, name COLLATE NOCASE
  `).all();
  const playlists = db.prepare(`
    SELECT id, name, folder_id, sort_order
    FROM playlists
    ORDER BY folder_id, sort_order, name COLLATE NOCASE
  `).all();
  const playlistEntries = db.prepare(`
    SELECT playlist_id, track_id
    FROM playlist_tracks
    ORDER BY playlist_id, position
  `).all();

  const exportRoot = await createExportRoot(destinationPath);
  const multiDiscAlbums = findMultiDiscAlbums(tracks);
  const usedAudioPaths = new Set();
  const exportedPathByTrackId = new Map();
  const exportedPathBySource = new Map();
  const trackById = new Map(tracks.map((track) => [String(track.id), track]));
  const failures = [];
  let filesCopied = 0;

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const trackId = String(track.id);
    const sourcePath = resolveTrackPath(dbPath, track.source_path);
    const sourceKey = process.platform === "win32"
      ? sourcePath.toLocaleLowerCase()
      : sourcePath;
    const existingRelativePath = exportedPathBySource.get(sourceKey);

    if (existingRelativePath) {
      exportedPathByTrackId.set(trackId, existingRelativePath);
    } else {
      const artistFolder = sanitizeExportSegment(
        albumArtistOrArtist(track),
        "Unknown Artist",
      );
      const albumFolder = sanitizeExportSegment(track.album, "Unknown Album");
      const directorySegments = [artistFolder, albumFolder];
      if (multiDiscAlbums.has(albumGroupKey(track))) {
        const discNumber = Math.max(1, Number(track.disc_number) || 1);
        directorySegments.push(`Disc ${discNumber}`);
      }
      const relativeDirectory = path.join(...directorySegments);
      const fileName = uniqueName(
        relativeDirectory,
        sourceFileName(track),
        usedAudioPaths,
      );
      const relativePath = path.join(relativeDirectory, fileName);
      const outputPath = path.join(exportRoot, relativePath);

      try {
        const sourceStats = await fs.promises.stat(sourcePath);
        if (!sourceStats.isFile()) throw new Error("Source path is not a file");
        await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.promises.copyFile(sourcePath, outputPath, fs.constants.COPYFILE_EXCL);
        exportedPathByTrackId.set(trackId, relativePath);
        exportedPathBySource.set(sourceKey, relativePath);
        filesCopied += 1;
      } catch (error) {
        failures.push({
          trackId,
          sourcePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    onProgress({
      phase: "music",
      current: index + 1,
      total: tracks.length,
      name: cleanPlaylistText(track.title, "Unknown Track"),
    });
  }

  const entriesByPlaylistId = new Map();
  for (const entry of playlistEntries) {
    const playlistId = String(entry.playlist_id);
    const entries = entriesByPlaylistId.get(playlistId) ?? [];
    entries.push(String(entry.track_id));
    entriesByPlaylistId.set(playlistId, entries);
  }

  const playlistsRoot = path.join(exportRoot, "Playlists");
  await fs.promises.mkdir(playlistsRoot, { recursive: true });
  const folderPathById = buildPlaylistFolderPaths(folders);
  const usedPlaylistPaths = new Set();
  let playlistEntriesExported = 0;
  let playlistEntriesMissing = 0;

  for (let index = 0; index < playlists.length; index += 1) {
    const playlist = playlists[index];
    const folderId = playlist.folder_id == null ? null : String(playlist.folder_id);
    const relativeDirectory = folderId ? folderPathById.get(folderId) ?? "" : "";
    const playlistName = `${sanitizeExportSegment(playlist.name, "Playlist")}.m3u8`;
    const fileName = uniqueName(relativeDirectory, playlistName, usedPlaylistPaths);
    const playlistPath = path.join(playlistsRoot, relativeDirectory, fileName);
    const lines = ["#EXTM3U"];

    for (const trackId of entriesByPlaylistId.get(String(playlist.id)) ?? []) {
      const relativeTrackPath = exportedPathByTrackId.get(trackId);
      const track = trackById.get(trackId);
      if (!relativeTrackPath || !track) {
        playlistEntriesMissing += 1;
        continue;
      }
      const duration = Math.max(-1, Math.round(Number(track.duration_seconds) || -1));
      const artist = cleanPlaylistText(track.artist, "Unknown Artist");
      const title = cleanPlaylistText(track.title, "Unknown Title");
      const exportedTrackPath = path.join(exportRoot, relativeTrackPath);
      const playlistEntry = path.relative(path.dirname(playlistPath), exportedTrackPath)
        .split(path.sep)
        .join("/");
      lines.push(`#EXTINF:${duration},${artist} - ${title}`);
      lines.push(playlistEntry);
      playlistEntriesExported += 1;
    }

    await fs.promises.mkdir(path.dirname(playlistPath), { recursive: true });
    await fs.promises.writeFile(playlistPath, `${lines.join("\r\n")}\r\n`, "utf8");
    onProgress({
      phase: "playlists",
      current: index + 1,
      total: playlists.length,
      name: cleanPlaylistText(playlist.name, "Playlist"),
    });
  }

  let librarySwitched = false;
  let librarySwitchError = null;
  if (useAsCurrentLibrary) {
    if (failures.length > 0) {
      librarySwitchError = "Some music files could not be copied";
    } else {
      try {
        const updateSourcePath = db.prepare(`
          UPDATE tracks
          SET source_path = ?, filename = ?, is_missing = 0, updated_at = ?
          WHERE id = ?
        `);
        const now = Math.floor(Date.now() / 1000);
        db.transaction(() => {
          for (const track of tracks) {
            const trackId = String(track.id);
            const relativePath = exportedPathByTrackId.get(trackId);
            if (!relativePath) {
              throw new Error(`No exported file was recorded for track ${trackId}`);
            }
            const sourcePath = path.join(exportRoot, relativePath);
            updateSourcePath.run(
              storeTrackPath(dbPath, sourcePath, exportRoot),
              path.basename(sourcePath),
              now,
              trackId,
            );
            refreshSearchText(db, trackId);
          }
        })();
        configureLibraryRoot(dbPath, exportRoot);
        librarySwitched = true;
      } catch (error) {
        librarySwitchError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return {
    exportRoot,
    tracks: tracks.length,
    filesCopied,
    tracksFailed: failures.length,
    playlistsExported: playlists.length,
    playlistEntriesExported,
    playlistEntriesMissing,
    librarySwitchRequested: Boolean(useAsCurrentLibrary),
    librarySwitched,
    librarySwitchError,
    failures,
  };
};
