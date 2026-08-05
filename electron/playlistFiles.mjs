import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, resolveTrackPath } from "./database.mjs";
import { AUDIO_EXTENSIONS } from "./metadata.mjs";

export const PLAYLIST_EXTENSIONS = new Set([".m3u", ".m3u8", ".pls"]);

export const normalizePlaylistPath = (value) => {
  const resolved = path.resolve(String(value || ""));
  const normalized = path.normalize(resolved);
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
};

export const listPlaylistFilesForImport = async (directoryPath) => {
  const root = path.resolve(String(directoryPath || ""));
  const rootStats = await fs.promises.stat(root);
  if (!rootStats.isDirectory()) throw new Error("Playlist import path is not a directory");

  const files = [];
  let audioFileCount = 0;
  const visit = async (directory) => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (PLAYLIST_EXTENSIONS.has(extension)) files.push(entryPath);
        if (AUDIO_EXTENSIONS.has(extension)) audioFileCount += 1;
      }
    }
  };

  await visit(root);
  files.sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));
  const entries = files.map((filePath) => {
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    const directory = path.posix.dirname(relativePath);
    return {
      path: filePath,
      relativePath,
      folderPath: directory === "." ? null : directory,
    };
  });
  const folderPaths = new Set();
  for (const entry of entries) {
    if (!entry.folderPath) continue;
    const segments = entry.folderPath.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      folderPaths.add(segments.slice(0, index).join("/"));
    }
  }
  return {
    name: path.basename(root) || root,
    audioFileCount,
    files,
    entries,
    folders: [...folderPaths]
      .sort((a, b) => (
        a.split("/").length - b.split("/").length || a.localeCompare(b)
      ))
      .map((folderPath) => {
        const segments = folderPath.split("/");
        return {
          path: folderPath,
          name: segments.at(-1),
          parentPath: segments.length > 1 ? segments.slice(0, -1).join("/") : null,
        };
      }),
  };
};

const resolvePlaylistEntry = (entry, playlistDirectory) => {
  const trimmed = String(entry || "").trim().replace(/^"|"$/g, "");
  if (!trimmed) return null;
  try {
    if (/^file:/i.test(trimmed)) return fileURLToPath(trimmed);
  } catch {
    return null;
  }
  return path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(playlistDirectory, trimmed);
};

export const parsePlaylistFile = async (filePath) => {
  const resolvedPath = path.resolve(String(filePath || ""));
  if (!PLAYLIST_EXTENSIONS.has(path.extname(resolvedPath).toLocaleLowerCase())) {
    throw new Error("Unsupported playlist format");
  }
  const buffer = await fs.promises.readFile(resolvedPath);
  const text = buffer[0] === 0xff && buffer[1] === 0xfe
    ? buffer.subarray(2).toString("utf16le")
    : buffer.toString("utf8").replace(/^\uFEFF/, "");
  const extension = path.extname(resolvedPath).toLocaleLowerCase();
  const lines = text.split(/\r?\n/);
  const rawEntries = extension === ".pls"
    ? lines
        .map((line) => /^File\d+=(.*)$/i.exec(line.trim())?.[1])
        .filter(Boolean)
    : lines
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
  const directory = path.dirname(resolvedPath);
  return rawEntries
    .map((entry) => resolvePlaylistEntry(entry, directory))
    .filter(Boolean);
};

export const readPlaylistForImport = async (dbPath, filePath) => {
  const resolvedPath = path.resolve(String(filePath || ""));
  const entries = await parsePlaylistFile(resolvedPath);
  const rows = openDatabase(dbPath)
    .prepare("SELECT id, source_path FROM tracks")
    .all();
  const trackIdByPath = new Map(
    rows.flatMap((row) => {
      try {
        return [[
          normalizePlaylistPath(resolveTrackPath(dbPath, row.source_path)),
          String(row.id),
        ]];
      } catch {
        return [];
      }
    }),
  );
  return {
    name: path.basename(resolvedPath, path.extname(resolvedPath)),
    source_path: resolvedPath,
    entries: entries.map((entry) => ({
      path: entry,
      track_id: trackIdByPath.get(normalizePlaylistPath(entry)) ?? null,
      exists: fs.existsSync(entry),
    })),
  };
};
