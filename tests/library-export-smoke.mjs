import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabases, openDatabase } from "../electron/database.mjs";
import {
  exportItunesLibrary,
  exportOrganizedLibrary,
  sanitizeExportSegment,
} from "../electron/libraryExport.mjs";

assert.equal(sanitizeExportSegment("Album/Artist"), "Album-Artist");
assert.equal(sanitizeExportSegment("Album: Name"), "Album- Name");
assert.equal(sanitizeExportSegment(".."), "Unknown");
assert.equal(sanitizeExportSegment("CON"), "_CON");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-library-export-"));
const sourceDirectory = path.join(temporaryDirectory, "sources");
const destinationDirectory = path.join(temporaryDirectory, "destination");
const dbPath = path.join(temporaryDirectory, "muro.db");
fs.mkdirSync(sourceDirectory, { recursive: true });
fs.mkdirSync(destinationDirectory, { recursive: true });

const firstSource = path.join(sourceDirectory, "01 - First.mp3");
const secondSource = path.join(sourceDirectory, "02 - Second.flac");
const fallbackSource = path.join(sourceDirectory, "Fallback Song.wav");
const missingSource = path.join(sourceDirectory, "Missing.mp3");
fs.writeFileSync(firstSource, "first");
fs.writeFileSync(secondSource, "second");
fs.writeFileSync(fallbackSource, "fallback");

