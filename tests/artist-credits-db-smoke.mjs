import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabases,
  ensureStructuredArtistCredits,
  loadArtistCredits,
  loadRecentlyPlayed,
  loadTracks,
  migrateStructuredArtistCredits,
  normalizeArtistName,
  openDatabase,
  parseLegacyArtistCredits,
  replaceTrackArtistCredits,
} from "../electron/database.mjs";

const renderCredits = (credits) =>
  credits.map((credit) => credit.creditedName + credit.joinPhrase).join("");

assert.equal(normalizeArtistName("  SHDW   & Obscure  "), "shdw & obscure");
assert.deepEqual(
  parseLegacyArtistCredits(" SHDW & Obscure ", ["shdw & obscure"]),
  [{
    name: "SHDW & Obscure",
    creditedName: " SHDW & Obscure ",
    joinPhrase: "",
  }],
);
const protectedSubstring = "SHDW & Obscure feat. Guest, Other";
const protectedCredits = parseLegacyArtistCredits(
  protectedSubstring,
  ["SHDW & Obscure"],
);
assert.deepEqual(
  protectedCredits.map(({ name, creditedName, joinPhrase }) => ({
    name,
    creditedName,
    joinPhrase,
  })),
  [
    {
      name: "SHDW & Obscure",
      creditedName: "SHDW & Obscure",
      joinPhrase: " feat. ",
    },
    { name: "Guest", creditedName: "Guest", joinPhrase: ", " },
    { name: "Other", creditedName: "Other", joinPhrase: "" },
  ],
);
assert.equal(renderCredits(protectedCredits), protectedSubstring);
const hyphenatedSubstring = "Jay-Z feat. Guest";
const hyphenatedCredits = parseLegacyArtistCredits(
  hyphenatedSubstring,
  ["Jay-Z"],
);
assert.deepEqual(
  hyphenatedCredits.map(({ name, creditedName, joinPhrase }) => ({
    name,
    creditedName,
    joinPhrase,
  })),
  [
    { name: "Jay-Z", creditedName: "Jay-Z", joinPhrase: " feat. " },
    { name: "Guest", creditedName: "Guest", joinPhrase: "" },
  ],
);
assert.equal(renderCredits(hyphenatedCredits), hyphenatedSubstring);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-artist-credits-"));
const dbPath = path.join(temporaryDirectory, "muro.db");
const soloMusicBrainzId = "11111111-1111-4111-8111-111111111111";
const staleMusicBrainzId = "22222222-2222-4222-8222-222222222222";

