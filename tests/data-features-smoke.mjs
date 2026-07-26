import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackend } from "../electron/backend.mjs";
import { openDatabase } from "../electron/database.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "muro-data-features-"));
const dbPath = path.join(root, "muro.db");
const covers = path.join(root, "covers");
const sourcePath = path.join(root, "track.mp3");
const artworkPath = path.join(covers, "cover.jpg");
const backupPath = path.join(root, "library.murobackup");
fs.mkdirSync(covers, { recursive: true });
const mp3Frames = [];
for (let index = 0; index < 12; index += 1) {
  const frame = Buffer.alloc(417);
  Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(frame);
  mp3Frames.push(frame);
}
fs.writeFileSync(sourcePath, Buffer.concat(mp3Frames));
fs.writeFileSync(artworkPath, "artwork");

const backend = createBackend({
  cacheDir: covers,
  emit: () => {},
  keyFinder: {
    close: () => {},
  },
});

try {
  const db = openDatabase(dbPath);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO tracks(
      id, title, artist, album, filename, source_path, import_status,
      duration_seconds, added_at, updated_at, cover_art_path
    ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', 240, ?, ?, ?)
  `).run(
    "track-1",
    "Original title",
    "Test artist",
    "Test album",
    "track.mp3",
    sourcePath,
    now,
    now,
    artworkPath,
  );

  await backend.invoke("create_playlist", {
    dbPath,
    id: "playlist-1",
    name: "First playlist",
  });
  await backend.invoke("add_tracks_to_playlist", {
    dbPath,
    playlistId: "playlist-1",
    trackIds: ["track-1"],
  });
  await backend.invoke("create_playlist_snapshot", {
    dbPath,
    name: "Before rename",
  });
  await backend.invoke("update_playlist", {
    dbPath,
    playlistId: "playlist-1",
    name: "Renamed playlist",
  });
  let playlistHistory = await backend.invoke("list_playlist_history", { dbPath });
  assert.equal(playlistHistory.canUndo, true);
  await backend.invoke("undo_playlist_history", { dbPath });
  assert.equal(
    openDatabase(dbPath).prepare("SELECT name FROM playlists WHERE id = ?").get("playlist-1").name,
    "First playlist",
  );
  await backend.invoke("redo_playlist_history", { dbPath });
  assert.equal(
    openDatabase(dbPath).prepare("SELECT name FROM playlists WHERE id = ?").get("playlist-1").name,
    "Renamed playlist",
  );
  assert.equal((await backend.invoke("list_playlist_snapshots", { dbPath })).length, 1);

  assert.deepEqual(await backend.invoke("update_track_metadata", {
    dbPath,
    trackIds: ["track-1"],
    updates: { title: "Edited title", rating: 4 },
  }), {
    updated: 1,
    filesWritten: 1,
    fileWriteErrors: [],
  });
  const metadataHistory = await backend.invoke("list_metadata_history", {
    dbPath,
    trackId: "track-1",
  });
  assert.deepEqual(Object.keys(metadataHistory[0].changes).sort(), ["rating", "title"]);
  await backend.invoke("rollback_metadata_change", {
    dbPath,
    historyId: metadataHistory[0].id,
    field: "title",
  });
  assert.equal(
    openDatabase(dbPath).prepare("SELECT title, rating FROM tracks WHERE id = ?").get("track-1").title,
    "Original title",
  );

  const play = await backend.invoke("record_track_play", { dbPath, trackId: "track-1" });
  await backend.invoke("update_play_history", {
    dbPath,
    historyId: play.historyId,
    listenedSeconds: 125,
  });
  const statistics = await backend.invoke("load_listening_statistics", { dbPath });
  assert.equal(statistics.plays, 1);
  assert.equal(statistics.listeningSeconds, 125);
  assert.equal(statistics.topArtists[0].name, "Test artist");
  assert.equal(statistics.monthly.length, 12);

  const backup = await backend.invoke("create_library_backup", {
    dbPath,
    destinationPath: backupPath,
    settingsJson: JSON.stringify({ state: { theme: "dark" }, version: 3 }),
  });
  assert.equal(backup.manifest.counts.playlists, 1);
  assert.equal(backup.manifest.counts.artworkFiles, 1);
  assert.ok(fs.statSync(backupPath).size > 0);

  openDatabase(dbPath).prepare("DELETE FROM playlists").run();
  openDatabase(dbPath).prepare("UPDATE tracks SET title = 'After backup'").run();
  const restored = await backend.invoke("restore_library_backup", {
    dbPath,
    archivePath: backupPath,
  });
  assert.ok(restored.recoveryPath && fs.existsSync(restored.recoveryPath));
  const restoredDb = openDatabase(dbPath);
  assert.equal(restoredDb.prepare("SELECT COUNT(*) AS count FROM playlists").get().count, 1);
  assert.equal(
    restoredDb.prepare("SELECT title FROM tracks WHERE id = ?").get("track-1").title,
    "Original title",
  );
  const restoredArtwork = restoredDb.prepare(
    "SELECT cover_art_path FROM tracks WHERE id = ?",
  ).get("track-1").cover_art_path;
  assert.ok(fs.existsSync(restoredArtwork));
  assert.match(restored.settingsJson, /"theme":"dark"/);

  playlistHistory = await backend.invoke("list_playlist_history", { dbPath });
  assert.ok(playlistHistory.entries.length >= 2);
  console.log("Data features smoke test passed");
} finally {
  backend.close();
  fs.rmSync(root, { recursive: true, force: true });
}
