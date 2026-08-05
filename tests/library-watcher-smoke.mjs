import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabases,
  loadTracks,
  openDatabase,
} from "../electron/database.mjs";
import { createLibraryWatcher } from "../electron/libraryWatcher.mjs";
import { acceptInboxTracks } from "../electron/inboxOrganizer.mjs";
import { importAudioFile } from "../electron/metadata.mjs";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muro-watch-"));
const dbPath = path.join(tempDir, "watch.db");
const watchDir = path.join(tempDir, "drop");
const cacheDir = path.join(tempDir, "covers");
fs.mkdirSync(watchDir, { recursive: true });

// A minimal but genuinely parseable MP3: an ID3v2 header followed by a silent
// MPEG frame. music-metadata needs real structure, not random bytes.
const buildMinimalMp3 = () => {
  const id3 = Buffer.alloc(10);
  id3.write("ID3");
  id3[3] = 3; // version 2.3
  // A single silent MPEG-1 Layer III frame header (0xFF 0xFB) plus padding.
  const frame = Buffer.alloc(418);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x00;
  return Buffer.concat([id3, frame, Buffer.alloc(418 * 6)]);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await wait(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const imported = [];
const watcher = createLibraryWatcher({
  cacheDir,
  emit: (_sender, name, payload) => {
    if (name === "muro://watched-folder-import") imported.push(payload);
  },
  getSender: () => ({ isDestroyed: () => false }),
});

const run = async () => {
  const db = openDatabase(dbPath);

  // Disabled watching must not register anything.
  let status = watcher.setFolders({ dbPath, folders: [watchDir], isEnabled: false });
  assert.deepEqual(status.watching, [], "nothing is watched while the feature is off");

  status = watcher.setFolders({ dbPath, folders: [watchDir], isEnabled: true });
  assert.deepEqual(status.watching, [path.resolve(watchDir)], "the folder is watched once enabled");

  // A non-existent folder is ignored rather than throwing.
  status = watcher.setFolders({
    dbPath,
    folders: [watchDir, path.join(tempDir, "does-not-exist")],
    isEnabled: true,
  });
  assert.deepEqual(
    status.watching,
    [path.resolve(watchDir)],
    "a missing folder is skipped without failing",
  );

  // Non-audio files must never be imported.
  fs.writeFileSync(path.join(watchDir, "notes.txt"), "not audio");
  await wait(1_000);
  assert.equal(imported.length, 0, "a text file is ignored");

  // Drop in an audio file and let the watcher settle and import it.
  const dropped = path.join(watchDir, "dropped.mp3");
  fs.writeFileSync(dropped, buildMinimalMp3());

  await waitUntil(
    () => imported.some((entry) => entry.sourcePath === path.resolve(dropped)),
    20_000,
    "the dropped file to be imported",
  );

  const row = db.prepare("SELECT import_status FROM tracks WHERE source_path = ?").get(
    "dropped.mp3",
  );
  assert.ok(row, "the dropped file reached the database");
  assert.equal(row.import_status, "staged", "watched imports land in the Inbox, not the library");

  // A second event for the same path must not create a duplicate row.
  fs.utimesSync(dropped, new Date(), new Date());
  await wait(3_000);
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM tracks WHERE source_path = ?")
    .get("dropped.mp3").n;
  assert.equal(count, 1, "re-touching a watched file does not duplicate it");

  // A manual scan finds files that appeared while nothing was watching.
  watcher.setFolders({ dbPath, folders: [], isEnabled: false });
  const offline = path.join(watchDir, "offline.mp3");
  fs.writeFileSync(offline, buildMinimalMp3());
  const scan = await watcher.scanNow({ dbPath, folders: [watchDir] });
  assert.equal(scan.imported, 1, "the manual scan imports what the watcher missed");
  assert.equal(scan.scanned, 2, "the scan looked at both audio files");

  // Re-scanning imports nothing new.
  const rescan = await watcher.scanNow({ dbPath, folders: [watchDir] });
  assert.equal(rescan.imported, 0, "a second scan is a no-op");

  const droppedRow = db.prepare("SELECT id FROM tracks WHERE source_path = ?").get(
    "dropped.mp3",
  );
  const offlineRow = db.prepare("SELECT id FROM tracks WHERE source_path = ?").get(
    "offline.mp3",
  );
  db.prepare(`
    UPDATE tracks
    SET artist = 'Track Artist', album_artist = 'Album Artist', album = 'First Album'
    WHERE id = ?
  `).run(droppedRow.id);
  db.prepare(`
    UPDATE tracks
    SET artist = 'Fallback Artist', album_artist = NULL, album = 'Second Album'
    WHERE id = ?
  `).run(offlineRow.id);

  const existingAlbumFolder = path.join(watchDir, "Fallback Artist", "Second Album");
  fs.mkdirSync(existingAlbumFolder, { recursive: true });
  const existingCollision = path.join(existingAlbumFolder, "offline.mp3");
  fs.writeFileSync(existingCollision, "existing file must not be overwritten");

  const accepted = await acceptInboxTracks({
    dbPath,
    trackIds: [droppedRow.id, offlineRow.id],
    organize: true,
    watchedFolders: [watchDir],
  });
  const organizedDropped = path.join(
    watchDir,
    "Album Artist",
    "First Album",
    "dropped.mp3",
  );
  const organizedOffline = path.join(existingAlbumFolder, "offline (2).mp3");
  assert.equal(accepted.moved.length, 2, "accepted watched imports are organized");
  assert.equal(
    fs.existsSync(organizedDropped),
    true,
    "Album Artist is preferred when it is present",
  );
  assert.equal(
    fs.existsSync(organizedOffline),
    true,
    "Artist is used when Album Artist is absent",
  );
  assert.equal(
    fs.readFileSync(existingCollision, "utf8"),
    "existing file must not be overwritten",
    "existing album contents are preserved",
  );
  assert.equal(fs.existsSync(dropped), false, "the first Inbox file was moved");
  assert.equal(fs.existsSync(offline), false, "the second Inbox file was moved");
  const organizedRow = db.prepare(`
    SELECT import_status, source_path, filename
    FROM tracks
    WHERE id = ?
  `).get(offlineRow.id);
  assert.equal(organizedRow.import_status, "accepted", "the organized track is accepted");
  assert.equal(
    organizedRow.source_path,
    "Fallback Artist/Second Album/offline (2).mp3",
    "the database stores a forward-slash path relative to the library root",
  );
  assert.equal(organizedRow.filename, "offline (2).mp3", "the collision suffix is stored");
  const loadedOffline = loadTracks(dbPath).library.find((track) => track.id === offlineRow.id);
  assert.equal(
    loadedOffline?.source_path,
    organizedOffline,
    "loaded tracks expose the native absolute path needed for playback",
  );

  const outsideFolder = path.join(tempDir, "outside-drop");
  fs.mkdirSync(outsideFolder);
  const outsideFile = path.join(outsideFolder, "outside.mp3");
  fs.writeFileSync(outsideFile, buildMinimalMp3());
  const outsideTrack = await importAudioFile(dbPath, outsideFile, cacheDir, {
    moveToWatchedFolderOnAccept: true,
  });
  assert.ok(outsideTrack, "the outside folder track imports into the Inbox");
  db.prepare(`
    UPDATE tracks
    SET artist = 'Outside Artist', album_artist = NULL, album = 'Outside Album'
    WHERE id = ?
  `).run(outsideTrack.id);

  const acceptedOutside = await acceptInboxTracks({
    dbPath,
    trackIds: [outsideTrack.id],
    organize: true,
    watchedFolders: [watchDir],
  });
  const organizedOutside = path.join(
    watchDir,
    "Outside Artist",
    "Outside Album",
    "outside.mp3",
  );
  assert.equal(acceptedOutside.moved.length, 1);
  assert.equal(
    fs.existsSync(organizedOutside),
    true,
    "an outside folder drop is organized beneath the sole watched folder",
  );
  assert.equal(fs.existsSync(outsideFile), false);
  assert.equal(
    db.prepare("SELECT source_path FROM tracks WHERE id = ?").get(outsideTrack.id).source_path,
    "Outside Artist/Outside Album/outside.mp3",
    "outside imports become portable after they are moved into the library root",
  );

  console.log("library-watcher-smoke: all assertions passed");
};

try {
  await run();
} finally {
  watcher.close();
  closeDatabases();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
