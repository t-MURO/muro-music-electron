import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { parseFile } from "music-metadata";
import sharp from "sharp";
import { createAlbumCoverService } from "../electron/albumCovers.mjs";
import { createArtistProfileService } from "../electron/artistProfiles.mjs";
import { createBackend } from "../electron/backend.mjs";
import { openDatabase } from "../electron/database.mjs";
import { registerMediaShortcuts } from "../electron/mediaShortcuts.mjs";
import { cacheEmbeddedCover } from "../electron/metadata.mjs";

const mediaShortcutCallbacks = new Map();
const unregisteredMediaShortcuts = [];
const mediaShortcutActions = [];
const mediaShortcutRegistration = registerMediaShortcuts({
  globalShortcut: {
    register: (accelerator, callback) => {
      mediaShortcutCallbacks.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => unregisteredMediaShortcuts.push(accelerator),
  },
  onAction: (action) => mediaShortcutActions.push(action),
});
assert.deepEqual(mediaShortcutRegistration.registeredAccelerators, [
  "MediaPlayPause",
  "MediaNextTrack",
  "MediaPreviousTrack",
]);
mediaShortcutCallbacks.get("MediaPlayPause")();
mediaShortcutCallbacks.get("MediaNextTrack")();
mediaShortcutCallbacks.get("MediaPreviousTrack")();
assert.deepEqual(mediaShortcutActions, ["toggle", "next", "previous"]);
mediaShortcutRegistration.unregister();
assert.deepEqual(unregisteredMediaShortcuts, [
  "MediaPlayPause",
  "MediaNextTrack",
  "MediaPreviousTrack",
]);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-node-smoke-"));
const dbPath = path.join(directory, "muro.db");
const legacyDbPath = path.join(directory, "legacy-playlists.db");
const legacyDb = new Database(legacyDbPath);
legacyDb.exec(`
  CREATE TABLE playlist_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder_id TEXT,
    created_at INTEGER NOT NULL
  );
  INSERT INTO playlist_folders(id, name, created_at) VALUES ('legacy-folder', 'Legacy', 1);
  INSERT INTO playlists(id, name, folder_id, created_at)
    VALUES ('legacy-newer', 'Newer', 'legacy-folder', 2);
  INSERT INTO playlists(id, name, folder_id, created_at)
    VALUES ('legacy-older', 'Older', 'legacy-folder', 1);
`);
legacyDb.close();
const migratedLegacyDb = openDatabase(legacyDbPath);
assert.ok(migratedLegacyDb.prepare("PRAGMA table_info(playlist_folders)").all()
  .some((column) => column.name === "parent_id"));
assert.ok(migratedLegacyDb.prepare("PRAGMA table_info(playlists)").all()
  .some((column) => column.name === "sort_order"));
assert.deepEqual(
  migratedLegacyDb.prepare("SELECT id, sort_order FROM playlists ORDER BY sort_order").all(),
  [
    { id: "legacy-newer", sort_order: 0 },
    { id: "legacy-older", sort_order: 1 },
  ],
);
const writeSilentWav = (filePath) => {
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
};
let keyFinderClosed = false;
let keyFinderStartArguments;
let waveformGenerationCount = 0;
let metadataFetchAttempts = 0;
const keyFinder = {
  health: async () => ({ service: "keyfinder-native", protocolVersion: 1 }),
  startAnalysis: async (tracks, _sender, settings, writeAuthorization) => {
    keyFinderStartArguments = { tracks, settings, writeAuthorization };
    return { jobId: `job-${tracks.length}` };
  },
  cancelAnalysis: async (jobId) => ({ cancelled: jobId === "job-1" }),
  recycle: () => ({ recycled: true }),
  generateWaveform: async (_sourcePath, points) => {
    waveformGenerationCount += 1;
    return { peaks: Array(points).fill(0.5) };
  },
  close: () => { keyFinderClosed = true; },
};
const backend = createBackend({
  cacheDir: path.join(directory, "covers"),
  emit: () => {},
  keyFinder,
  musicBrainzIntervalMs: 0,
  metadataFetchImpl: async (url) => {
    metadataFetchAttempts += 1;
    const metadataQuery = new URL(String(url)).searchParams.get("query") ?? "";
    if (metadataFetchAttempts === 1 || metadataQuery.includes("Offline Track")) {
      const connectionReset = Object.assign(new Error("TLS connection reset"), { code: "ECONNRESET" });
      throw new TypeError("fetch failed", { cause: connectionReset });
    }
    assert.ok(String(url).startsWith("https://musicbrainz.org/ws/2/recording/?"));
    return new Response(JSON.stringify({
      recordings: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Retry Track",
        score: 100,
        "artist-credit": [{ name: "Retry Artist" }],
        releases: [{
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "Retry Album",
          date: "2026-01-01",
          country: "DE",
          status: "Official",
          "artist-credit": [{ name: "Retry Artist" }],
          "release-group": { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
        }],
      }],
    }), { headers: { "content-type": "application/json" } });
  },
});

