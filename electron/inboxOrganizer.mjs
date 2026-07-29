import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "./database.mjs";
import { sanitizeExportSegment } from "./libraryExport.mjs";

const normalizedPath = (value) => {
  const resolved = path.resolve(String(value ?? ""));
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
};

const pathsEqual = (left, right) => normalizedPath(left) === normalizedPath(right);

export const isPathInsideOrEqual = (candidatePath, folderPath) => {
  const relative = path.relative(path.resolve(folderPath), path.resolve(candidatePath));
  return relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
};

export const findContainingWatchedFolder = (sourcePath, watchedFolders) =>
  [...new Set(
    (Array.isArray(watchedFolders) ? watchedFolders : [])
      .map((folder) => String(folder ?? "").trim())
      .filter(Boolean)
      .map((folder) => path.resolve(folder)),
  )]
    .filter((folder) => isPathInsideOrEqual(sourcePath, folder))
    .sort((left, right) => right.length - left.length)[0] ?? null;

const sourceFileName = (track) => {
  const parsed = path.parse(String(track.source_path ?? ""));
  const baseName = sanitizeExportSegment(parsed.name || track.title, "Unknown Track");
  const extension = /^\.[a-z0-9]{1,12}$/i.test(parsed.ext) ? parsed.ext : "";
  return `${baseName}${extension}`;
};

export const acceptedTrackDestination = (track, watchedFolder) => {
  const artistFolder = sanitizeExportSegment(
    String(track.album_artist ?? "").trim()
      || String(track.artist ?? "").trim()
      || "Unknown Artist",
    "Unknown Artist",
  );
  const albumFolder = sanitizeExportSegment(track.album, "Unknown Album");
  return path.join(
    path.resolve(watchedFolder),
    artistFolder,
    albumFolder,
    sourceFileName(track),
  );
};

export const acceptedTrackRootDestination = (track, watchedFolder) => {
  const sourceName = path.basename(String(track.source_path ?? ""));
  return path.join(
    path.resolve(watchedFolder),
    sourceName || sourceFileName(track),
  );
};

