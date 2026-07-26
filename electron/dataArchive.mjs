import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { capturePlaylistState } from "./history.mjs";
import { closeDatabase, openDatabase } from "./database.mjs";

const ARCHIVE_FORMAT = "muro-library-backup";
const ARCHIVE_VERSION = 1;
const MAX_SETTINGS_BYTES = 10 * 1024 * 1024;

const safeJson = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const archiveNameForFile = (filePath) => {
  const hash = crypto.createHash("sha256").update(filePath).digest("hex");
  const extension = path.extname(filePath).slice(0, 12);
  return `artwork/files/${hash}${extension}`;
};

const collectArtworkPaths = (db) => {
  const paths = new Set();
  const add = (candidate) => {
    if (typeof candidate !== "string" || !candidate.trim()) return;
    const resolved = path.resolve(candidate);
    try {
      if (fs.statSync(resolved).isFile()) paths.add(resolved);
    } catch {
      // Missing cached artwork is omitted; the database selection remains intact.
    }
  };

  for (const row of db.prepare(
    "SELECT cover_art_path, cover_art_thumb_path FROM tracks",
  ).all()) {
    add(row.cover_art_path);
    add(row.cover_art_thumb_path);
  }
  for (const row of db.prepare(
    "SELECT full_path, thumb_path FROM album_cover_cache",
  ).all()) {
    add(row.full_path);
    add(row.thumb_path);
  }
  for (const row of db.prepare("SELECT profile_json FROM artist_profiles").all()) {
    const profile = safeJson(row.profile_json, {});
    add(profile?.imagePath);
  }
  return [...paths];
};

const countLibrary = (db) => ({
  tracks: Number(db.prepare("SELECT COUNT(*) AS count FROM tracks").get().count) || 0,
  playlists: Number(db.prepare("SELECT COUNT(*) AS count FROM playlists").get().count) || 0,
  playlistFolders: Number(
    db.prepare("SELECT COUNT(*) AS count FROM playlist_folders").get().count,
  ) || 0,
  playlistEntries: Number(
    db.prepare("SELECT COUNT(*) AS count FROM playlist_tracks").get().count,
  ) || 0,
});

const validateSettings = (settingsJson) => {
  const normalized = typeof settingsJson === "string" ? settingsJson : "";
  if (Buffer.byteLength(normalized, "utf8") > MAX_SETTINGS_BYTES) {
    throw new Error("The settings payload is too large");
  }
  if (normalized && safeJson(normalized) == null) {
    throw new Error("The settings payload is not valid JSON");
  }
  return normalized;
};

export const createLibraryBackup = async ({
  dbPath,
  destinationPath,
  settingsJson,
}) => {
  const resolvedDbPath = path.resolve(dbPath);
  const resolvedDestination = path.resolve(destinationPath);
  const db = openDatabase(resolvedDbPath);
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "muro-backup-"));
  const snapshotPath = path.join(tempDir, "muro.db");

  try {
    await db.backup(snapshotPath);
    const artworkPaths = collectArtworkPaths(db);
    const artworkIndex = [];
    const archiveEntries = {
      "database/muro.db": new Uint8Array(await fs.promises.readFile(snapshotPath)),
      "playlists/playlists.json": strToU8(
        JSON.stringify(capturePlaylistState(db), null, 2),
      ),
      "settings/muro-settings.json": strToU8(validateSettings(settingsJson)),
    };

    for (const artworkPath of artworkPaths) {
      const archivePath = archiveNameForFile(artworkPath);
      archiveEntries[archivePath] = new Uint8Array(
        await fs.promises.readFile(artworkPath),
      );
      artworkIndex.push({ originalPath: artworkPath, archivePath });
    }
    archiveEntries["artwork/index.json"] = strToU8(
      JSON.stringify(artworkIndex, null, 2),
    );

    const manifest = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      backupId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      app: "Muro Music",
      databaseFile: "database/muro.db",
      settingsFile: "settings/muro-settings.json",
      playlistFile: "playlists/playlists.json",
      artworkIndexFile: "artwork/index.json",
      counts: {
        ...countLibrary(db),
        artworkFiles: artworkIndex.length,
      },
    };
    archiveEntries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

    await fs.promises.mkdir(path.dirname(resolvedDestination), { recursive: true });
    await fs.promises.writeFile(
      resolvedDestination,
      Buffer.from(zipSync(archiveEntries, { level: 6 })),
    );
    return {
      destinationPath: resolvedDestination,
      manifest,
      bytes: (await fs.promises.stat(resolvedDestination)).size,
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
};

const requireArchiveEntry = (entries, name) => {
  const entry = entries[name];
  if (!entry) throw new Error(`Backup is missing ${name}`);
  return entry;
};

const replaceArtworkStrings = (value, artworkMap) => {
  if (typeof value === "string") return artworkMap.get(path.resolve(value)) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceArtworkStrings(item, artworkMap));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, replaceArtworkStrings(item, artworkMap)]),
  );
};