try {
  const db = openDatabase(dbPath);
  const metadataResults = await backend.invoke("search_track_metadata", {
    title: "Retry Track",
    artist: "Retry Artist",
    album: "Retry Album",
  });
  assert.equal(metadataFetchAttempts, 2, "metadata search should retry transient network failures");
  assert.equal(metadataResults[0].title, "Retry Track");
  assert.equal(metadataResults[0].albumMatch, true);
  await assert.rejects(
    backend.invoke("search_track_metadata", {
      title: "Offline Track",
      artist: "Retry Artist",
      album: "Retry Album",
    }),
    /MusicBrainz is temporarily unreachable \(ECONNRESET\)/,
  );
  const now = Math.floor(Date.now() / 1000);
  const coverDb = openDatabase(path.join(directory, "cover-art-archive.db"));
  const releaseId = "66666666-6666-4666-8666-666666666666";
  const releaseGroupId = "77777777-7777-4777-8777-777777777777";
  const missingReleaseGroupId = "88888888-8888-4888-8888-888888888888";
  const insertCoverTrack = coverDb.prepare(`
    INSERT INTO tracks(
      id, title, artist, album, filename, source_path, import_status,
      duration_seconds, bitrate_kbps, added_at, updated_at,
      musicbrainz_albumid, musicbrainz_releasegroupid
    ) VALUES (?, ?, 'Cover Artist', 'Cover Album', ?, ?, 'accepted', 180, 320, ?, ?, ?, ?)
  `);
  insertCoverTrack.run(
    "cover-track-1",
    "Cover Track 1",
    "cover-1.mp3",
    path.join(directory, "cover-1.mp3"),
    now,
    now,
    releaseId,
    releaseGroupId,
  );
  insertCoverTrack.run(
    "cover-track-2",
    "Cover Track 2",
    "cover-2.mp3",
    path.join(directory, "cover-2.mp3"),
    now,
    now,
    releaseId,
    releaseGroupId,
  );
  const coverFetchCalls = [];
  const coverCacheDir = path.join(directory, "cover-art-archive-cache");
  const albumCoverService = createAlbumCoverService({
    cacheDir: coverCacheDir,
    now: () => 1_750_000_000_000,
    fetchImpl: async (url) => {
      coverFetchCalls.push(String(url));
      if (String(url).startsWith("https://musicbrainz.org/ws/2/release-group/")) {
        const query = new URL(String(url)).searchParams.get("query") ?? "";
        if (query.includes("Deezer Album")) {
          return new Response(JSON.stringify({ "release-groups": [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          "release-groups": [{ id: releaseGroupId, title: "Cover Album", score: 100 }],
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url).startsWith("https://api.deezer.com/search/album?")) {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.searchParams.get("limit"), "15");
        if (requestUrl.searchParams.get("q") !== "Deezer Album Deezer Artist") {
          return new Response(JSON.stringify({ data: [], total: 0 }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          data: [
            {
              id: 123,
              title: "Deezer Album",
              artist: { name: "Wrong Artist" },
              cover_xl: "https://cdn-images.dzcdn.net/images/cover/wrong/1000x1000.jpg",
            },
            {
              id: 456,
              title: "Deezer Album",
              artist: { name: "Deezer Artist" },
              cover_xl: "https://cdn-images.dzcdn.net/images/cover/right/1000x1000.jpg",
            },
          ],
          total: 2,
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url) === `https://coverartarchive.org/release-group/${releaseGroupId}`) {
        return new Response(JSON.stringify({
          images: [{
            front: true,
            approved: true,
            image: `http://coverartarchive.org/release/${releaseId}/front-original.jpg`,
            thumbnails: {
              250: `http://coverartarchive.org/release/${releaseId}/front-250.jpg`,
              500: `http://coverartarchive.org/release/${releaseId}/front-500.jpg`,
              1200: `http://coverartarchive.org/release/${releaseId}/front-1200.jpg`,
            },
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url) === `https://coverartarchive.org/release-group/${missingReleaseGroupId}`) {
        return new Response("not found", { status: 404 });
      }
      if (String(url) === `https://coverartarchive.org/release/${releaseId}/front-1200.jpg`) {
        return new Response(Buffer.from("cover art archive image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (
        String(url)
        === "https://cdn-images.dzcdn.net/images/cover/right/1000x1000.jpg"
      ) {
        return new Response(Buffer.from("deezer cover image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`Unexpected Cover Art Archive URL: ${url}`);
    },
    cacheCoverBytesImpl: async (bytes, cacheDir) => {
      const content = Buffer.from(bytes).toString();
      assert.ok(
        content === "cover art archive image" || content === "deezer cover image",
        "only expected cover providers should be cached",
      );
      await fs.promises.mkdir(cacheDir, { recursive: true });
      const prefix = content === "deezer cover image" ? "deezer" : "archive";
      const fullPath = path.join(cacheDir, `${prefix}-full.jpg`);
      const thumbPath = path.join(cacheDir, `${prefix}-thumb.jpg`);
      await fs.promises.writeFile(fullPath, bytes);
      await fs.promises.writeFile(thumbPath, bytes);
      return { fullPath, thumbPath };
    },
  });
  const fetchedCover = await albumCoverService.fetchCoverForTrack(coverDb, {
    trackId: "cover-track-1",
  });
  assert.ok(
    coverFetchCalls.includes(`https://coverartarchive.org/release-group/${releaseGroupId}`),
    "release-group artwork should be preferred when both MusicBrainz IDs exist",
  );
  assert.ok(
    coverFetchCalls.includes(`https://coverartarchive.org/release/${releaseId}/front-1200.jpg`),
    "the 1200px Cover Art Archive image should be downloaded",
  );
  assert.ok(fs.existsSync(fetchedCover.fullPath));
  assert.ok(fs.existsSync(fetchedCover.thumbPath));
  const unchangedTrackCover = coverDb.prepare(`
    SELECT cover_art_path, cover_art_thumb_path FROM tracks WHERE id = 'cover-track-1'
  `).get();
  assert.equal(unchangedTrackCover.cover_art_path, null);
  assert.equal(unchangedTrackCover.cover_art_thumb_path, null);

  insertCoverTrack.run(
    "cover-track-3",
    "Cover Track 3",
    "cover-3.mp3",
    path.join(directory, "cover-3.mp3"),
    now,
    now,
    releaseId,
    releaseGroupId,
  );
  const fetchCountBeforeCachedCover = coverFetchCalls.length;
  const reusedCover = await albumCoverService.fetchCoverForTrack(coverDb, {
    trackId: "cover-track-3",
  });
  assert.equal(reusedCover.fullPath, fetchedCover.fullPath);
  assert.equal(coverFetchCalls.length, fetchCountBeforeCachedCover);

  insertCoverTrack.run(
    "cover-track-manual",
    "Cover Track Manual",
    "cover-manual.mp3",
    path.join(directory, "cover-manual.mp3"),
    now,
    now,
    null,
    null,
  );
  const manualCover = await albumCoverService.fetchCoverForTrack(coverDb, {
    trackId: "cover-track-manual",
    album: "Cover Album",
    artist: "Cover Artist",
  });
  assert.equal(manualCover?.fullPath, fetchedCover.fullPath);
  assert.ok(
    coverFetchCalls.some((url) => url.startsWith("https://musicbrainz.org/ws/2/release-group/")),
    "manual cover fetch should fall back to MusicBrainz when the file has no release IDs",
  );
  const manualTrackCover = coverDb.prepare(`
    SELECT cover_art_path, cover_art_thumb_path FROM tracks WHERE id = 'cover-track-manual'
  `).get();
  assert.equal(manualTrackCover.cover_art_path, null);
  assert.equal(manualTrackCover.cover_art_thumb_path, null);

  insertCoverTrack.run(
    "cover-track-deezer",
    "Deezer Cover",
    "cover-deezer.mp3",
    path.join(directory, "cover-deezer.mp3"),
    now,
    now,
    null,
    null,
  );
  coverDb.prepare(`
    UPDATE tracks
    SET artist = 'Deezer Artist', album = 'Deezer Album'
    WHERE id = 'cover-track-deezer'
  `).run();
  const deezerCover = await albumCoverService.fetchCoverForTrack(coverDb, {
    trackId: "cover-track-deezer",
  });
  assert.equal(deezerCover?.provider, "deezer");
  assert.equal(deezerCover?.sourceUrl, "https://www.deezer.com/album/456");
  assert.ok(fs.existsSync(deezerCover.fullPath));
  assert.ok(
    coverFetchCalls.includes("https://cdn-images.dzcdn.net/images/cover/right/1000x1000.jpg"),
    "the exact Deezer album-and-artist match should be downloaded",
  );
  assert.ok(
    !coverFetchCalls.includes("https://cdn-images.dzcdn.net/images/cover/wrong/1000x1000.jpg"),
    "a same-title Deezer album by another artist must not be downloaded",
  );
  const fetchCountBeforeDeezerCache = coverFetchCalls.length;
  const reusedDeezerCover = await albumCoverService.fetchCoverForTrack(coverDb, {
    trackId: "cover-track-deezer",
  });
  assert.equal(reusedDeezerCover?.provider, "deezer");
  assert.equal(reusedDeezerCover?.fullPath, deezerCover.fullPath);
  assert.equal(coverFetchCalls.length, fetchCountBeforeDeezerCache);

  insertCoverTrack.run(
    "cover-track-missing",
    "Missing Cover",
    "cover-missing.mp3",
    path.join(directory, "cover-missing.mp3"),
    now,
    now,
    null,
    missingReleaseGroupId,
  );
  assert.equal(await albumCoverService.fetchCoverForTrack(coverDb, {
    trackId: "cover-track-missing",
  }), null);
  const fetchCountBeforeNegativeCache = coverFetchCalls.length;
  assert.equal(await albumCoverService.fetchCoverForTrack(coverDb, {
    trackId: "cover-track-missing",
  }), null);
  assert.equal(
    coverFetchCalls.length,
    fetchCountBeforeNegativeCache,
    "missing covers should use the negative cache",
  );
  assert.equal(
    await cacheEmbeddedCover(
      { data: Buffer.from("not an image") },
      path.join(directory, "invalid-cover-cache"),
      "invalid-cover.mp3",
    ),
    undefined,
    "unsupported embedded artwork should not abort an audio import",
  );
  const validPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const recoveredEmbeddedCover = await cacheEmbeddedCover(
    [
      { type: "A bright coloured fish", data: Buffer.from("not an image") },
      { type: "Cover (front)", data: validPng },
    ],
    path.join(directory, "fallback-cover-cache"),
    "fallback-cover.mp3",
  );
  assert.ok(recoveredEmbeddedCover, "a valid front cover should be preferred over malformed artwork");
  assert.ok(fs.existsSync(recoveredEmbeddedCover.fullPath));
  assert.ok(fs.existsSync(recoveredEmbeddedCover.thumbPath));
  const validImportPath = path.join(directory, "valid-import.wav");
  writeSilentWav(validImportPath);
  const validImport = await backend.invoke("import_files", {
    dbPath,
    paths: [validImportPath],
  });
  assert.equal(validImport.imported.length, 1, "a valid audio file should import through the real metadata path");
  assert.equal(validImport.imported[0].source_path, validImportPath);
  assert.equal(validImport.imported[0].sample_rate_hz, 8_000);
  assert.equal(validImport.imported[0].bit_depth, 16);
  assert.equal(validImport.imported[0].file_size_bytes, fs.statSync(validImportPath).size);
  assert.equal(validImport.scanned, 1);
  assert.deepEqual(validImport.failures, []);
  const secondValidImportPath = path.join(directory, "valid-import-2.wav");
  writeSilentWav(secondValidImportPath);
  const secondValidImport = await backend.invoke("import_files", {
    dbPath,
    paths: [secondValidImportPath],
  });
  assert.equal(secondValidImport.imported.length, 1);
  const selectedCoverPath = path.join(directory, "selected-cover.png");
  const highResolutionCover = await sharp({
    create: { width: 2000, height: 1500, channels: 3, background: "#c92f49" },
  }).png().toBuffer();
  fs.writeFileSync(selectedCoverPath, highResolutionCover);
  const cachedClipboardCover = await backend.invoke("cache_cover_art_from_bytes", {
    bytes: highResolutionCover,
  });
  assert.ok(fs.existsSync(cachedClipboardCover.fullPath));
  assert.ok(fs.existsSync(cachedClipboardCover.thumbPath));
  assert.deepEqual(
    await sharp(cachedClipboardCover.fullPath).metadata().then(({ width, height }) => ({ width, height })),
    { width: 1600, height: 1200 },
  );
  assert.deepEqual(
    await sharp(cachedClipboardCover.thumbPath).metadata().then(({ width, height }) => ({ width, height })),
    { width: 192, height: 192 },
  );
  const cachedSelectedCover = await backend.invoke("cache_cover_art_from_file", {
    filePath: selectedCoverPath,
  });
  const coverWriteResult = await backend.invoke("update_track_metadata", {
    dbPath,
    trackIds: [validImport.imported[0].id, secondValidImport.imported[0].id],
    updates: {
      coverArtPath: cachedSelectedCover.fullPath,
      coverArtThumbPath: cachedSelectedCover.thumbPath,
    },
  });
  assert.deepEqual(coverWriteResult, {
    updated: 2,
    filesWritten: 2,
    fileWriteErrors: [],
  });
  for (const sourcePath of [validImportPath, secondValidImportPath]) {
    const embeddedMetadata = await parseFile(sourcePath, { skipCovers: false });
    assert.equal(embeddedMetadata.common.picture?.length, 1);
    assert.equal(embeddedMetadata.common.picture?.[0]?.type, "Cover (front)");
    assert.ok(embeddedMetadata.common.picture?.[0]?.data.length);
    assert.deepEqual(
      await sharp(embeddedMetadata.common.picture[0].data)
        .metadata()
        .then(({ width, height }) => ({ width, height })),
      { width: 1600, height: 1200 },
    );
  }
  assert.deepEqual(
    db.prepare(`
      SELECT cover_art_path, cover_art_thumb_path FROM tracks
      WHERE id IN (?, ?) ORDER BY id
    `).all(validImport.imported[0].id, secondValidImport.imported[0].id),
    [
      { cover_art_path: cachedSelectedCover.fullPath, cover_art_thumb_path: cachedSelectedCover.thumbPath },
      { cover_art_path: cachedSelectedCover.fullPath, cover_art_thumb_path: cachedSelectedCover.thumbPath },
    ],
  );
  db.prepare(`
    UPDATE tracks SET sample_rate_hz = NULL, bit_depth = NULL, file_size_bytes = NULL
    WHERE id = ?
  `).run(validImport.imported[0].id);
  assert.deepEqual(await backend.invoke("scan_technical_metadata", { dbPath, limit: 10 }), {
    checked: 1,
    updated: 1,
    failed: 0,
    remaining: 0,
  });
  const rescannedTechnicalMetadata = db.prepare(`
    SELECT sample_rate_hz, bit_depth, file_size_bytes FROM tracks WHERE id = ?
  `).get(validImport.imported[0].id);
  assert.deepEqual(rescannedTechnicalMetadata, {
    sample_rate_hz: 8_000,
    bit_depth: 16,
    file_size_bytes: fs.statSync(validImportPath).size,
  });
  await backend.invoke("reject_tracks", {
    dbPath,
    trackIds: [validImport.imported[0].id, secondValidImport.imported[0].id],
  });
  fs.unlinkSync(validImportPath);
  fs.unlinkSync(secondValidImportPath);

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
  assert.equal(snapshot.inbox.length, 0);

  const duplicateLibraryImport = await backend.invoke("import_files", {
    dbPath,
    paths: [firstSourcePath, secondSourcePath],
  });
  assert.deepEqual(duplicateLibraryImport.imported, []);
  assert.equal(duplicateLibraryImport.scanned, 2);
  snapshot = await backend.invoke("load_tracks", { dbPath });
  assert.equal(snapshot.library.length, 2);
  assert.equal(snapshot.inbox.length, 0);

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

  await backend.invoke("create_playlist_folder", {
    dbPath,
    id: "folder-1",
    name: "Sets",
  });
  await backend.invoke("update_playlist_folder", {
    dbPath,
    folderId: "folder-1",
    name: "Weekend Sets",
  });
  await backend.invoke("update_playlist", {
    dbPath,
    playlistId: "playlist-1",
    folderId: "folder-1",
  });
  playlists = await backend.invoke("load_playlists", { dbPath });
  assert.deepEqual(playlists.folders, [{
    id: "folder-1",
    name: "Weekend Sets",
    parent_id: null,
    sort_order: 0,
  }]);
  assert.equal(playlists.playlists[0].folder_id, "folder-1");

  await backend.invoke("create_playlist", {
    dbPath,
    id: "playlist-2",
    name: "Later Set",
    folderId: "folder-1",
  });
  playlists = await backend.invoke("load_playlists", { dbPath });
  assert.deepEqual(playlists.playlists.map((playlist) => playlist.id), ["playlist-1", "playlist-2"]);
  await backend.invoke("reorder_playlists", {
    dbPath,
    items: [
      { id: "playlist-2", folderId: "folder-1", sortOrder: 0 },
      { id: "playlist-1", folderId: "folder-1", sortOrder: 1 },
    ],
  });
  playlists = await backend.invoke("load_playlists", { dbPath });
  assert.deepEqual(playlists.playlists.map((playlist) => playlist.id), ["playlist-2", "playlist-1"]);
  await backend.invoke("delete_playlist", { dbPath, playlistId: "playlist-2" });

  await backend.invoke("create_playlist_folder", {
    dbPath,
    id: "folder-2",
    name: "Nested Sets",
    parentId: "folder-1",
  });
  playlists = await backend.invoke("load_playlists", { dbPath });
  assert.equal(playlists.folders[1].parent_id, "folder-1");

  const importedPlaylistPath = path.join(directory, "smoke-import.m3u8");
  fs.writeFileSync(
    importedPlaylistPath,
    ["#EXTM3U", firstSourcePath, path.basename(secondSourcePath), "missing.mp3"].join("\r\n"),
    "utf8",
  );
  const importedPlaylist = await backend.invoke("import_playlist_file", {
    dbPath,
    filePath: importedPlaylistPath,
  });
  assert.equal(importedPlaylist.name, "smoke-import");
  assert.deepEqual(
    importedPlaylist.entries.map((entry) => ({ track_id: entry.track_id, exists: entry.exists })),
    [
      { track_id: "track-1", exists: true },
      { track_id: "track-2", exists: true },
      { track_id: null, exists: false },
    ],
  );

  const playlistBundlePath = path.join(directory, "playlist-bundle");
  const nestedPlaylistPath = path.join(playlistBundlePath, "nested");
  const deeplyNestedPlaylistPath = path.join(nestedPlaylistPath, "deeper");
  fs.mkdirSync(deeplyNestedPlaylistPath, { recursive: true });
  const alphaPlaylistPath = path.join(playlistBundlePath, "alpha.m3u8");
  const betaPlaylistPath = path.join(nestedPlaylistPath, "beta.PLS");
  const gammaPlaylistPath = path.join(deeplyNestedPlaylistPath, "gamma.m3u");
  fs.writeFileSync(alphaPlaylistPath, firstSourcePath, "utf8");
  fs.writeFileSync(betaPlaylistPath, `[playlist]\r\nFile1=${secondSourcePath}\r\n`, "utf8");
  fs.writeFileSync(gammaPlaylistPath, firstSourcePath, "utf8");
  fs.writeFileSync(path.join(playlistBundlePath, "local-song.mp3"), "smoke audio placeholder", "utf8");
  fs.writeFileSync(path.join(playlistBundlePath, "notes.txt"), "not a playlist", "utf8");
  const playlistFolderScan = await backend.invoke("list_playlist_files", {
    directoryPath: playlistBundlePath,
  });
  assert.equal(playlistFolderScan.name, "playlist-bundle");
  assert.equal(playlistFolderScan.audioFileCount, 1);
  assert.deepEqual(playlistFolderScan.files, [alphaPlaylistPath, betaPlaylistPath, gammaPlaylistPath]);
  assert.deepEqual(playlistFolderScan.entries, [
    { path: alphaPlaylistPath, relativePath: "alpha.m3u8", folderPath: null },
    { path: betaPlaylistPath, relativePath: "nested/beta.PLS", folderPath: "nested" },
    {
      path: gammaPlaylistPath,
      relativePath: "nested/deeper/gamma.m3u",
      folderPath: "nested/deeper",
    },
  ]);
  assert.deepEqual(playlistFolderScan.folders, [
    { path: "nested", name: "nested", parentPath: null },
    { path: "nested/deeper", name: "deeper", parentPath: "nested" },
  ]);

  const exportedPlaylistPath = path.join(directory, "smoke-export.m3u8");
  assert.deepEqual(
    await backend.invoke("export_playlist_file", {
      dbPath,
      playlistId: "playlist-1",
      filePath: exportedPlaylistPath,
    }),
    { exported: 2, filePath: exportedPlaylistPath },
  );
  const exportedPlaylist = fs.readFileSync(exportedPlaylistPath, "utf8");
  assert.ok(exportedPlaylist.startsWith("#EXTM3U\r\n"));
  assert.ok(exportedPlaylist.indexOf(secondSourcePath) < exportedPlaylist.indexOf(firstSourcePath));

  await backend.invoke("delete_playlist_folder", { dbPath, folderId: "folder-1" });
  playlists = await backend.invoke("load_playlists", { dbPath });
  assert.equal(playlists.folders.length, 1);
  assert.equal(playlists.folders[0].id, "folder-2");
  assert.equal(playlists.folders[0].parent_id, null);
  assert.equal(playlists.playlists[0].folder_id, null);
  await backend.invoke("delete_playlist_folder", { dbPath, folderId: "folder-2" });

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

  const artistFetchCalls = [];
  const artistId = "11111111-1111-4111-8111-111111111111";
  const fallbackArtistId = "22222222-2222-4222-8222-222222222222";
  const premiumArtistId = "33333333-3333-4333-8333-333333333333";
  const lastFmArtistId = "44444444-4444-4444-8444-444444444444";
  let fanartAuthorization = null;
  let lastFmAuthorization = null;
  let theAudioDbAuthorization = null;
  let braveAuthorization = null;
  const artistProfileService = createArtistProfileService({
    cacheDir: path.join(directory, "artist-profile-cache"),
    musicBrainzIntervalMs: 0,
    fetchImpl: async (url, options = {}) => {
      artistFetchCalls.push(String(url));
      if (String(url).startsWith("https://musicbrainz.org/ws/2/artist/?")) {
        const requestedArtist = new URL(String(url)).searchParams.get("query");
        if (requestedArtist === "Unknown Underground Artist") {
          return new Response(JSON.stringify({ artists: [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        const isFallbackArtist = requestedArtist === "Fallback Muro";
        const isPremiumArtist = requestedArtist === "Premium Muro";
        const isLastFmArtist = requestedArtist === "LastFm Muro";
        return new Response(JSON.stringify({
          artists: [{
            id: isFallbackArtist
              ? fallbackArtistId
              : isLastFmArtist
                ? lastFmArtistId
              : isPremiumArtist
                ? premiumArtistId
                : artistId,
            name: requestedArtist,
            score: 100,
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      if (
        String(url).startsWith(`https://musicbrainz.org/ws/2/artist/${artistId}?`)
        || String(url).startsWith(`https://musicbrainz.org/ws/2/artist/${fallbackArtistId}?`)
        || String(url).startsWith(`https://musicbrainz.org/ws/2/artist/${premiumArtistId}?`)
        || String(url).startsWith(`https://musicbrainz.org/ws/2/artist/${lastFmArtistId}?`)
      ) {
        const isFallbackArtist = String(url).includes(fallbackArtistId);
        const isPremiumArtist = String(url).includes(premiumArtistId);
        const isLastFmArtist = String(url).includes(lastFmArtistId);
        return new Response(JSON.stringify({
          id: isFallbackArtist
            ? fallbackArtistId
            : isPremiumArtist
              ? premiumArtistId
              : isLastFmArtist
                ? lastFmArtistId
                : artistId,
          name: isFallbackArtist
            ? "Fallback Muro"
            : isPremiumArtist
              ? "Premium Muro"
              : isLastFmArtist
                ? "LastFm Muro"
                : "Muro",
          type: "Person",
          country: isPremiumArtist || isLastFmArtist ? null : "DE",
          area: isPremiumArtist || isLastFmArtist ? null : { name: "Berlin" },
          "life-span": isPremiumArtist || isLastFmArtist ? {} : { begin: "1990" },
          genres: isPremiumArtist || isLastFmArtist ? [] : [{ name: "electronic" }, { name: "house" }],
          relations: [
            {
              type: "wikipedia",
              url: { resource: isFallbackArtist
                ? "https://en.wikipedia.org/wiki/Fallback_Muro"
                : isPremiumArtist
                  ? "https://en.wikipedia.org/wiki/Premium_Muro"
                  : isLastFmArtist
                    ? "https://en.wikipedia.org/wiki/LastFm_Muro"
                  : "https://en.wikipedia.org/wiki/Muro_(musician)" },
            },
            ...(!isFallbackArtist && !isPremiumArtist && !isLastFmArtist
              ? [{ type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q123456" } }]
              : []),
          ],
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url) === "https://www.wikidata.org/wiki/Special:EntityData/Q123456.json") {
        return new Response(JSON.stringify({
          entities: {
            Q123456: {
              sitelinks: { enwiki: { title: "Muro (musician)" } },
              claims: {
                P18: [{
                  rank: "preferred",
                  mainsnak: { datavalue: { value: "Muro artist portrait.jpg" } },
                }],
              },
            },
          },
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url).startsWith("https://commons.wikimedia.org/w/api.php?")) {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.searchParams.get("titles"), "File:Muro artist portrait.jpg");
        assert.equal(requestUrl.searchParams.get("iiurlwidth"), "800");
        return new Response(JSON.stringify({
          query: {
            pages: [{
              imageinfo: [{
                thumburl: "https://upload.wikimedia.org/muro-commons.jpg",
                descriptionurl: "https://commons.wikimedia.org/wiki/File:Muro_artist_portrait.jpg",
                extmetadata: {
                  Artist: { value: "<a href=\"https://example.test\">Smoke Photographer</a>" },
                  LicenseShortName: { value: "CC BY-SA 4.0" },
                  LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
                },
              }],
            }],
          },
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url).includes("/api/rest_v1/page/summary/")) {
        const isFallbackArtist = String(url).includes("Fallback_Muro");
        const isPremiumArtist = String(url).includes("Premium_Muro");
        const isLastFmArtist = String(url).includes("LastFm_Muro");
        return new Response(JSON.stringify({
          extract: isPremiumArtist || isLastFmArtist
            ? null
            : `${isFallbackArtist ? "Fallback Muro" : "Muro"} is an electronic musician used by the smoke test.`,
          description: isPremiumArtist || isLastFmArtist ? null : "Electronic musician",
          thumbnail: isFallbackArtist || isPremiumArtist || isLastFmArtist
            ? undefined
            : { source: "https://upload.wikimedia.org/muro-smoke.jpg" },
          content_urls: { desktop: { page: isFallbackArtist
            ? "https://en.wikipedia.org/wiki/Fallback_Muro"
            : isPremiumArtist
              ? "https://en.wikipedia.org/wiki/Premium_Muro"
              : isLastFmArtist
                ? "https://en.wikipedia.org/wiki/LastFm_Muro"
              : "https://en.wikipedia.org/wiki/Muro_(musician)" } },
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url).startsWith("https://ws.audioscrobbler.com/2.0/?")) {
        const requestUrl = new URL(String(url));
        lastFmAuthorization = requestUrl.searchParams.get("api_key");
        assert.equal(requestUrl.searchParams.get("method"), "artist.getinfo");
        assert.equal(requestUrl.searchParams.get("mbid"), lastFmArtistId);
        return new Response(JSON.stringify({
          artist: {
            name: "LastFm Muro",
            mbid: lastFmArtistId,
            url: "http://www.last.fm/music/LastFm+Muro",
            image: [{ size: "extralarge", "#text": "https://lastfm.example/ignored.jpg" }],
            bio: {
              content: "Last.fm &amp; community biography.<br>Built for smoke. <a href=\"https://www.last.fm/music/LastFm+Muro/+wiki\">Read more on Last.fm</a>",
            },
            tags: {
              tag: [{ name: "Techno" }, { name: "Minimal" }, { name: "techno" }],
            },
            similar: {
              artist: [{
                name: "Neighbor One",
                mbid: "55555555-5555-4555-8555-555555555555",
                url: "http://www.last.fm/music/Neighbor+One",
              }],
            },
          },
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url).startsWith("https://api.search.brave.com/res/v1/images/search?")) {
        const requestUrl = new URL(String(url));
        braveAuthorization = options.headers?.["X-Subscription-Token"] ?? null;
        assert.equal(
          requestUrl.searchParams.get("q"),
          "\"Unknown Underground Artist\" musician DJ artist portrait",
        );
        assert.equal(requestUrl.searchParams.get("country"), "ALL");
        assert.equal(requestUrl.searchParams.get("search_lang"), "en");
        assert.equal(requestUrl.searchParams.get("count"), "15");
        assert.equal(requestUrl.searchParams.get("safesearch"), "strict");
        return new Response(JSON.stringify({
          type: "images",
          results: [{
            type: "image_result",
            title: "Unknown Underground Artist press portrait",
            url: "https://label.example/artists/unknown-underground-artist",
            source: "label.example",
            thumbnail: {
              src: "https://imgs.search.brave.com/muro-brave.jpg",
              width: 500,
              height: 500,
            },
            properties: {
              url: "https://label.example/images/unknown-underground-artist.jpg",
              width: 1600,
              height: 1600,
            },
            meta_url: { hostname: "label.example" },
            confidence: "high",
          }],
          extra: { might_be_offensive: false },
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url).startsWith("https://api.deezer.com/search/artist?")) {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.searchParams.get("limit"), "8");
        if (requestUrl.searchParams.get("q") !== "Fallback Muro") {
          return new Response(JSON.stringify({ data: [], total: 0 }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          data: [{
            id: 987654,
            name: "Fallback Muro",
            picture_xl: "https://cdn-images.dzcdn.net/images/artist/fallback/1000x1000.jpg",
          }],
          total: 1,
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url) === `https://www.theaudiodb.com/api/v2/json/lookup/artist_mb/${premiumArtistId}`) {
        theAudioDbAuthorization = options.headers?.["X-API-KEY"] ?? null;
        return new Response(JSON.stringify({
          lookup: [{
            idArtist: "654321",
            strArtist: "Premium Muro",
            intFormedYear: "2005",
            strBiography: "Premium biography supplied by TheAudioDB.",
            strGenre: "Electronic; House",
            strStyle: "Downtempo",
            strCountry: "Germany",
            strArtistThumb: "https://assets.theaudiodb.com/premium-muro.jpg",
            strMusicBrainzID: premiumArtistId,
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url) === `https://webservice.fanart.tv/v3.2/music/${fallbackArtistId}`) {
        fanartAuthorization = options.headers?.["api-key"] ?? null;
        return new Response(JSON.stringify({
          artistthumb: [
            { url: "https://assets.fanart.tv/fallback-low.jpg", likes: "2", width: "1000", height: "1000" },
            { url: "https://assets.fanart.tv/fallback-best.jpg", likes: "12", width: "1000", height: "1000" },
          ],
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url) === `https://webservice.fanart.tv/v3.2/music/${premiumArtistId}`) {
        return new Response(JSON.stringify({
          artistthumb: [{
            url: "https://assets.fanart.tv/premium-fanart.jpg",
            likes: "8",
            width: "1200",
            height: "1200",
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url) === "https://upload.wikimedia.org/muro-smoke.jpg") {
        return new Response(Buffer.from("smoke image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (String(url) === "https://upload.wikimedia.org/muro-commons.jpg") {
        return new Response(Buffer.from("commons artist image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (String(url) === "https://assets.fanart.tv/fallback-best.jpg") {
        return new Response(Buffer.from("fanart smoke image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (String(url) === "https://assets.fanart.tv/fallback-low.jpg") {
        return new Response(Buffer.from("alternate fanart smoke image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (String(url) === "https://assets.fanart.tv/premium-fanart.jpg") {
        return new Response(Buffer.from("preferred fanart smoke image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (String(url) === "https://assets.theaudiodb.com/premium-muro.jpg") {
        return new Response(Buffer.from("theaudiodb smoke image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (String(url) === "https://imgs.search.brave.com/muro-brave.jpg") {
        return new Response(Buffer.from("brave artist image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (
        String(url)
        === "https://cdn-images.dzcdn.net/images/artist/fallback/1000x1000.jpg"
      ) {
        return new Response(Buffer.from("deezer artist image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      throw new Error(`Unexpected artist profile URL: ${url}`);
    },
  });
  const artistProfile = await artistProfileService.getProfile(db, "Muro");
  assert.equal(artistProfile.status, "ready");
  assert.equal(artistProfile.description, "Electronic musician");
  assert.deepEqual(artistProfile.genres, ["electronic", "house"]);
  assert.equal(artistProfile.imageProvider, "wikimedia-commons");
  assert.equal(artistProfile.imageAttribution, "Smoke Photographer");
  assert.equal(artistProfile.imageLicense, "CC BY-SA 4.0");
  assert.equal(
    artistProfile.wikimediaCommonsUrl,
    "https://commons.wikimedia.org/wiki/File:Muro_artist_portrait.jpg",
  );
  assert.ok(fs.existsSync(artistProfile.imagePath), "artist image should be cached on disk");
  const artistFetchCount = artistFetchCalls.length;
  const cachedArtistProfile = await artistProfileService.getProfile(db, "Muro");
  assert.equal(cachedArtistProfile.cacheState, "fresh");
  assert.equal(artistFetchCalls.length, artistFetchCount, "fresh artist profiles should not be fetched again");
  const cachedProfileRow = db.prepare(`
    SELECT profile_json FROM artist_profiles WHERE artist_key = 'muro'
  `).get();
  const legacyCachedProfile = JSON.parse(cachedProfileRow.profile_json);
  delete legacyCachedProfile.profileVersion;
  db.prepare(`
    UPDATE artist_profiles SET profile_json = ? WHERE artist_key = 'muro'
  `).run(JSON.stringify(legacyCachedProfile));
  const fetchCountBeforeProfileUpgrade = artistFetchCalls.length;
  const upgradedArtistProfile = await artistProfileService.getProfile(db, "Muro");
  assert.equal(upgradedArtistProfile.profileVersion, 2);
  assert.ok(
    artistFetchCalls.length > fetchCountBeforeProfileUpgrade,
    "legacy cached profiles should upgrade to the Commons-capable profile version on demand",
  );
  const fallbackWithoutKey = await artistProfileService.getProfile(db, "Fallback Muro");
  assert.equal(fallbackWithoutKey.imageUrl, null);
  assert.equal(fallbackWithoutKey.fanartAttempted, false);
  const fetchCountBeforeAddingFanartKey = artistFetchCalls.length;
  const fallbackProfile = await artistProfileService.getProfile(db, "Fallback Muro", {
    fanartApiKey: "smoke-fanart-key",
  });
  assert.ok(
    artistFetchCalls.length > fetchCountBeforeAddingFanartKey,
    "adding a Fanart.tv key should retry a fresh cached profile that has no image",
  );
  assert.equal(fallbackProfile.imageProvider, "fanart.tv");
  assert.equal(fallbackProfile.fanartAttempted, true);
  assert.equal(fallbackProfile.fanartUrl, `https://fanart.tv/artist/${fallbackArtistId}/`);
  assert.equal(fanartAuthorization, "smoke-fanart-key");
  assert.ok(fs.existsSync(fallbackProfile.imagePath), "Fanart.tv fallback should be cached on disk");
  assert.ok(
    artistFetchCalls.includes("https://assets.fanart.tv/fallback-best.jpg"),
    "the most-liked Fanart.tv artist thumbnail should be selected",
  );
  const fallbackImageCandidates = await artistProfileService.searchImages(db, "Fallback Muro", {
    fanartApiKey: "smoke-fanart-key",
  });
  assert.equal(fallbackImageCandidates.length, 3);
  assert.equal(fallbackImageCandidates[0].current, true);
  const deezerArtistImage = fallbackImageCandidates.find(
    (candidate) => candidate.provider === "deezer",
  );
  assert.ok(deezerArtistImage, "Deezer should add an exact artist-picture candidate");
  assert.equal(deezerArtistImage.sourceName, "Fallback Muro");
  assert.equal(deezerArtistImage.sourceUrl, "https://www.deezer.com/artist/987654");
  const alternateFanart = fallbackImageCandidates.find(
    (candidate) => candidate.imageUrl === "https://assets.fanart.tv/fallback-low.jpg",
  );
  assert.ok(alternateFanart, "manual artist image search should return alternate provider images");
  const manuallySelectedProfile = await artistProfileService.setImage(
    db,
    "Fallback Muro",
    alternateFanart,
  );
  assert.equal(manuallySelectedProfile.imageSelection, "manual");
  assert.equal(manuallySelectedProfile.imageUrl, "https://assets.fanart.tv/fallback-low.jpg");
  assert.ok(fs.existsSync(manuallySelectedProfile.imagePath));
  const refreshedManualProfile = await artistProfileService.getProfile(db, "Fallback Muro", {
    force: true,
    fanartApiKey: "smoke-fanart-key",
  });
  assert.equal(
    refreshedManualProfile.imageUrl,
    "https://assets.fanart.tv/fallback-low.jpg",
    "profile refreshes should preserve manually selected artist pictures",
  );
  const deezerSelectedProfile = await artistProfileService.setImage(
    db,
    "Fallback Muro",
    deezerArtistImage,
  );
  assert.equal(deezerSelectedProfile.imageProvider, "deezer");
  assert.equal(deezerSelectedProfile.imageAttribution, "Deezer");
  assert.equal(deezerSelectedProfile.imageSourceUrl, "https://www.deezer.com/artist/987654");
  const braveImageCandidates = await artistProfileService.searchImages(
    db,
    "Unknown Underground Artist",
    {
      braveSearchApiKey: "smoke-brave-key",
    },
  );
  assert.equal(braveAuthorization, "smoke-brave-key");
  assert.ok(
    artistFetchCalls.every((url) => !url.includes("smoke-brave-key")),
    "Brave credentials should never appear in request URLs",
  );
  const braveImage = braveImageCandidates.find(
    (candidate) => candidate.provider === "brave-search",
  );
  assert.ok(braveImage, "Brave Image Search should add web image candidates");
  assert.equal(braveImage.imageUrl, "https://imgs.search.brave.com/muro-brave.jpg");
  assert.equal(braveImage.sourceName, "label.example");
  assert.equal(braveImage.title, "Unknown Underground Artist press portrait");
  assert.equal(braveImage.width, 1600);
  assert.equal(braveImage.height, 1600);
  assert.ok(braveImage.sourceUrl.startsWith("https://search.brave.com/images?"));
  await assert.rejects(
    artistProfileService.setImage(db, "Unknown Underground Artist", {
      ...braveImage,
      imageUrl: "https://label.example/images/unknown-underground-artist.jpg",
    }),
    /not allowed/,
    "only Brave-proxied image URLs should be accepted",
  );
  const braveSelectedProfile = await artistProfileService.setImage(
    db,
    "Unknown Underground Artist",
    braveImage,
  );
  assert.equal(braveSelectedProfile.status, "not-found");
  assert.equal(braveSelectedProfile.imageProvider, "brave-search");
  assert.equal(braveSelectedProfile.imageAttribution, "label.example");
  assert.equal(braveSelectedProfile.imageSourceUrl, braveImage.sourceUrl);
  assert.ok(fs.existsSync(braveSelectedProfile.imagePath));
  const fallbackFetchCount = artistFetchCalls.length;
  await artistProfileService.getProfile(db, "Fallback Muro", { fanartApiKey: "smoke-fanart-key" });
  assert.equal(artistFetchCalls.length, fallbackFetchCount, "cached Fanart.tv images should not be fetched again");
  const premiumWithoutKey = await artistProfileService.getProfile(db, "Premium Muro");
  assert.equal(premiumWithoutKey.biography, null);
  assert.equal(premiumWithoutKey.imageUrl, null);
  assert.equal(premiumWithoutKey.theAudioDbAttempted, false);
  const fetchCountBeforeAddingTheAudioDbKey = artistFetchCalls.length;
  const premiumProfile = await artistProfileService.getProfile(db, "Premium Muro", {
    theAudioDbApiKey: "smoke-theaudiodb-key",
  });
  assert.ok(
    artistFetchCalls.length > fetchCountBeforeAddingTheAudioDbKey,
    "adding a TheAudioDB key should retry a fresh cached profile on demand",
  );
  assert.equal(theAudioDbAuthorization, "smoke-theaudiodb-key");
  assert.equal(premiumProfile.theAudioDbAttempted, true);
  assert.equal(premiumProfile.theAudioDbId, "654321");
  assert.equal(premiumProfile.theAudioDbUrl, "https://www.theaudiodb.com/artist/654321");
  assert.equal(premiumProfile.biography, "Premium biography supplied by TheAudioDB.");
  assert.equal(premiumProfile.country, "Germany");
  assert.equal(premiumProfile.begin, "2005");
  assert.deepEqual(premiumProfile.genres, ["Electronic", "House", "Downtempo"]);
  assert.equal(premiumProfile.imageProvider, "theaudiodb");
  assert.ok(fs.existsSync(premiumProfile.imagePath), "TheAudioDB artwork should be cached on disk");
  assert.ok(
    artistFetchCalls.every((url) => !url.includes("smoke-theaudiodb-key")),
    "TheAudioDB credentials should never appear in request URLs",
  );
  const premiumWithFanart = await artistProfileService.getProfile(db, "Premium Muro", {
    fanartApiKey: "smoke-fanart-key",
    theAudioDbApiKey: "smoke-theaudiodb-key",
  });
  assert.equal(
    premiumWithFanart.imageProvider,
    "fanart.tv",
    "Fanart.tv should be preferred over TheAudioDB when both provide artist images",
  );
  assert.equal(premiumWithFanart.biography, "Premium biography supplied by TheAudioDB.");
  const premiumFetchCount = artistFetchCalls.length;
  await artistProfileService.getProfile(db, "Premium Muro", {
    theAudioDbApiKey: "smoke-theaudiodb-key",
  });
  assert.equal(
    artistFetchCalls.length,
    premiumFetchCount,
    "cached TheAudioDB profiles should not be fetched again",
  );
  const lastFmWithoutKey = await artistProfileService.getProfile(db, "LastFm Muro");
  assert.equal(lastFmWithoutKey.biography, null);
  assert.equal(lastFmWithoutKey.lastFmAttempted, false);
  const fetchCountBeforeAddingLastFmKey = artistFetchCalls.length;
  const lastFmProfile = await artistProfileService.getProfile(db, "LastFm Muro", {
    lastFmApiKey: "smoke-lastfm-key",
  });
  assert.ok(
    artistFetchCalls.length > fetchCountBeforeAddingLastFmKey,
    "adding a Last.fm key should retry a fresh cached profile on demand",
  );
  assert.equal(lastFmAuthorization, "smoke-lastfm-key");
  assert.equal(lastFmProfile.lastFmAttempted, true);
  assert.equal(lastFmProfile.lastFmUrl, "https://www.last.fm/music/LastFm+Muro");
  assert.equal(lastFmProfile.biography, "Last.fm & community biography. Built for smoke.");
  assert.deepEqual(lastFmProfile.genres, ["Techno", "Minimal"]);
  assert.deepEqual(lastFmProfile.similarArtists, [{
    name: "Neighbor One",
    musicBrainzId: "55555555-5555-4555-8555-555555555555",
    url: "https://www.last.fm/music/Neighbor+One",
  }]);
  assert.equal(lastFmProfile.imageUrl, null, "Last.fm artwork must not be used");
  const lastFmFetchCount = artistFetchCalls.length;
  await artistProfileService.getProfile(db, "LastFm Muro", {
    lastFmApiKey: "smoke-lastfm-key",
  });
  assert.equal(
    artistFetchCalls.length,
    lastFmFetchCount,
    "cached Last.fm profiles should not be fetched again",
  );
  assert.deepEqual(
    artistProfileService.loadCachedProfiles(db).map((profile) => profile.artistKey),
    ["fallback muro", "lastfm muro", "muro", "premium muro", "unknown underground artist"],
  );
  db.prepare("UPDATE artist_profiles SET fetched_at = 0 WHERE artist_key = ?").run("muro");
  const fetchCountBeforeStaleBackgroundScan = artistFetchCalls.length;
  assert.equal(
    (await artistProfileService.scanProfiles(db, {
      limit: 1,
      theAudioDbApiKey: "smoke-theaudiodb-key",
    })).checked,
    0,
    "background scans should not refresh an existing stale profile",
  );
  assert.equal(
    artistFetchCalls.length,
    fetchCountBeforeStaleBackgroundScan,
    "stale profiles should remain local until their artist page requests them",
  );
  await artistProfileService.getProfile(db, "Muro");
  assert.ok(
    artistFetchCalls.length > fetchCountBeforeStaleBackgroundScan,
    "opening an artist should refresh its stale profile",
  );
  const periodicSourcePath = path.join(directory, "periodic.mp3");
  insertTrack.run(
    "track-periodic",
    "Periodic Test",
    "Periodic Muro",
    "Background Checks",
    "periodic.mp3",
    periodicSourcePath,
    90,
    320,
    now,
    now,
  );
  const backgroundScan = await artistProfileService.scanProfiles(db, { limit: 1 });
  assert.deepEqual(backgroundScan, {
    checked: 1,
    updated: 1,
    failed: 0,
    queued: 0,
    remaining: 0,
    totalArtists: 2,
  });
  assert.ok(
    artistProfileService.loadCachedProfiles(db).some((profile) => profile.artistKey === "periodic muro"),
    "background scans should persist newly discovered artists",
  );
  assert.equal((await artistProfileService.scanProfiles(db, { limit: 1 })).checked, 0);
  db.prepare("DELETE FROM tracks WHERE id = ?").run("track-periodic");

  assert.equal((await backend.invoke("keyfinder_health", {})).service, "keyfinder-native");
  const analysisSettings = {
    performance: "fast",
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
    (await backend.invoke("generate_track_waveform", { sourcePath: firstSourcePath, points: 64 })).peaks.length,
    64,
  );
  await backend.invoke("generate_track_waveform", { sourcePath: firstSourcePath, points: 64 });
  assert.equal(waveformGenerationCount, 1, "same waveform should be loaded from the disk cache");
  assert.ok(
    fs.readdirSync(path.join(directory, "waveforms")).some((entry) => entry.endsWith(".json")),
    "waveform peaks should be persisted on disk",
  );

  await backend.invoke("generate_track_waveform", { sourcePath: firstSourcePath, points: 128 });
  assert.equal(waveformGenerationCount, 2, "a different point count should generate a new waveform");

  fs.appendFileSync(firstSourcePath, " updated");
  await backend.invoke("generate_track_waveform", { sourcePath: firstSourcePath, points: 64 });
  assert.equal(waveformGenerationCount, 3, "source metadata changes should invalidate cached peaks");

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
  await backend.invoke("clear_tracks", { dbPath });
  assert.equal(fs.existsSync(path.join(directory, "waveforms")), false);
} finally {
  backend.close();
  assert.equal(keyFinderClosed, true);
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log("Backend smoke test passed");