try {
  const db = openDatabase(dbPath);
  const insert = db.prepare(`
    INSERT INTO tracks(
      id, title, artist, album, album_artist, filename, source_path,
      import_status, added_at, updated_at, last_played_at,
      musicbrainz_artistid, musicbrainz_albumartistid
    ) VALUES (?, ?, ?, 'Test Album', ?, ?, ?, 'accepted', ?, ?, ?, ?, ?)
  `);
  insert.run(
    "multi",
    "Multi",
    "Alpha, Beta & Gamma feat. Delta",
    "SHDW & Obscure feat. Guest",
    "multi.flac",
    "multi.flac",
    3,
    3,
    "2026-01-03T00:00:00.000Z",
    null,
    null,
  );
  insert.run(
    "atomic",
    "Atomic",
    "SHDW & Obscure",
    null,
    "atomic.flac",
    "atomic.flac",
    2,
    2,
    null,
    null,
    null,
  );
  insert.run(
    "solo",
    "Solo",
    "Solo Artist",
    "Solo Artist",
    "solo.flac",
    "solo.flac",
    1,
    1,
    "2026-01-01T00:00:00.000Z",
    soloMusicBrainzId,
    soloMusicBrainzId,
  );

  // Ordinary loads synthesize missing structured DTOs without writing.
  const beforeBackfill = loadTracks(
    dbPath,
    temporaryDirectory,
    ["SHDW & Obscure"],
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM track_artist_credit_sets").get().count,
    0,
  );
  const beforeMulti = beforeBackfill.library.find((track) => track.id === "multi");
  const beforeAtomic = beforeBackfill.library.find((track) => track.id === "atomic");
  assert.equal(beforeMulti.artist_credits.length, 4);
  assert.equal(beforeMulti.album_artist_credits.length, 2);
  assert.equal(renderCredits(beforeMulti.artist_credits), beforeMulti.artist);
  assert.equal(
    renderCredits(beforeMulti.album_artist_credits),
    beforeMulti.album_artist,
  );
  assert.equal(beforeAtomic.artist_credits.length, 1);
  assert.match(beforeAtomic.artist_credits[0].artistId, /^legacy:/);

  const firstBackfill = ensureStructuredArtistCredits(
    dbPath,
    ["SHDW & Obscure"],
  );
  assert.deepEqual(firstBackfill, {
    tracksChecked: 3,
    setsCreated: 5,
    setsReplaced: 0,
    creditsCreated: 9,
  });
  assert.equal(
    db.prepare("SELECT artist FROM tracks WHERE id = 'multi'").get().artist,
    "Alpha, Beta & Gamma feat. Delta",
  );
  assert.deepEqual(
    ensureStructuredArtistCredits(dbPath, ["SHDW & Obscure"]),
    {
      tracksChecked: 3,
      setsCreated: 0,
      setsReplaced: 0,
      creditsCreated: 0,
    },
  );

  const soloCredits = loadArtistCredits(db, ["solo"]).get("solo");
  assert.equal(soloCredits.artist_credits.length, 1);
  assert.equal(soloCredits.album_artist_credits.length, 1);
  assert.equal(
    soloCredits.artist_credits[0].artistId,
    soloCredits.album_artist_credits[0].artistId,
  );
  assert.equal(soloCredits.artist_credits[0].musicBrainzId, soloMusicBrainzId);
  assert.equal(
    db.prepare(
      "SELECT COUNT(*) count FROM artist_entities WHERE musicbrainz_id = ?",
    ).get(soloMusicBrainzId).count,
    1,
  );

  // A provider's canonical name supersedes a file-tag alias for the same MBID.
  assert.equal(soloCredits.artist_credits[0].name, "Solo Artist");
  const providerCanonicalName = "MusicBrainz Guest Artist";
  const fileTagAlias = "Solo Artist";
  const providerSet = replaceTrackArtistCredits(db, {
    trackId: "solo",
    scope: "track",
    displayText: fileTagAlias,
    credits: [{
      name: providerCanonicalName,
      creditedName: fileTagAlias,
      joinPhrase: "",
      musicBrainzId: soloMusicBrainzId,
    }],
    provenance: "provider",
  });
  assert.equal(providerSet.credits[0].name, providerCanonicalName);
  assert.deepEqual(
    db.prepare(`
      SELECT canonical_name, normalized_name
      FROM artist_entities
      WHERE musicbrainz_id = ?
    `).get(soloMusicBrainzId),
    {
      canonical_name: providerCanonicalName,
      normalized_name: normalizeArtistName(providerCanonicalName),
    },
  );
  assert.equal(
    loadArtistCredits(db, ["solo"]).get("solo").artist_credits[0].name,
    providerCanonicalName,
  );

  // A later file-style credit can reuse the MBID without restoring the alias.
  replaceTrackArtistCredits(db, {
    trackId: "solo",
    scope: "track",
    displayText: fileTagAlias,
    credits: [{
      name: fileTagAlias,
      creditedName: fileTagAlias,
      joinPhrase: "",
      musicBrainzId: soloMusicBrainzId,
    }],
    provenance: "legacy",
  });
  assert.deepEqual(
    db.prepare(`
      SELECT canonical_name, normalized_name
      FROM artist_entities
      WHERE musicbrainz_id = ?
    `).get(soloMusicBrainzId),
    {
      canonical_name: providerCanonicalName,
      normalized_name: normalizeArtistName(providerCanonicalName),
    },
  );
  assert.equal(
    loadArtistCredits(db, ["solo"]).get("solo").artist_credits[0].name,
    providerCanonicalName,
  );

  // A stale MBID entity must not claim a same-name credit that supplied no ID.
  insert.run(
    "stale-identity",
    "Stale identity",
    "Shared Artist",
    null,
    "stale-identity.flac",
    "stale-identity.flac",
    4,
    4,
    null,
    staleMusicBrainzId,
    null,
  );
  const staleSet = replaceTrackArtistCredits(db, {
    trackId: "stale-identity",
    scope: "track",
    displayText: "Shared Artist",
    credits: [{
      name: "Shared Artist",
      creditedName: "Shared Artist",
      joinPhrase: "",
      musicBrainzId: staleMusicBrainzId,
    }],
    provenance: "file-tags",
  });
  const staleArtistId = staleSet.credits[0].artistId;
  db.prepare("DELETE FROM tracks WHERE id = 'stale-identity'").run();
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM artist_entities WHERE id = ?")
      .get(staleArtistId).count,
    1,
    "the regression requires an unreferenced MBID entity",
  );

  insert.run(
    "homonymous-no-id",
    "Homonymous no ID",
    "Shared Artist",
    null,
    "homonymous-no-id.flac",
    "homonymous-no-id.flac",
    4,
    4,
    null,
    null,
    null,
  );
  const homonymousSet = replaceTrackArtistCredits(db, {
    trackId: "homonymous-no-id",
    scope: "track",
    displayText: "Shared Artist",
    credits: [{
      name: "Shared Artist",
      creditedName: "Shared Artist",
      joinPhrase: "",
    }],
    provenance: "file-tags",
  });
  assert.notEqual(homonymousSet.credits[0].artistId, staleArtistId);
  assert.equal(homonymousSet.credits[0].musicBrainzId, undefined);
  assert.equal(
    db.prepare("SELECT musicbrainz_id FROM artist_entities WHERE id = ?")
      .get(homonymousSet.credits[0].artistId).musicbrainz_id,
    null,
  );
  db.prepare("DELETE FROM tracks WHERE id = 'homonymous-no-id'").run();

  // A newly saved exception can safely revise legacy provenance only.
  const exceptionRefresh = ensureStructuredArtistCredits(
    dbPath,
    ["SHDW & Obscure", "Alpha, Beta & Gamma"],
  );
  assert.equal(exceptionRefresh.setsReplaced, 1);
  assert.equal(exceptionRefresh.creditsCreated, 2);
  assert.equal(
    loadArtistCredits(db, ["multi"]).get("multi").artist_credits.length,
    2,
  );
  assert.equal(
    ensureStructuredArtistCredits(
      dbPath,
      ["SHDW & Obscure", "Alpha, Beta & Gamma"],
    ).setsReplaced,
    0,
  );

  db.prepare("UPDATE tracks SET artist = ? WHERE id = 'multi'")
    .run("Alias One & Alias Two");
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) count
      FROM track_artist_credit_sets
      WHERE track_id = 'multi' AND scope = 'track'
    `).get().count,
    0,
    "legacy scalar edits invalidate only the stale scope",
  );
  const userSet = replaceTrackArtistCredits(db, {
    trackId: "multi",
    scope: "track",
    displayText: "Alias One & Alias Two",
    credits: [
      {
        name: "Canonical One",
        creditedName: "Alias One",
        joinPhrase: " & ",
      },
      {
        name: "Canonical Two",
        creditedName: "Alias Two",
        joinPhrase: "",
      },
    ],
    provenance: "user",
  });
  assert.equal(userSet.credits.length, 2);
  assert.match(
    db.prepare("SELECT search_text FROM tracks WHERE id = 'multi'").get().search_text,
    /canonical one/,
  );
  assert.throws(
    () => replaceTrackArtistCredits(db, {
      trackId: "multi",
      scope: "track",
      displayText: "Does not match",
      credits: [{ name: "Different", creditedName: "Different", joinPhrase: "" }],
    }),
    /reproduce display text exactly/,
  );

  // Explicit legacy ensure never overwrites a user/provider set.
  ensureStructuredArtistCredits(dbPath, ["Alias One & Alias Two"]);
  assert.equal(
    loadArtistCredits(db, ["multi"]).get("multi").artist_credits.length,
    2,
  );
  assert.equal(
    db.prepare(`
      SELECT provenance
      FROM track_artist_credit_sets
      WHERE track_id = 'multi' AND scope = 'track'
    `).get().provenance,
    "user",
  );

  const recentlyPlayed = loadRecentlyPlayed(
    dbPath,
    10,
    temporaryDirectory,
    ["SHDW & Obscure"],
  );
  assert.equal(recentlyPlayed[0].id, "multi");
  assert.equal(recentlyPlayed[0].artist_credits[0].name, "Canonical One");
  assert.doesNotMatch(recentlyPlayed[0].artist_credits[0].artistId, /^legacy:/);

  const versionedMigration = migrateStructuredArtistCredits(
    dbPath,
    ["SHDW & Obscure", "Alias One & Alias Two"],
  );
  assert.equal(versionedMigration.skipped, false);
  assert.equal(
    loadArtistCredits(db, ["multi"]).get("multi").artist_credits.length,
    1,
    "an exact saved exception is authoritative during the versioned migration",
  );
  assert.equal(
    migrateStructuredArtistCredits(
      dbPath,
      ["SHDW & Obscure", "Alias One & Alias Two"],
    ).skipped,
    true,
    "the same exception-versioned migration must not rescan or rewrite the library",
  );

  closeDatabases();
  const reopened = openDatabase(dbPath);
  assert.equal(
    reopened.prepare("SELECT COUNT(*) count FROM track_artist_credit_sets").get().count,
    5,
    "schema initialization is idempotent",
  );
  assert.equal(reopened.pragma("foreign_key_check").length, 0);
} finally {
  closeDatabases();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("artist-credits-db-smoke: all assertions passed");
