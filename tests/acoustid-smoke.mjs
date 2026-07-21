import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAcoustIdService } from "../electron/acoustid.mjs";
import { closeDatabases, openDatabase } from "../electron/database.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-acoustid-smoke-"));
const dbPath = path.join(directory, "library.db");
const sourcePath = path.join(directory, "unknown.wav");
fs.writeFileSync(sourcePath, Buffer.from("smoke audio"));
const db = openDatabase(dbPath);
db.prepare(`
  INSERT INTO tracks(
    id, title, artist, album, filename, source_path, import_status,
    duration_seconds, bitrate_kbps, added_at, updated_at
  ) VALUES ('track-1', 'Unknown', 'Unknown', 'Target Album', 'unknown.wav', ?,
    'accepted', 245, 320, 1, 1)
`).run(sourcePath);

let fingerprintCount = 0;
let lookupCount = 0;
const service = createAcoustIdService({
  now: () => 1_800_000_000_000,
  requestIntervalMs: 0,
  fingerprintFileImpl: async (requestedPath) => {
    assert.equal(requestedPath, sourcePath);
    fingerprintCount += 1;
    return { duration: 245, fingerprint: "AQADtMmybfakefingerprint" };
  },
  fetchImpl: async (url, options) => {
    lookupCount += 1;
    assert.equal(String(url), "https://api.acoustid.org/v2/lookup");
    assert.equal(options.method, "POST");
    assert.equal(options.body.get("client"), "client123");
    assert.equal(options.body.get("duration"), "245");
    assert.equal(options.body.get("fingerprint"), "AQADtMmybfakefingerprint");
    assert.equal(options.body.get("meta"), "recordings releases releasegroups");
    return new Response(JSON.stringify({
      status: "ok",
      results: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        score: 0.97,
        recordings: [{
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "Identified Track",
          artists: [{ name: "Identified Artist" }],
          releases: [{
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            title: "Target Album",
            date: "2024-05-03",
            country: "DE",
            status: "Official",
            artists: [{ name: "Album Artist" }],
            releasegroup: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
          }],
        }],
      }],
    }), { headers: { "content-type": "application/json" } });
  },
});

try {
  const first = await service.identifyTrack(db, {
    trackId: "track-1",
    clientKey: "client123",
  });
  assert.equal(first.cached, false);
  assert.equal(first.duration, 245);
  assert.equal(first.candidates.length, 1);
  assert.deepEqual(first.candidates[0], {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    acoustidId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    score: 0.97,
    recordingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    releaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    releaseGroupId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    title: "Identified Track",
    artist: "Identified Artist",
    album: "Target Album",
    albumArtist: "Album Artist",
    year: 2024,
    country: "DE",
    status: "Official",
    genre: null,
    albumMatch: true,
  });

  const cached = await service.identifyTrack(db, {
    trackId: "track-1",
    clientKey: "client123",
  });
  assert.equal(cached.cached, true);
  assert.equal(fingerprintCount, 1);
  assert.equal(lookupCount, 1);

  await service.identifyTrack(db, {
    trackId: "track-1",
    clientKey: "client123",
    force: true,
  });
  assert.equal(fingerprintCount, 1, "forced lookup should reuse an unchanged fingerprint");
  assert.equal(lookupCount, 2);

  await assert.rejects(
    service.identifyTrack(db, { trackId: "track-1", clientKey: "" }),
    /valid AcoustID application key/,
  );

  const invalidKeyService = createAcoustIdService({
    now: () => 1_800_000_000_000,
    requestIntervalMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({
      status: "error",
      error: { code: 4, message: "invalid API key" },
    }), { status: 400, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(
    invalidKeyService.identifyTrack(db, {
      trackId: "track-1",
      clientKey: "personal123",
      force: true,
    }),
    /personal user API key.*cannot be used for lookups/i,
  );
  console.log("AcoustID smoke test passed");
} finally {
  closeDatabases();
  fs.rmSync(directory, { recursive: true, force: true });
}
