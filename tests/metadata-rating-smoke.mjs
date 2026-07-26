import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TagLib } from "taglib-wasm";
import { closeDatabase } from "../electron/database.mjs";
import {
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

  const imported = await importAudioFile(dbPath, mp3Path, path.join(directory, "covers"));
  assert.equal(imported.rating, 5, "new imports should read TagLib's cross-format rating");

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
