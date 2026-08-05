import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TagLib } from "taglib-wasm";
import { closeDatabase } from "../electron/database.mjs";
import {
  artistMetadataFromCommon,
  importAudioFile,
  normalizedRatingFromStars,
  readRatingFromFile,
  starsFromMp3PopmRating,
  starsFromNormalizedRating,
  starsFromVorbisRating,
  vorbisRatingFromStars,
  writeMetadataToFile,
} from "../electron/metadata.mjs";

const writeSyntheticMp3 = (filePath) => {
  const frames = [];
  for (let index = 0; index < 12; index += 1) {
    const frame = Buffer.alloc(417);
    // MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo.
    Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(frame);
    frames.push(frame);
  }
  fs.writeFileSync(filePath, Buffer.concat(frames));
};

const writeSilentWav = (filePath) => {
  const data = Buffer.alloc(1_600);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8_000, 24);
  header.writeUInt32LE(16_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, data]));
};

const hashFile = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const explorerStarsFromPopm = (raw) => {
  if (raw === 0) return 0;
  if (raw <= 31) return 1;
  if (raw <= 95) return 2;
  if (raw <= 159) return 3;
  if (raw <= 223) return 4;
  return 5;
};

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-rating-smoke-"));
const dbPath = path.join(directory, "muro.db");

