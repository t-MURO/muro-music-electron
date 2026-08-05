import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { closeDatabases, openDatabase } from "../electron/database.mjs";
import { createBackend } from "../electron/backend.mjs";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muro-verify-"));
const dbPath = path.join(tempDir, "verify.db");
const musicDir = path.join(tempDir, "music");
const movedDir = path.join(tempDir, "moved");
fs.mkdirSync(musicDir, { recursive: true });
fs.mkdirSync(movedDir, { recursive: true });

const backend = createBackend({
  cacheDir: path.join(tempDir, "covers"),
  artistProfileCacheDir: path.join(tempDir, "artists"),
  emit: () => {},
  keyFinder: {
    health: () => ({ ok: true }),
    startAnalysis: () => ({}),
    cancelAnalysis: () => ({}),
    recycle: () => ({}),
    close: () => {},
  },
  fpcalcBinaryDirectories: [],
});

const writeAudioFile = (dir, name) => {
  const filePath = path.join(dir, name);
  const sampleRate = 8_000;
  const sampleCount = sampleRate / 10;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, buffer);
  return filePath;
};

const insertTrack = (db, { title, sourcePath, durationSeconds = 0 }) => {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tracks (id, title, artist, album, filename, source_path,
      import_status, added_at, duration_seconds, is_missing)
    VALUES (?, ?, 'Artist', 'Album', ?, ?, 'library', ?, ?, 0)
  `).run(
    id,
    title,
    path.basename(sourcePath),
    sourcePath,
    Math.floor(Date.now() / 1000),
    durationSeconds,
  );
  return id;
};

const run = async () => {
  const db = openDatabase(dbPath);

  const presentPath = writeAudioFile(musicDir, "present.wav");
  const vanishingPath = writeAudioFile(musicDir, "vanishing.wav");

  const presentId = insertTrack(db, {
    title: "Present",
    sourcePath: presentPath,
    durationSeconds: 0.1,
  });
  const missingId = insertTrack(db, {
    title: "Vanishing",
    sourcePath: vanishingPath,
    durationSeconds: 0.1,
  });
  await backend.invoke("load_tracks", { dbPath, libraryRoot: tempDir });
  assert.equal(
    db.prepare("SELECT source_path FROM tracks WHERE id = ?").get(presentId).source_path,
    "music/present.wav",
    "verification starts from a portable stored path",
  );

  // Everything is on disk to begin with.
  let result = await backend.invoke("verify_library_files", { dbPath });
  assert.equal(result.missing, 0, "nothing is missing while both files exist");
  assert.equal(result.checked, 2);

  // Move one file out from under the library.
  const relocatedPath = path.join(movedDir, "vanishing.wav");
  fs.renameSync(vanishingPath, relocatedPath);

  result = await backend.invoke("verify_library_files", { dbPath });
  assert.equal(result.missing, 1, "the moved file is reported missing");
  assert.equal(result.newlyMissing, 1, "and is counted as newly missing");

  const missingList = await backend.invoke("list_missing_tracks", { dbPath });
  assert.equal(missingList.length, 1);
  assert.equal(missingList[0].id, missingId);

  // The present track must not be touched.
  const presentRow = db.prepare("SELECT is_missing FROM tracks WHERE id = ?").get(presentId);
  assert.equal(Number(presentRow.is_missing), 0, "an existing file stays unflagged");

  // A verification pass never deletes rows.
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM tracks").get().n,
    2,
    "verification never removes library entries",
  );

  // Relinking by hand.
  await backend.invoke("relink_track", { dbPath, trackId: missingId, newPath: relocatedPath });
  const relinked = db.prepare("SELECT source_path, is_missing FROM tracks WHERE id = ?").get(missingId);
  assert.equal(
    relinked.source_path,
    "moved/vanishing.wav",
    "manual relinking stores a forward-slash path relative to the root",
  );
  assert.equal(Number(relinked.is_missing), 0, "and is no longer flagged");

  // Relinking to a path that does not exist must fail rather than corrupt the row.
  await assert.rejects(
    () => backend.invoke("relink_track", {
      dbPath,
      trackId: missingId,
      newPath: path.join(movedDir, "nope.wav"),
    }),
    /does not exist/,
    "relinking to a missing file is rejected",
  );

  // Relinking onto a file another track already owns must fail.
  await assert.rejects(
    () => backend.invoke("relink_track", { dbPath, trackId: missingId, newPath: presentPath }),
    /already uses that file/,
    "two tracks cannot share one file",
  );

  // Auto-relink: move the file again, then let the folder search find it.
  const secondMovePath = path.join(movedDir, "nested", "vanishing.wav");
  fs.mkdirSync(path.dirname(secondMovePath), { recursive: true });
  fs.renameSync(relocatedPath, secondMovePath);
  await backend.invoke("verify_library_files", { dbPath });

  const unknownCandidate = writeAudioFile(movedDir, "unknown-duration.wav");
  const unknownId = insertTrack(db, {
    title: "Unknown duration",
    sourcePath: path.join(musicDir, "unknown-duration.wav"),
    durationSeconds: 0,
  });
  const corruptCandidate = path.join(movedDir, "corrupt-duration.wav");
  fs.writeFileSync(corruptCandidate, Buffer.alloc(64));
  const corruptId = insertTrack(db, {
    title: "Corrupt candidate",
    sourcePath: path.join(musicDir, "corrupt-duration.wav"),
    durationSeconds: 0.1,
  });
  db.prepare("UPDATE tracks SET is_missing = 1 WHERE id IN (?, ?)").run(unknownId, corruptId);

  const dryRun = await backend.invoke("auto_relink_missing", {
    dbPath,
    searchDir: movedDir,
    dryRun: true,
  });
  assert.equal(dryRun.matched, 1, "the dry run finds the match");
  assert.equal(dryRun.relinked, 0, "the dry run changes nothing");
  assert.equal(
    db.prepare("SELECT is_missing FROM tracks WHERE id = ?").get(missingId).is_missing,
    1,
    "the dry run leaves the track flagged",
  );

  const applied = await backend.invoke("auto_relink_missing", {
    dbPath,
    searchDir: movedDir,
    dryRun: false,
  });
  assert.equal(applied.relinked, 1, "the real run reconnects the track");
  const reconnected = db.prepare("SELECT source_path, is_missing FROM tracks WHERE id = ?").get(missingId);
  assert.equal(reconnected.source_path, "moved/nested/vanishing.wav");
  assert.equal(Number(reconnected.is_missing), 0);
  assert.equal(
    db.prepare("SELECT is_missing FROM tracks WHERE id = ?").get(unknownId).is_missing,
    1,
    "a track with no known duration is not matched by filename alone",
  );
  assert.equal(
    db.prepare("SELECT is_missing FROM tracks WHERE id = ?").get(corruptId).is_missing,
    1,
    "an unreadable duration candidate is not matched by filename alone",
  );
  db.prepare("DELETE FROM tracks WHERE id IN (?, ?)").run(unknownId, corruptId);
  fs.unlinkSync(unknownCandidate);
  fs.unlinkSync(corruptCandidate);

  // A restored file flips the flag back on the next verification.
  fs.renameSync(secondMovePath, path.join(movedDir, "vanishing.wav"));
  result = await backend.invoke("verify_library_files", { dbPath });
  assert.equal(result.missing, 1);
  fs.renameSync(path.join(movedDir, "vanishing.wav"), secondMovePath);
  result = await backend.invoke("verify_library_files", { dbPath });
  assert.equal(result.restored, 1, "a returning file is un-flagged");
  assert.equal(result.missing, 0);

  console.log("library-verify-smoke: all assertions passed");
};

try {
  await run();
} finally {
  backend.close?.();
  closeDatabases();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
