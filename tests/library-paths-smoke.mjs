import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabases,
  configureLibraryRoot,
  loadPlaylists,
  loadTracks,
  openDatabase,
} from "../electron/database.mjs";
import {
  isAbsoluteTrackPath,
  normalizePortableTrackPath,
  resolveStoredTrackPath,
  toStoredTrackPath,
} from "../electron/libraryPaths.mjs";

assert.equal(
  normalizePortableTrackPath("Artist\\Album\\song.flac"),
  "Artist/Album/song.flac",
  "portable paths always use forward slashes",
);
assert.equal(normalizePortableTrackPath("../outside.mp3"), null);
assert.equal(normalizePortableTrackPath("/absolute/song.mp3"), null);
assert.equal(normalizePortableTrackPath("C:\\Music\\song.mp3"), null);
assert.equal(isAbsoluteTrackPath("D:/Music/song.mp3"), true);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-library-paths-"));
const firstRoot = path.join(temporaryDirectory, "First Library");
const secondRoot = path.join(temporaryDirectory, "Second Library");
const relativePath = "Artist/Album/song.flac";
const firstSource = path.join(firstRoot, ...relativePath.split("/"));
const secondSource = path.join(secondRoot, ...relativePath.split("/"));
const outsideSource = path.join(temporaryDirectory, "outside.mp3");
const playlistSource = path.join(firstRoot, "Playlists", "Portable Mix.m3u8");
const dbPath = path.join(temporaryDirectory, "muro.db");

fs.mkdirSync(path.dirname(firstSource), { recursive: true });
fs.mkdirSync(path.dirname(secondSource), { recursive: true });
fs.mkdirSync(path.dirname(playlistSource), { recursive: true });
fs.writeFileSync(firstSource, "first");
fs.writeFileSync(secondSource, "second");
fs.writeFileSync(outsideSource, "outside");
fs.writeFileSync(playlistSource, "#EXTM3U\r\n../Artist/Album/song.flac\r\n");

try {
  const db = openDatabase(dbPath);
  db.prepare(`
    INSERT INTO tracks(
      id, title, artist, album, filename, source_path, import_status, added_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', 1, 1)
  `).run("inside", "Inside", "Artist", "Album", "song.flac", firstSource);
  db.prepare(`
    INSERT INTO tracks(
      id, title, artist, album, filename, source_path, import_status, added_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', 1, 1)
  `).run("outside", "Outside", "Artist", "Album", "outside.mp3", outsideSource);
  db.prepare(`
    INSERT INTO playlists(id, name, sort_order, source_path, created_at)
    VALUES ('portable-playlist', 'Portable Mix', 0, ?, 1)
  `).run(playlistSource);

  const configured = configureLibraryRoot(dbPath, firstRoot);
  assert.equal(configured.libraryRoot, firstRoot);
  assert.equal(
    db.prepare("SELECT source_path FROM tracks WHERE id = 'inside'").get().source_path,
    relativePath,
  );
  assert.equal(
    db.prepare("SELECT source_path FROM tracks WHERE id = 'outside'").get().source_path,
    outsideSource,
    "files outside the root retain their legacy absolute path",
  );
  assert.equal(
    db.prepare("SELECT source_path FROM playlists WHERE id = 'portable-playlist'").get().source_path,
    "Playlists/Portable Mix.m3u8",
  );
  assert.equal(
    loadTracks(dbPath).library.find((track) => track.id === "inside")?.source_path,
    firstSource,
  );
  assert.equal(
    loadPlaylists(dbPath).playlists[0].source_path,
    playlistSource,
  );

  configureLibraryRoot(dbPath, secondRoot);
  assert.equal(
    db.prepare("SELECT source_path FROM tracks WHERE id = 'inside'").get().source_path,
    relativePath,
    "changing computers only changes the root, not every track row",
  );
  assert.equal(
    loadTracks(dbPath).library.find((track) => track.id === "inside")?.source_path,
    secondSource,
  );
  assert.equal(
    toStoredTrackPath(secondSource, secondRoot),
    relativePath,
  );
  assert.equal(
    resolveStoredTrackPath(relativePath, secondRoot),
    secondSource,
  );
} finally {
  closeDatabases();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("library-paths-smoke: all assertions passed");