const suffixedPath = (filePath, suffix) => {
  if (suffix === 1) return filePath;
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name} (${suffix})${parsed.ext}`);
};

const preserveCopiedFileMetadata = async (filePath, stats) => {
  await fs.promises.chmod(filePath, stats.mode).catch(() => {});
  await fs.promises.utimes(filePath, stats.atime, stats.mtime).catch(() => {});
};

/**
 * Moves a file without ever replacing an existing destination. Existing artist
 * and album directories are reused. A hard link is used on the same volume;
 * unsupported and cross-volume filesystems fall back to an exclusive copy.
 */
const moveWithoutOverwrite = async (sourcePath, requestedDestination) => {
  if (pathsEqual(sourcePath, requestedDestination)) return path.resolve(sourcePath);

  const stats = await fs.promises.stat(sourcePath);
  if (!stats.isFile()) throw new Error("Source path is not a file");
  await fs.promises.mkdir(path.dirname(requestedDestination), { recursive: true });

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const destinationPath = suffixedPath(requestedDestination, suffix);
    let createdByCopy = false;

    try {
      try {
        await fs.promises.link(sourcePath, destinationPath);
      } catch (error) {
        if (error?.code === "EEXIST") continue;
        if (!["EXDEV", "EPERM", "ENOSYS", "EOPNOTSUPP"].includes(error?.code)) {
          throw error;
        }
        try {
          await fs.promises.copyFile(
            sourcePath,
            destinationPath,
            fs.constants.COPYFILE_EXCL,
          );
          createdByCopy = true;
          await preserveCopiedFileMetadata(destinationPath, stats);
        } catch (copyError) {
          if (copyError?.code === "EEXIST") continue;
          throw copyError;
        }
      }

      try {
        await fs.promises.unlink(sourcePath);
      } catch (error) {
        await fs.promises.unlink(destinationPath).catch(() => {});
        throw error;
      }

      return destinationPath;
    } catch (error) {
      if (createdByCopy) {
        await fs.promises.unlink(destinationPath).catch(() => {});
      }
      throw error;
    }
  }

  throw new Error("Could not find an available destination filename");
};

export const acceptInboxTracks = async ({
  dbPath,
  trackIds,
  organize = false,
  watchedFolders = [],
}) => {
  const ids = [...new Set(
    (Array.isArray(trackIds) ? trackIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean),
  )];
  if (ids.length === 0) return { accepted: 0, moved: [], failures: [] };

  const db = openDatabase(dbPath);
  const placeholders = ids.map(() => "?").join(", ");
  const tracks = db.prepare(`
    SELECT id, title, artist, album_artist, album, filename, source_path,
      move_to_watched_folder_on_accept
    FROM tracks
    WHERE id IN (${placeholders})
  `).all(...ids);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE tracks
    SET import_status = 'accepted', updated_at = ?
    WHERE id IN (${placeholders})
  `).run(now, ...ids);

  const moved = [];
  const failures = [];
  const hasOutsideFolderImports = tracks.some(
    (track) => Number(track.move_to_watched_folder_on_accept) === 1,
  );
  if (!organize && !hasOutsideFolderImports) {
    return { accepted: tracks.length, moved, failures };
  }

  const watchedFolder = (Array.isArray(watchedFolders) ? watchedFolders : [])
    .map((folder) => String(folder ?? "").trim())
    .filter(Boolean)
    .map((folder) => path.resolve(folder))[0] ?? null;
  let watchedFolderAvailable = false;
  if (watchedFolder) {
    try {
      watchedFolderAvailable = (await fs.promises.stat(watchedFolder)).isDirectory();
    } catch {
      watchedFolderAvailable = false;
    }
  }

  const updatePath = db.prepare(`
    UPDATE tracks
    SET source_path = ?, filename = ?, is_missing = 0,
      move_to_watched_folder_on_accept = 0, updated_at = ?
    WHERE id = ?
  `);
  const clearMoveOnAccept = db.prepare(`
    UPDATE tracks
    SET move_to_watched_folder_on_accept = 0, updated_at = ?
    WHERE id = ?
  `);

  for (const track of tracks) {
    const sourcePath = path.resolve(String(track.source_path ?? ""));
    const moveToWatchedFolder = Number(track.move_to_watched_folder_on_accept) === 1;
    const containingWatchedFolder = findContainingWatchedFolder(sourcePath, watchedFolders);

    let requestedDestination;
    if (moveToWatchedFolder) {
      if (!watchedFolder || !watchedFolderAvailable) {
        failures.push({
          trackId: String(track.id),
          sourcePath,
          message: watchedFolder
            ? "The watched folder is unavailable"
            : "No watched folder is configured",
        });
        continue;
      }
      requestedDestination = organize
        ? acceptedTrackDestination(track, watchedFolder)
        : acceptedTrackRootDestination(track, watchedFolder);
    } else {
      if (!organize || !containingWatchedFolder) continue;
      requestedDestination = acceptedTrackDestination(track, containingWatchedFolder);
    }

    if (pathsEqual(sourcePath, requestedDestination)) {
      if (moveToWatchedFolder) clearMoveOnAccept.run(now, track.id);
      continue;
    }

    let destinationPath = null;
    try {
      destinationPath = await moveWithoutOverwrite(sourcePath, requestedDestination);
      updatePath.run(destinationPath, path.basename(destinationPath), now, track.id);
      moved.push({
        trackId: String(track.id),
        sourcePath: destinationPath,
        filename: path.basename(destinationPath),
      });
    } catch (error) {
      if (destinationPath) {
        try {
          await moveWithoutOverwrite(destinationPath, sourcePath);
        } catch {
          // Library verification can reconnect the rare case where both the
          // database update and filesystem rollback fail.
        }
      }
      failures.push({
        trackId: String(track.id),
        sourcePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { accepted: tracks.length, moved, failures };
};
