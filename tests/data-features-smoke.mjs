import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { strFromU8, unzipSync } from "fflate";
import { createBackend } from "../electron/backend.mjs";
import { loadArtistCredits, loadTracks, openDatabase } from "../electron/database.mjs";

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
  await backend.invoke("load_tracks", { dbPath, libraryRoot: root });
  assert.equal(
    db.prepare("SELECT source_path FROM tracks WHERE id = 'track-1'").get().source_path,
    "track.mp3",
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

  const structuredArtistCredits = [{
    name: "Artist One",
    creditedName: "Artist One",
    joinPhrase: " feat. ",
    musicBrainzId: "11111111-1111-4111-8111-111111111111",
  }, {
    name: "Guest Artist",
    creditedName: "Guest Alias",
    joinPhrase: "",
    musicBrainzId: "22222222-2222-4222-8222-222222222222",
  }];
  await backend.invoke("update_track_metadata", {
    dbPath,
    trackIds: ["track-1"],
    updates: {
      artist: "Artist One feat. Guest Alias",
      artistCredits: structuredArtistCredits,
    },
  });
  let persistedArtistCredits = loadArtistCredits(db, ["track-1"]).get("track-1").artist_credits;
  assert.equal(
    persistedArtistCredits.map((credit) => credit.creditedName + credit.joinPhrase).join(""),
    "Artist One feat. Guest Alias",
  );
  assert.deepEqual(
    persistedArtistCredits.map((credit) => credit.name),
    ["Artist One", "Guest Artist"],
  );
  const artistHistory = (await backend.invoke("list_metadata_history", {
    dbPath,
    trackId: "track-1",
  })).find((entry) => Object.hasOwn(entry.changes, "artist"));
  assert.ok(artistHistory);
  assert.equal(artistHistory.changes.artist.before, "Test artist");
  assert.equal(artistHistory.changes.artist.beforeCredits.length, 1);
  await backend.invoke("rollback_metadata_change", {
    dbPath,
    historyId: artistHistory.id,
    field: "artist",
  });
  assert.equal(
    db.prepare("SELECT artist FROM tracks WHERE id = ?").get("track-1").artist,
    "Test artist",
  );
  persistedArtistCredits = loadArtistCredits(db, ["track-1"]).get("track-1").artist_credits;
  assert.equal(persistedArtistCredits.length, 1);
  assert.equal(persistedArtistCredits[0].creditedName, "Test artist");

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
    settingsJson: JSON.stringify({
      state: {
        theme: "dark",
        braveSearchApiKey: "must-not-leave-this-device",
        watchedFolders: [root],
      },
      version: 4,
    }),
    smartCratesJson: JSON.stringify({
      state: {
        smartCrates: [{
          id: "crate-1",
          name: "Backup crate",
          match: "all",
          rules: [{ id: "rule-1", field: "bpm", operator: "gte", value: 120 }],
        }],
      },
      version: 0,
    }),
  });
  assert.equal(backup.manifest.version, 3);
  assert.equal(backup.manifest.counts.playlists, 1);
  assert.equal(backup.manifest.counts.artworkFiles, 1);
  assert.equal(backup.manifest.counts.smartCrates, 1);
  assert.ok(fs.statSync(backupPath).size > 0);
  const archiveEntries = unzipSync(new Uint8Array(fs.readFileSync(backupPath)));
  const archivedSettings = strFromU8(archiveEntries["settings/muro-settings.json"]);
  assert.doesNotMatch(archivedSettings, /must-not-leave-this-device/);
  assert.doesNotMatch(archivedSettings, /braveSearchApiKey/);
  assert.doesNotMatch(archivedSettings, /watchedFolders/);
  const archivedDbPath = path.join(root, "archived.db");
  fs.writeFileSync(archivedDbPath, Buffer.from(archiveEntries["database/muro.db"]));
  const archivedDb = new Database(archivedDbPath, { readonly: true });
  try {
    assert.equal(
      archivedDb.prepare(
        "SELECT value FROM app_metadata WHERE key = 'library_root'",
      ).get(),
      undefined,
      "a portable backup does not contain the source computer's root prefix",
    );
  } finally {
    archivedDb.close();
  }
  const archivedTrack = loadTracks(archivedDbPath).library[0];
  assert.equal(archivedTrack.source_path, "track.mp3");
  assert.equal(
    archivedTrack.is_missing,
    1,
    "portable paths remain unavailable until the destination chooses its root",
  );
  assert.match(
    strFromU8(archiveEntries["settings/muro-smart-crates.json"]),
    /Backup crate/,
  );

  openDatabase(dbPath).prepare("DELETE FROM playlists").run();
  openDatabase(dbPath).prepare("UPDATE tracks SET title = 'After backup'").run();
  const destinationRoot = path.join(root, "restored-library-root");
  openDatabase(dbPath).prepare(`
    UPDATE app_metadata SET value = ? WHERE key = 'library_root'
  `).run(destinationRoot);
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
  assert.equal(
    restoredDb.prepare(
      "SELECT value FROM app_metadata WHERE key = 'library_root'",
    ).get().value,
    destinationRoot,
    "restore keeps the destination computer's root prefix",
  );
  const restoredArtwork = restoredDb.prepare(
    "SELECT cover_art_path FROM tracks WHERE id = ?",
  ).get("track-1").cover_art_path;
  assert.ok(fs.existsSync(restoredArtwork));
  assert.match(restored.settingsJson, /"theme":"dark"/);
  assert.doesNotMatch(restored.settingsJson, /braveSearchApiKey/);
  assert.match(restored.smartCratesJson, /Backup crate/);

  playlistHistory = await backend.invoke("list_playlist_history", { dbPath });
  assert.ok(playlistHistory.entries.length >= 2);
  console.log("Data features smoke test passed");
} finally {
  backend.close();
  fs.rmSync(root, { recursive: true, force: true });
}
