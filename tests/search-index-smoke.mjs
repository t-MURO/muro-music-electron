import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildSearchMatchQuery,
  closeDatabases,
  openDatabase,
  rebuildSearchIndex,
  refreshSearchText,
  searchTrackIds,
} from "../electron/database.mjs";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muro-search-"));
const dbPath = path.join(tempDir, "search.db");

// The filename deliberately does not echo the title: search_text covers both,
// so a shared word would hide whether a title edit actually reindexed.
const insertTrack = (db, { title, artist, album, genre = [] }) => {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tracks (id, title, artist, album, genre_json, filename, source_path, import_status, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'library', ?)
  `).run(
    id,
    title,
    artist,
    album,
    JSON.stringify(genre),
    `${id}.mp3`,
    path.join(tempDir, `${id}.mp3`),
    Math.floor(Date.now() / 1000),
  );
  refreshSearchText(db, id);
  return id;
};

const run = () => {
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
  run();
} finally {
  closeDatabases();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
