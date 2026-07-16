import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createArtistProfileService } from "../electron/artistProfiles.mjs";
import { createBackend } from "../electron/backend.mjs";
import { openDatabase } from "../electron/database.mjs";
import { registerMediaShortcuts } from "../electron/mediaShortcuts.mjs";

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
let keyFinderClosed = false;
let keyFinderStartArguments;
let waveformGenerationCount = 0;
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
});

try {
  const db = openDatabase(dbPath);
  const now = Math.floor(Date.now() / 1000);
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
  assert.deepEqual(playlists.folders, [{ id: "folder-1", name: "Weekend Sets" }]);
  assert.equal(playlists.playlists[0].folder_id, "folder-1");

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
  assert.deepEqual(playlists.folders, []);
  assert.equal(playlists.playlists[0].folder_id, null);

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
  let fanartAuthorization = null;
  let theAudioDbAuthorization = null;
  const artistProfileService = createArtistProfileService({
    cacheDir: path.join(directory, "artist-profile-cache"),
    musicBrainzIntervalMs: 0,
    fetchImpl: async (url, options = {}) => {
      artistFetchCalls.push(String(url));
      if (String(url).startsWith("https://musicbrainz.org/ws/2/artist/?")) {
        const requestedArtist = new URL(String(url)).searchParams.get("query");
        const isFallbackArtist = requestedArtist === "Fallback Muro";
        const isPremiumArtist = requestedArtist === "Premium Muro";
        return new Response(JSON.stringify({
          artists: [{
            id: isFallbackArtist
              ? fallbackArtistId
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
      ) {
        const isFallbackArtist = String(url).includes(fallbackArtistId);
        const isPremiumArtist = String(url).includes(premiumArtistId);
        return new Response(JSON.stringify({
          id: isFallbackArtist ? fallbackArtistId : isPremiumArtist ? premiumArtistId : artistId,
          name: isFallbackArtist ? "Fallback Muro" : isPremiumArtist ? "Premium Muro" : "Muro",
          type: "Person",
          country: isPremiumArtist ? null : "DE",
          area: isPremiumArtist ? null : { name: "Berlin" },
          "life-span": isPremiumArtist ? {} : { begin: "1990" },
          genres: isPremiumArtist ? [] : [{ name: "electronic" }, { name: "house" }],
          relations: [{
            type: "wikipedia",
            url: { resource: isFallbackArtist
              ? "https://en.wikipedia.org/wiki/Fallback_Muro"
              : isPremiumArtist
                ? "https://en.wikipedia.org/wiki/Premium_Muro"
                : "https://en.wikipedia.org/wiki/Muro_(musician)" },
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      if (String(url).includes("/api/rest_v1/page/summary/")) {
        const isFallbackArtist = String(url).includes("Fallback_Muro");
        const isPremiumArtist = String(url).includes("Premium_Muro");
        return new Response(JSON.stringify({
          extract: isPremiumArtist
            ? null
            : `${isFallbackArtist ? "Fallback Muro" : "Muro"} is an electronic musician used by the smoke test.`,
          description: isPremiumArtist ? null : "Electronic musician",
          thumbnail: isFallbackArtist || isPremiumArtist
            ? undefined
            : { source: "https://upload.wikimedia.org/muro-smoke.jpg" },
          content_urls: { desktop: { page: isFallbackArtist
            ? "https://en.wikipedia.org/wiki/Fallback_Muro"
            : isPremiumArtist
              ? "https://en.wikipedia.org/wiki/Premium_Muro"
              : "https://en.wikipedia.org/wiki/Muro_(musician)" } },
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
      if (String(url) === "https://upload.wikimedia.org/muro-smoke.jpg") {
        return new Response(Buffer.from("smoke image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (String(url) === "https://assets.fanart.tv/fallback-best.jpg") {
        return new Response(Buffer.from("fanart smoke image"), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (String(url) === "https://assets.theaudiodb.com/premium-muro.jpg") {
        return new Response(Buffer.from("theaudiodb smoke image"), {
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
  assert.ok(fs.existsSync(artistProfile.imagePath), "artist image should be cached on disk");
  const artistFetchCount = artistFetchCalls.length;
  const cachedArtistProfile = await artistProfileService.getProfile(db, "Muro");
  assert.equal(cachedArtistProfile.cacheState, "fresh");
  assert.equal(artistFetchCalls.length, artistFetchCount, "fresh artist profiles should not be fetched again");
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
  const premiumFetchCount = artistFetchCalls.length;
  await artistProfileService.getProfile(db, "Premium Muro", {
    theAudioDbApiKey: "smoke-theaudiodb-key",
  });
  assert.equal(
    artistFetchCalls.length,
    premiumFetchCount,
    "cached TheAudioDB profiles should not be fetched again",
  );
  assert.deepEqual(
    artistProfileService.loadCachedProfiles(db).map((profile) => profile.artistKey),
    ["fallback muro", "muro", "premium muro"],
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
