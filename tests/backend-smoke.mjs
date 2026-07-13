import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackend } from "../electron/backend.mjs";
import { openDatabase } from "../electron/database.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-node-smoke-"));
const dbPath = path.join(directory, "muro.db");
const backend = createBackend({
  cacheDir: path.join(directory, "covers"),
  emit: () => {},
});

try {
  const db = openDatabase(dbPath);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO tracks (
      id, title, artist, album, filename, source_path, import_status,
      duration_seconds, bitrate_kbps, added_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'staged', ?, ?, ?, ?)
  `).run("track-1", "Smoke Test", "Muro", "Checks", "smoke.mp3", path.join(directory, "smoke.mp3"), 90, 320, now, now);

  let snapshot = await backend.invoke("load_tracks", { dbPath });
  assert.equal(snapshot.inbox.length, 1);
  assert.equal(snapshot.library.length, 0);

  await backend.invoke("accept_tracks", { dbPath, trackIds: ["track-1"] });
  snapshot = await backend.invoke("load_tracks", { dbPath });
  assert.equal(snapshot.library.length, 1);

  await backend.invoke("create_playlist", { dbPath, id: "playlist-1", name: "Smoke" });
  await backend.invoke("add_tracks_to_playlist", {
    dbPath,
    playlistId: "playlist-1",
    trackIds: ["track-1", "track-1"],
  });
  const playlists = await backend.invoke("load_playlists", { dbPath });
  assert.deepEqual(playlists.playlists[0].track_ids, ["track-1"]);

  await backend.invoke("update_track_analysis", {
    dbPath,
    trackId: "track-1",
    bpm: 128,
    key: "8A",
  });
  await backend.invoke("record_track_play", { dbPath, trackId: "track-1" });
  const recent = await backend.invoke("load_recently_played", { dbPath, limit: 10 });
  assert.equal(recent[0].play_count, 1);
  assert.equal(recent[0].bpm, 128);

  await backend.invoke("reject_tracks", { dbPath, trackIds: ["track-1"] });
  snapshot = await backend.invoke("load_tracks", { dbPath });
  assert.equal(snapshot.library.length, 0);
  assert.deepEqual((await backend.invoke("load_playlists", { dbPath })).playlists[0].track_ids, []);
} finally {
  backend.close();
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log("Backend smoke test passed");