try {
  for (let stars = 0; stars <= 5; stars += 0.5) {
    assert.equal(
      starsFromNormalizedRating(normalizedRatingFromStars(stars)),
      stars,
      `${stars} stars should survive normalized conversion`,
    );
    assert.equal(vorbisRatingFromStars(stars), stars * 20);
  }
  assert.equal(starsFromVorbisRating("40"), 2);
  assert.equal(starsFromVorbisRating("0.4"), 2);
  assert.equal(starsFromVorbisRating("4"), 4);
  assert.equal(starsFromVorbisRating("1"), 1);
  assert.equal(starsFromVorbisRating("1.0"), 5);
  assert.equal(starsFromVorbisRating("50"), 2.5);
  assert.equal(starsFromVorbisRating("not-a-rating"), undefined);

  const mp3Path = path.join(directory, "rated.mp3");
  writeSyntheticMp3(mp3Path);
  const beforeHash = hashFile(mp3Path);

  await writeMetadataToFile(mp3Path, { rating: 5 });
  assert.notEqual(hashFile(mp3Path), beforeHash, "setting a rating should modify the audio file");
  assert.equal(await readRatingFromFile(mp3Path), 5);

  const taglib = await TagLib.initialize();
  const reopened = await taglib.open(mp3Path);
  try {
    assert.equal(
      starsFromNormalizedRating(reopened.getRating()),
      5,
      "five stars should survive an MP3 save and reopen",
    );
  } finally {
    reopened.dispose();
  }

  const completeArtistCredits = [{
    artistId: "44444444-4444-4444-8444-444444444444",
    name: "Artist One",
    creditedName: "Artist One",
    joinPhrase: " feat. ",
    musicBrainzId: "11111111-1111-4111-8111-111111111111",
  }, {
    artistId: "55555555-5555-4555-8555-555555555555",
    name: "Artist Two",
    creditedName: "Artist Two",
    joinPhrase: " & ",
    musicBrainzId: "22222222-2222-4222-8222-222222222222",
  }, {
    artistId: "66666666-6666-4666-8666-666666666666",
    name: "Artist Three",
    creditedName: "Artist Three",
    joinPhrase: "",
    musicBrainzId: "77777777-7777-4777-8777-777777777777",
  }];
  const completeAlbumArtistCredits = [{
    name: "Album Artist",
    creditedName: "Album Artist",
    joinPhrase: "",
    musicBrainzId: "33333333-3333-4333-8333-333333333333",
  }];
  await writeMetadataToFile(mp3Path, {
    artist: "Artist One feat. Artist Two & Artist Three",
    artistCredits: completeArtistCredits,
    albumArtist: "Album Artist",
    albumArtistCredits: completeAlbumArtistCredits,
  });
  const creditedFile = await taglib.open(mp3Path);
  try {
    const properties = creditedFile.properties();
    assert.deepEqual(properties.artist, ["Artist One feat. Artist Two & Artist Three"]);
    assert.deepEqual(properties.ARTISTS, ["Artist One", "Artist Two", "Artist Three"]);
    assert.deepEqual(properties.musicbrainzArtistId, [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "77777777-7777-4777-8777-777777777777",
    ]);
    assert.deepEqual(properties.albumArtist, ["Album Artist"]);
    assert.deepEqual(properties.ALBUMARTISTS, ["Album Artist"]);
    assert.deepEqual(properties.musicbrainzReleaseArtistId, [
      "33333333-3333-4333-8333-333333333333",
    ]);
  } finally {
    creditedFile.dispose();
  }

  const partialArtistCredits = [{
    artistId: "88888888-8888-4888-8888-888888888888",
    name: "Track Artist Without ID",
    creditedName: "Track Artist Without ID",
    joinPhrase: " with ",
  }, {
    artistId: "99999999-9999-4999-8999-999999999999",
    name: "Track Artist With ID",
    creditedName: "Track Artist With ID",
    joinPhrase: "",
    musicBrainzId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }];
  const partialAlbumArtistCredits = [{
    artistId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Album Artist Without ID",
    creditedName: "Album Artist Without ID",
    joinPhrase: " & ",
  }, {
    artistId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "Album Artist With ID",
    creditedName: "Album Artist With ID",
    joinPhrase: "",
    musicBrainzId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  }];
  const partialArtistDisplay = "Track Artist Without ID with Track Artist With ID";
  const partialAlbumArtistDisplay = "Album Artist Without ID & Album Artist With ID";
  await writeMetadataToFile(mp3Path, {
    artist: partialArtistDisplay,
    artistCredits: partialArtistCredits,
    albumArtist: partialAlbumArtistDisplay,
    albumArtistCredits: partialAlbumArtistCredits,
  });
  const partialCreditFile = await taglib.open(mp3Path);
  try {
    const properties = partialCreditFile.properties();
    assert.deepEqual(properties.artist, [partialArtistDisplay]);
    assert.deepEqual(properties.ARTISTS, [
      "Track Artist Without ID",
      "Track Artist With ID",
    ]);
    assert.deepEqual(properties.musicbrainzArtistId ?? [], []);
    assert.deepEqual(properties.albumArtist, [partialAlbumArtistDisplay]);
    assert.deepEqual(properties.ALBUMARTISTS, [
      "Album Artist Without ID",
      "Album Artist With ID",
    ]);
    assert.deepEqual(properties.musicbrainzReleaseArtistId ?? [], []);
  } finally {
    partialCreditFile.dispose();
  }

  const mismatchedCommon = artistMetadataFromCommon({
    artist: partialArtistDisplay,
    artists: ["Track Artist Without ID", "Track Artist With ID"],
    musicbrainz_artistid: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    albumartist: partialAlbumArtistDisplay,
    albumartists: ["Album Artist Without ID", "Album Artist With ID"],
    musicbrainz_albumartistid: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
  });
  assert.deepEqual(mismatchedCommon.artistMusicbrainzIds, [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ]);
  assert.deepEqual(mismatchedCommon.albumArtistMusicbrainzIds, [
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ]);
  assert.equal(mismatchedCommon.artistCredits.some((credit) => credit.musicBrainzId), false);
  assert.equal(
    mismatchedCommon.albumArtistCredits.some((credit) => credit.musicBrainzId),
    false,
  );
  const inconsistentCommon = artistMetadataFromCommon({
    artist: "  Exact Track Artist feat. Alias  ",
    artists: ["Exact Track Artist", "Different Track Artist"],
    musicbrainz_artistid: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
    albumartist: "  Exact Album Artist & Alias  ",
    albumartists: ["Exact Album Artist", "Different Album Artist"],
    musicbrainz_albumartistid: [
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ],
  });
  assert.equal(inconsistentCommon.artist, "  Exact Track Artist feat. Alias  ");
  assert.deepEqual(inconsistentCommon.artistCredits, [{
    name: "Exact Track Artist feat. Alias",
    creditedName: "  Exact Track Artist feat. Alias  ",
    joinPhrase: "",
  }]);
  assert.equal(inconsistentCommon.albumArtist, "  Exact Album Artist & Alias  ");
  assert.deepEqual(inconsistentCommon.albumArtistCredits, [{
    name: "Exact Album Artist & Alias",
    creditedName: "  Exact Album Artist & Alias  ",
    joinPhrase: "",
  }]);
  const scalarCommon = artistMetadataFromCommon({
    artist: "Solo Track Artist",
    musicbrainz_artistid: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    albumartist: "Solo Album Artist",
    musicbrainz_albumartistid: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  });
  assert.equal(
    scalarCommon.artistCredits[0]?.musicBrainzId,
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  );
  assert.equal(
    scalarCommon.albumArtistCredits[0]?.musicBrainzId,
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
  );

  const imported = await importAudioFile(dbPath, mp3Path, path.join(directory, "covers"));
  assert.equal(imported.rating, 5, "new imports should read TagLib's cross-format rating");
  assert.equal(imported.artist, partialArtistDisplay);
  assert.equal(imported.artists, partialAlbumArtistDisplay);
  const withoutEntityIds = (credits) => credits.map(({ artistId, ...credit }) => {
    assert.match(artistId, /^[0-9a-f-]{36}$/i);
    return credit;
  });
  const withoutInputIds = (credits) => credits.map(({
    artistId: _artistId,
    musicBrainzId: _musicBrainzId,
    ...credit
  }) => credit);
  assert.deepEqual(
    withoutEntityIds(imported.artist_credits),
    withoutInputIds(partialArtistCredits),
  );
  assert.deepEqual(
    withoutEntityIds(imported.album_artist_credits),
    withoutInputIds(partialAlbumArtistCredits),
  );

  const expectedPopmValues = [0, 13, 1, 54, 64, 118, 128, 186, 196, 242, 255];
  for (let stars = 0.5; stars <= 5; stars += 0.5) {
    await writeMetadataToFile(mp3Path, { rating: stars });
    const ratedFile = await taglib.open(mp3Path);
    try {
      const raw = Math.round(ratedFile.getRating() * 255);
      assert.equal(raw, expectedPopmValues[Math.round(stars * 2)]);
      assert.equal(starsFromMp3PopmRating(ratedFile.getRating()), stars);
      if (Number.isInteger(stars)) {
        assert.equal(
          explorerStarsFromPopm(raw),
          stars,
          `${stars} Muro stars should display as ${stars} stars in Windows Explorer`,
        );
      }
    } finally {
      ratedFile.dispose();
    }
    assert.equal(await readRatingFromFile(mp3Path), stars);
  }

  await writeMetadataToFile(mp3Path, { rating: 0 });
  assert.equal(await readRatingFromFile(mp3Path), 0, "zero stars should remove the embedded rating");

  const wavPath = path.join(directory, "unsupported-rating.wav");
  writeSilentWav(wavPath);
  const wavHash = hashFile(wavPath);
  await assert.rejects(
    writeMetadataToFile(wavPath, { rating: 4 }),
    /does not support embedded ratings/,
    "a format that ignores ratings must reject the file write",
  );
  assert.equal(
    hashFile(wavPath),
    wavHash,
    "a rejected rating must not rewrite an unsupported audio file",
  );

  console.log("Metadata rating smoke checks passed.");
} finally {
  closeDatabase(dbPath);
  fs.rmSync(directory, { recursive: true, force: true });
}
