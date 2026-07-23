import fs from "node:fs";
import path from "node:path";
import { openDatabase, refreshSearchText } from "./database.mjs";

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

const createExportRoot = async (destinationPath) => {
  const destination = path.resolve(String(destinationPath ?? ""));
  const stats = await fs.promises.stat(destination);
  if (!stats.isDirectory()) throw new Error("The export destination is not a directory");

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const name = suffix === 1 ? "Muro Library" : `Muro Library (${suffix})`;
    const exportRoot = path.join(destination, name);
    try {
      await fs.promises.mkdir(exportRoot);
      return exportRoot;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not create a unique Muro Library export folder");
};

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
    const sourcePath = path.resolve(String(track.source_path || ""));
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
            updateSourcePath.run(sourcePath, path.basename(sourcePath), now, trackId);
            refreshSearchText(db, trackId);
          }
        })();
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
