import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildSearchMatchQuery,
  closeDatabases,
  mergeArtistEntities,
  openDatabase,
  rebuildSearchIndex,
  refreshSearchText,
  replaceTrackArtistCredits,
  searchTrackIds,
} from "../electron/database.mjs";
import { createBackend } from "../electron/backend.mjs";
import { acceptInboxTracks } from "../electron/inboxOrganizer.mjs";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muro-search-"));
const dbPath = path.join(tempDir, "search.db");

const backend = createBackend({
  dbPath,
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

// The filename deliberately does not echo the title: search_text covers both,
// so a shared word would hide whether a title edit actually reindexed.
let nextFixtureNumber = 0;
const insertTrack = (db, { title, artist, album, genre = [], key = null, bpm = null }) => {
  const id = randomUUID();
  const filename = `fixture-${nextFixtureNumber += 1}.mp3`;
  db.prepare(`
    INSERT INTO tracks (
      id, title, artist, album, genre_json, key, bpm, filename,
      source_path, import_status, added_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'library', ?)
  `).run(
    id,
    title,
    artist,
    album,
    JSON.stringify(genre),
    key,
    bpm,
    filename,
    path.join(tempDir, filename),
    Math.floor(Date.now() / 1000),
  );
  refreshSearchText(db, id);
  return id;
};

const run = async () => {
  const db = openDatabase(dbPath);

  const darkSide = insertTrack(db, {
    title: "Money",
    artist: "Pink Floyd",
    album: "The Dark Side of the Moon",
    genre: ["Progressive Rock"],
  });
  const bjork = insertTrack(db, {
    title: "Jóga",
    artist: "Björk",
    album: "Homogenic",
    genre: ["Electronic"],
  });
  const harmonic = insertTrack(db, {
    title: "Harmonic Search",
    artist: "Index Test",
    album: "Metadata",
    key: "8A",
    bpm: 128,
  });
  insertTrack(db, {
    title: "Teardrop",
    artist: "Massive Attack",
    album: "Mezzanine",
    genre: ["Trip Hop"],
  });

  // Query construction
  assert.equal(buildSearchMatchQuery(""), "", "an empty query produces no match expression");
  assert.equal(buildSearchMatchQuery("   "), "", "whitespace produces no match expression");
  assert.equal(
    buildSearchMatchQuery("dark side"),
    '"dark"* AND "side"*',
    "each term becomes a quoted prefix term joined by AND",
  );

  // FTS operator words and punctuation must not be interpreted as syntax.
  for (const hostile of ['moon OR "', "NEAR(a b)", "*", '"""', "AND"]) {
    assert.doesNotThrow(
      () => searchTrackIds(dbPath, hostile),
      `query ${JSON.stringify(hostile)} must not throw`,
    );
  }

  // Multi-term search spans fields: title/artist/album all feed search_text.
  const floyd = searchTrackIds(dbPath, "pink moon");
  assert.deepEqual(floyd, [darkSide], "terms match across artist and album");

  // Prefix matching while typing.
  assert.deepEqual(searchTrackIds(dbPath, "teard"), searchTrackIds(dbPath, "teardrop"));

  // Diacritics are folded on both sides of the comparison.
  const bjorkHits = searchTrackIds(dbPath, "bjork");
  assert.deepEqual(bjorkHits, [bjork], "an unaccented query matches accented text");
  assert.deepEqual(searchTrackIds(dbPath, "jóga"), [bjork], "an accented query still matches");
  assert.deepEqual(searchTrackIds(dbPath, "8A"), [harmonic], "musical key is searchable");
  assert.deepEqual(searchTrackIds(dbPath, "128"), [harmonic], "BPM is searchable");

  // "No opinion" and "no matches" must stay distinguishable: callers fall back
  // to their own matcher on null, but must show an empty list on [].
  assert.equal(searchTrackIds(dbPath, "   "), null, "blank query yields no opinion");
  assert.equal(
    searchTrackIds(dbPath, "!!!"),
    null,
    "a query with no searchable characters yields no opinion, not zero results",
  );
  assert.deepEqual(
    searchTrackIds(dbPath, "zzzznotpresent"),
    [],
    "a real query that matches nothing returns an empty list",
  );

  // Triggers keep the index current on update and delete.
  db.prepare("UPDATE tracks SET title = ? WHERE id = ?").run("Renamed Track", darkSide);
  refreshSearchText(db, darkSide);
  assert.deepEqual(searchTrackIds(dbPath, "renamed"), [darkSide], "an update reindexes the row");
  assert.deepEqual(searchTrackIds(dbPath, "money"), [], "the previous title is gone from the index");

  db.prepare("DELETE FROM tracks WHERE id = ?").run(darkSide);
  assert.deepEqual(searchTrackIds(dbPath, "renamed"), [], "a delete removes the row from the index");

  // Every write path that changes a searchable field has to reindex the row,
  // or the renderer's refreshed query keeps returning the old answer.
  const analyzed = insertTrack(db, { title: "Unanalyzed", artist: "Index Test", album: "Analysis" });
  await backend.invoke("update_track_analysis", { dbPath, trackId: analyzed, bpm: 174, key: "11B" });
  assert.deepEqual(searchTrackIds(dbPath, "174"), [analyzed], "an analyzed BPM is searchable");
  assert.deepEqual(searchTrackIds(dbPath, "11B"), [analyzed], "an analyzed key is searchable");

  const inboxDir = path.join(tempDir, "inbox");
  const libraryDir = path.join(tempDir, "library");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.writeFileSync(path.join(inboxDir, "collide.mp3"), "incoming");
  fs.writeFileSync(path.join(libraryDir, "collide.mp3"), "already in the library");
  const staged = randomUUID();
  db.prepare(`
    INSERT INTO tracks (id, title, artist, album, filename, source_path, import_status, added_at)
    VALUES (?, 'Staged', 'Index Test', 'Inbox', 'collide.mp3', ?, 'staged', ?)
  `).run(staged, path.join(inboxDir, "collide.mp3"), Math.floor(Date.now() / 1000));
  refreshSearchText(db, staged);
  const accepted = await acceptInboxTracks({ dbPath, trackIds: [staged], libraryFolder: libraryDir });
  assert.equal(accepted.moved[0]?.filename, "collide (2).mp3", "the collision renamed the file");
  assert.deepEqual(
    searchTrackIds(dbPath, "collide 2"),
    [staged],
    "accepting a track reindexes its new file name",
  );

  const typo = insertTrack(db, { title: "Typo Credit", artist: "Daft Pnk", album: "Merge" });
  const canonical = insertTrack(db, { title: "Right Credit", artist: "Daft Punk", album: "Merge" });
  const typoSet = replaceTrackArtistCredits(db, {
    trackId: typo,
    scope: "track",
    displayText: "Daft Pnk",
    credits: [{ name: "Daft Pnk", creditedName: "Daft Pnk", joinPhrase: "" }],
    provenance: "file-tags",
  });
  const canonicalSet = replaceTrackArtistCredits(db, {
    trackId: canonical,
    scope: "track",
    displayText: "Daft Punk",
    credits: [{ name: "Daft Punk", creditedName: "Daft Punk", joinPhrase: "" }],
    provenance: "file-tags",
  });
  assert.deepEqual(searchTrackIds(dbPath, "punk"), [canonical]);
  mergeArtistEntities(dbPath, {
    sourceArtistId: typoSet.credits[0].artistId,
    targetArtistId: canonicalSet.credits[0].artistId,
  });
  assert.deepEqual(
    [...searchTrackIds(dbPath, "punk")].sort(),
    [typo, canonical].sort(),
    "merging artists reindexes the tracks credited to the merged artist",
  );

  // A rebuild must reproduce the same answers.
  rebuildSearchIndex(db);
  assert.deepEqual(searchTrackIds(dbPath, "bjork"), [bjork], "the index survives a rebuild");

  // Reopening an existing database must not duplicate index entries.
  closeDatabases();
  const reopened = openDatabase(dbPath);
  assert.deepEqual(
    searchTrackIds(dbPath, "mezzanine").length,
    1,
    "reopening does not double-index existing rows",
  );
  void reopened;

  // The limit is honoured.
  assert.equal(searchTrackIds(dbPath, "a", 1).length <= 1, true, "the limit bounds the result");

  console.log("search-index-smoke: all assertions passed");
};

try {
  await run();
} finally {
  backend.close?.();
  closeDatabases();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