const restoreArtworkReferences = (db, artworkMap) => {
  const updateTrack = db.prepare(`
    UPDATE tracks SET cover_art_path = ?, cover_art_thumb_path = ? WHERE id = ?
  `);
  for (const row of db.prepare(
    "SELECT id, cover_art_path, cover_art_thumb_path FROM tracks",
  ).all()) {
    updateTrack.run(
      row.cover_art_path ? artworkMap.get(path.resolve(row.cover_art_path)) ?? row.cover_art_path : null,
      row.cover_art_thumb_path
        ? artworkMap.get(path.resolve(row.cover_art_thumb_path)) ?? row.cover_art_thumb_path
        : null,
      row.id,
    );
  }

  const updateAlbum = db.prepare(`
    UPDATE album_cover_cache SET full_path = ?, thumb_path = ? WHERE cover_key = ?
  `);
  for (const row of db.prepare(
    "SELECT cover_key, full_path, thumb_path FROM album_cover_cache",
  ).all()) {
    updateAlbum.run(
      row.full_path ? artworkMap.get(path.resolve(row.full_path)) ?? row.full_path : null,
      row.thumb_path ? artworkMap.get(path.resolve(row.thumb_path)) ?? row.thumb_path : null,
      row.cover_key,
    );
  }

  const updateArtist = db.prepare(
    "UPDATE artist_profiles SET profile_json = ? WHERE artist_key = ?",
  );
  for (const row of db.prepare(
    "SELECT artist_key, profile_json FROM artist_profiles",
  ).all()) {
    const profile = safeJson(row.profile_json);
    if (profile) {
      updateArtist.run(
        JSON.stringify(replaceArtworkStrings(profile, artworkMap)),
        row.artist_key,
      );
    }
  }
};

export const restoreLibraryBackup = async ({
  dbPath,
  archivePath,
  artworkRoot,
}) => {
  const resolvedDbPath = path.resolve(dbPath);
  const resolvedArchivePath = path.resolve(archivePath);
  const entries = unzipSync(new Uint8Array(await fs.promises.readFile(resolvedArchivePath)));
  const manifest = safeJson(strFromU8(requireArchiveEntry(entries, "manifest.json")));
  if (
    manifest?.format !== ARCHIVE_FORMAT
    || Number(manifest?.version) !== ARCHIVE_VERSION
    || typeof manifest?.backupId !== "string"
  ) {
    throw new Error("This is not a supported Muro library backup");
  }

  const databaseBytes = requireArchiveEntry(entries, "database/muro.db");
  const settingsJson = entries["settings/muro-settings.json"]
    ? strFromU8(entries["settings/muro-settings.json"])
    : "";
  validateSettings(settingsJson);

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "muro-restore-"));
  const restoredDbPath = path.join(tempDir, "muro.db");
  const recoveryPath = `${resolvedDbPath}.before-restore-${Date.now()}.bak`;
  let originalMoved = false;

  try {
    await fs.promises.writeFile(restoredDbPath, Buffer.from(databaseBytes));
    const validationDb = new Database(restoredDbPath, { readonly: true });
    try {
      const integrity = validationDb.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") throw new Error(`Backup database integrity check failed: ${integrity}`);
    } finally {
      validationDb.close();
    }

    const artworkIndex = safeJson(
      entries["artwork/index.json"] ? strFromU8(entries["artwork/index.json"]) : "[]",
      [],
    );
    const restoreRoot = path.resolve(
      artworkRoot,
      "restored-artwork",
      manifest.backupId,
    );
    const artworkMap = new Map();
    for (const [index, item] of (Array.isArray(artworkIndex) ? artworkIndex : []).entries()) {
      if (
        typeof item?.originalPath !== "string"
        || typeof item?.archivePath !== "string"
        || !item.archivePath.startsWith("artwork/files/")
      ) continue;
      const bytes = entries[item.archivePath];
      if (!bytes) continue;
      const extension = path.extname(item.archivePath).slice(0, 12);
      const restoredPath = path.join(restoreRoot, `${String(index).padStart(5, "0")}${extension}`);
      await fs.promises.mkdir(path.dirname(restoredPath), { recursive: true });
      await fs.promises.writeFile(restoredPath, Buffer.from(bytes));
      artworkMap.set(path.resolve(item.originalPath), restoredPath);
    }

    closeDatabase(resolvedDbPath);
    await fs.promises.rm(`${resolvedDbPath}-wal`, { force: true });
    await fs.promises.rm(`${resolvedDbPath}-shm`, { force: true });
    if (fs.existsSync(resolvedDbPath)) {
      await fs.promises.rename(resolvedDbPath, recoveryPath);
      originalMoved = true;
    }
    await fs.promises.rename(restoredDbPath, resolvedDbPath);

    const restoredDb = openDatabase(resolvedDbPath);
    restoredDb.transaction(() => restoreArtworkReferences(restoredDb, artworkMap))();
    return {
      archivePath: resolvedArchivePath,
      recoveryPath: originalMoved ? recoveryPath : null,
      settingsJson,
      manifest,
      restoredArtworkFiles: artworkMap.size,
    };
  } catch (error) {
    if (originalMoved && fs.existsSync(recoveryPath)) {
      closeDatabase(resolvedDbPath);
      await fs.promises.rm(resolvedDbPath, { force: true });
      await fs.promises.rename(recoveryPath, resolvedDbPath);
    }
    throw error;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
};
