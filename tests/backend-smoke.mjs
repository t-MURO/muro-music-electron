import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackend } from "../electron/backend.mjs";
import { openDatabase } from "../electron/database.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-node-smoke-"));
const dbPath = path.join(directory, "muro.db");
let keyFinderClosed = false;
let keyFinderStartArguments;
const keyFinder = {
  health: async () => ({ service: "keyfinder-native", protocolVersion: 1 }),
  startAnalysis: async (tracks, _sender, settings, writeAuthorization) => {
    keyFinderStartArguments = { tracks, settings, writeAuthorization };
    return { jobId: `job-${tracks.length}` };
  },
  cancelAnalysis: async (jobId) => ({ cancelled: jobId === "job-1" }),
  recycle: () => ({ recycled: true }),
  generateWaveform: async (_sourcePath, points) => ({ peaks: Array(points).fill(0.5) }),
  close: () => { keyFinderClosed = true; },
};
const backend = createBackend({
  cacheDir: path.join(directory, "covers"),
  emit: () => {},
  keyFinder,
});

try {
  const db = openDatabase(dbPath);
  const now = Math.floor(Date.now() / 1000);
  const firstSourcePath = path.join(directory, "smoke.mp3");
  const secondSourcePath = path.join(directory, "smoke-2.mp3");
  fs.writeFileSync(firstSourcePath, "first smoke file");
  fs.writeFileSync(secondSourcePath, "second smoke file");
  const insertTrack = db.prepare(`
    INSERT INTO tracks (
      id, title, artist, album, filename, source_path, import_status,
      duration_seconds, bitrate_kbps, added_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'staged', ?, ?, ?, ?)
  `);
  insertTrack.run("track-1", "Smoke Test", "Muro", "Checks", "smoke.mp3", firstSourcePath, 90, 320, now, now);
  insertTrack.run("track-2", "Smoke Test 2", "Muro", "Checks", "smoke-2.mp3", secondSourcePath, 90, 320, now, now);

  let snapshot = await backend.invoke("load_tracks", { dbPath });
  assert.equal(snapshot.inbox.length, 2);
  assert.equal(snapshot.library.length, 0);

  await backend.invoke("accept_tracks", { dbPath, trackIds: ["track-1", "track-2"] });
  snapshot = await backend.invoke("load_tracks", { dbPath });
  assert.equal(snapshot.library.length, 2);

  await backend.invoke("create_playlist", { dbPath, id: "playlist-1", name: "Smoke" });
  await backend.invoke("add_tracks_to_playlist", {
    dbPath,
    playlistId: "playlist-1",
    trackIds: ["track-1", "track-2", "track-1"],
  });
  let playlists = await backend.invoke("load_playlists", { dbPath });
  assert.deepEqual(playlists.playlists[0].track_ids, ["track-1", "track-2"]);
  await backend.invoke("set_playlist_tracks", {
    dbPath,
    playlistId: "playlist-1",
    trackIds: ["track-2", "track-1"],
  });
  playlists = await backend.invoke("load_playlists", { dbPath });
  assert.deepEqual(playlists.playlists[0].track_ids, ["track-2", "track-1"]);

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

  assert.equal((await backend.invoke("keyfinder_health", {})).service, "keyfinder-native");
  const analysisSettings = {
    notation: "djCombined",
    customCodes: ["1A"],
    delimiter: " / ",
    outputs: { comment: "append", grouping: "none", initialKey: "overwrite", bpm: "overwrite" },
  };
  assert.deepEqual(
    await backend.invoke("start_track_analysis", {
      tracks: [{ id: "track-1" }],
      settings: analysisSettings,
      writeAuthorization: true,
    }),
    { jobId: "job-1" },
  );
  assert.deepEqual(keyFinderStartArguments, {
    tracks: [{ id: "track-1" }],
    settings: analysisSettings,
    writeAuthorization: true,
  });
  assert.deepEqual(
    await backend.invoke("cancel_track_analysis", { jobId: "job-1" }),
    { cancelled: true },
  );
  assert.deepEqual(await backend.invoke("recycle_keyfinder", {}), { recycled: true });
  assert.equal(
    (await backend.invoke("generate_track_waveform", { sourcePath: "smoke.mp3", points: 64 })).peaks.length,
    64,
  );

  const removeOnly = await backend.invoke("delete_tracks", {
    dbPath,
    trackIds: ["track-1"],
    deleteFromDisk: false,
  });
  assert.deepEqual(removeOnly, { deletedTrackIds: ["track-1"], failures: [] });
  assert.equal(fs.existsSync(firstSourcePath), true);
  snapshot = await backend.invoke("load_tracks", { dbPath });
  assert.equal(snapshot.library.length, 1);
  assert.deepEqual((await backend.invoke("load_playlists", { dbPath })).playlists[0].track_ids, ["track-2"]);

  const deleteFromDisk = await backend.invoke("delete_tracks", {
    dbPath,
    trackIds: ["track-2"],
    deleteFromDisk: true,
  });
  assert.deepEqual(deleteFromDisk, { deletedTrackIds: ["track-2"], failures: [] });
  assert.equal(fs.existsSync(secondSourcePath), false);
  snapshot = await backend.invoke("load_tracks", { dbPath });
  assert.equal(snapshot.library.length, 0);
  assert.deepEqual((await backend.invoke("load_playlists", { dbPath })).playlists[0].track_ids, []);
} finally {
  backend.close();
  assert.equal(keyFinderClosed, true);
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log("Backend smoke test passed");