try {
  const db = openDatabase(dbPath);
  const insertTrack = db.prepare(`
    INSERT INTO tracks (
      id, title, artist, album_artist, album, filename, source_path, import_status,
      track_number, disc_number, disc_total, duration_seconds, added_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, 1, 1)
  `);
  insertTrack.run(
    "track-1",
    "First",
    "Track Artist",
    "Album/Artist",
    "Album:Name",
    path.basename(firstSource),
    firstSource,
    1,
    1,
    2,
    181,
  );
  insertTrack.run(
    "track-2",
    "Second",
    "Track Artist",
    "Album/Artist",
    "Album:Name",
    path.basename(secondSource),
    secondSource,
    2,
    2,
    2,
    182,
  );
  insertTrack.run(
    "track-3",
    "Fallback Song",
    "Fallback & Artist",
    "   ",
    "Single Album",
    path.basename(fallbackSource),
    fallbackSource,
    1,
    1,
    1,
    183,
  );
  insertTrack.run(
    "track-missing",
    "Missing",
    "Missing Artist",
    null,
    "Missing Album",
    path.basename(missingSource),
    missingSource,
    1,
    1,
    1,
    184,
  );

  db.prepare(`
    INSERT INTO playlist_folders(id, name, parent_id, sort_order, created_at)
    VALUES ('folder-root', 'Sets', NULL, 0, 1)
  `).run();
  db.prepare(`
    INSERT INTO playlist_folders(id, name, parent_id, sort_order, created_at)
    VALUES ('folder-nested', 'Deep/Nested', 'folder-root', 0, 2)
  `).run();
  db.prepare(`
    INSERT INTO playlists(id, name, folder_id, sort_order, created_at)
    VALUES ('playlist-root', 'Root Mix', NULL, 0, 1)
  `).run();
  db.prepare(`
    INSERT INTO playlists(id, name, folder_id, sort_order, created_at)
    VALUES ('playlist-nested', 'Nested:Mix', 'folder-nested', 0, 2)
  `).run();
  const addPlaylistTrack = db.prepare(`
    INSERT INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)
  `);
  addPlaylistTrack.run("playlist-root", "track-3", 0);
  addPlaylistTrack.run("playlist-root", "track-1", 1);
  addPlaylistTrack.run("playlist-nested", "track-2", 0);
  addPlaylistTrack.run("playlist-nested", "track-missing", 1);

  db.prepare(`
    UPDATE tracks
    SET genre_json = ?, comment_json = ?, rating = 4, play_count = 7,
      bitrate_kbps = 320, sample_rate_hz = 44100, file_size_bytes = 123456,
      last_played_at = '2026-07-31T12:00:00.000Z'
    WHERE id = 'track-1'
  `).run(JSON.stringify(["House & Techno"]), JSON.stringify(["Peak <time>"]));
  db.prepare("UPDATE tracks SET is_missing = 1 WHERE id = 'track-missing'").run();

  const itunesExportPath = path.join(destinationDirectory, "Muro Music Library.xml");
  const itunesResult = await exportItunesLibrary({
    dbPath,
    destinationPath: itunesExportPath,
  });
  assert.deepEqual(itunesResult, {
    destinationPath: itunesExportPath,
    tracksExported: 4,
    missingTracksReferenced: 1,
    playlistFoldersExported: 2,
    playlistsExported: 2,
    playlistEntriesExported: 4,
    playlistEntriesSkipped: 0,
  });
  const itunesXml = fs.readFileSync(itunesExportPath, "utf8");
  assert.ok(itunesXml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
  assert.match(itunesXml, /Apple\/\/DTD PLIST 1\.0/);
  assert.match(itunesXml, /<key>Tracks<\/key>/);
  assert.match(itunesXml, /<key>Playlists<\/key>/);
  assert.match(itunesXml, /<key>Rating<\/key>\s*<integer>80<\/integer>/);
  assert.match(itunesXml, /<string>House &amp; Techno<\/string>/);
  assert.match(itunesXml, /<string>Peak &lt;time&gt;<\/string>/);
  assert.match(itunesXml, /<string>Fallback &amp; Artist<\/string>/);
  assert.match(itunesXml, /<key>Location<\/key>\s*<string>file:\/\/localhost\/.*01%20-%20First\.mp3<\/string>/);
  assert.match(itunesXml, /<key>Name<\/key>\s*<string>Deep\/Nested<\/string>/);
  assert.match(itunesXml, /<key>Parent Persistent ID<\/key>\s*<string>[A-F0-9]{16}<\/string>/);
  assert.match(itunesXml, /<key>Folder<\/key>\s*<true\/>/);
  assert.equal(
    (itunesXml.match(/<dict>/g) ?? []).length,
    (itunesXml.match(/<\/dict>/g) ?? []).length,
  );

  const progress = [];
  const result = await exportOrganizedLibrary({
    dbPath,
    destinationPath: destinationDirectory,
    useAsCurrentLibrary: true,
    onProgress: (event) => progress.push(event),
  });

  assert.equal(result.exportRoot, path.join(destinationDirectory, "Muro Library"));
  assert.equal(result.tracks, 4);
  assert.equal(result.filesCopied, 3);
  assert.equal(result.tracksFailed, 1);
  assert.equal(result.playlistsExported, 2);
  assert.equal(result.playlistEntriesExported, 3);
  assert.equal(result.playlistEntriesMissing, 1);
  assert.equal(result.librarySwitchRequested, true);
  assert.equal(result.librarySwitched, false);
  assert.match(result.librarySwitchError, /could not be copied/);
  assert.equal(
    db.prepare("SELECT source_path FROM tracks WHERE id = 'track-1'").get().source_path,
    firstSource,
  );

  const firstExport = path.join(
    result.exportRoot,
    "Album-Artist",
    "Album-Name",
    "Disc 1",
    path.basename(firstSource),
  );
  const secondExport = path.join(
    result.exportRoot,
    "Album-Artist",
    "Album-Name",
    "Disc 2",
    path.basename(secondSource),
  );
  const fallbackExport = path.join(
    result.exportRoot,
    "Fallback & Artist",
    "Single Album",
    path.basename(fallbackSource),
  );
  assert.equal(fs.readFileSync(firstExport, "utf8"), "first");
  assert.equal(fs.readFileSync(secondExport, "utf8"), "second");
  assert.equal(fs.readFileSync(fallbackExport, "utf8"), "fallback");

  const rootPlaylistPath = path.join(result.exportRoot, "Playlists", "Root Mix.m3u8");
  const nestedPlaylistPath = path.join(
    result.exportRoot,
    "Playlists",
    "Sets",
    "Deep-Nested",
    "Nested-Mix.m3u8",
  );
  const rootPlaylist = fs.readFileSync(rootPlaylistPath, "utf8");
  const nestedPlaylist = fs.readFileSync(nestedPlaylistPath, "utf8");
  assert.ok(rootPlaylist.startsWith("#EXTM3U\r\n"));
  assert.ok(rootPlaylist.includes("../Fallback & Artist/Single Album/Fallback Song.wav"));
  assert.ok(rootPlaylist.includes("../Album-Artist/Album-Name/Disc 1/01 - First.mp3"));
  assert.ok(nestedPlaylist.includes("../../../Album-Artist/Album-Name/Disc 2/02 - Second.flac"));
  assert.ok(!nestedPlaylist.includes("Missing.mp3"));
  assert.equal(progress.filter((event) => event.phase === "music").length, 4);
  assert.equal(progress.filter((event) => event.phase === "playlists").length, 2);

  db.prepare("DELETE FROM tracks WHERE id = 'track-missing'").run();
  const secondResult = await exportOrganizedLibrary({
    dbPath,
    destinationPath: destinationDirectory,
    useAsCurrentLibrary: true,
  });
  assert.equal(secondResult.exportRoot, path.join(destinationDirectory, "Muro Library (2)"));
  assert.equal(secondResult.tracksFailed, 0);
  assert.equal(secondResult.librarySwitchRequested, true);
  assert.equal(secondResult.librarySwitched, true);
  assert.equal(secondResult.librarySwitchError, null);
  const switchedPaths = db.prepare(`
    SELECT id, source_path FROM tracks ORDER BY id
  `).all();
  assert.deepEqual(switchedPaths, [
    {
      id: "track-1",
      source_path: path.join(
        secondResult.exportRoot,
        "Album-Artist",
        "Album-Name",
        "Disc 1",
        path.basename(firstSource),
      ),
    },
    {
      id: "track-2",
      source_path: path.join(
        secondResult.exportRoot,
        "Album-Artist",
        "Album-Name",
        "Disc 2",
        path.basename(secondSource),
      ),
    },
    {
      id: "track-3",
      source_path: path.join(
        secondResult.exportRoot,
        "Fallback & Artist",
        "Single Album",
        path.basename(fallbackSource),
      ),
    },
  ]);
} finally {
  closeDatabases();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Library export smoke test passed.");
