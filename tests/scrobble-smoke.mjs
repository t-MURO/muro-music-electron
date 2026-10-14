import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabases, openDatabase } from "../electron/database.mjs";
import { createBackend } from "../electron/backend.mjs";
import { createCredentialStore } from "../electron/scrobbling/credentials.mjs";
import { lastFmSignature } from "../electron/scrobbling/lastfm.mjs";
import { listenBrainzPayload } from "../electron/scrobbling/listenbrainz.mjs";
import {
  SCROBBLE_RETRY_MAX_DELAY_MS,
  deferScrobbles,
  enqueueScrobble,
  pendingScrobbles,
  scrobbleQueueSummary,
  scrobbleRetryDelayMs,
} from "../electron/scrobbling/scrobbleQueue.mjs";
import {
  createScrobbleService,
  scrobbleThresholdSeconds,
} from "../electron/scrobbling/scrobbleService.mjs";

const md5 = (value) => crypto.createHash("md5").update(value, "utf8").digest("hex");

// --- Scrobble threshold ------------------------------------------------------
{
  // Tracks of 30 seconds or less are never scrobbled.
  assert.equal(scrobbleThresholdSeconds(30), null);
  assert.equal(scrobbleThresholdSeconds(12), null);
  assert.equal(scrobbleThresholdSeconds(undefined), null);
  assert.equal(scrobbleThresholdSeconds(Number.NaN), null);
  // Half the duration, or four minutes for anything longer than eight.
  assert.equal(scrobbleThresholdSeconds(31), 15.5);
  assert.equal(scrobbleThresholdSeconds(200), 100);
  assert.equal(scrobbleThresholdSeconds(480), 240);
  assert.equal(scrobbleThresholdSeconds(3600), 240);
}

// --- Last.fm signature -------------------------------------------------------
{
  const params = { api_key: "key123", method: "auth.getSession", token: "tok456" };
  assert.equal(
    lastFmSignature(params, "s3cret"),
    md5("api_keykey123methodauth.getSessiontokentok456s3cret"),
  );
  // format and callback are never signed.
  assert.equal(
    lastFmSignature({ ...params, format: "json", callback: "cb" }, "s3cret"),
    lastFmSignature(params, "s3cret"),
  );
  // Byte-order sorting puts artist[10] before artist[1] (0x30 < 0x5d), as the
  // Last.fm docs require for batches.
  const batch = { "artist[1]": "B", "artist[10]": "K", "artist[0]": "A", sk: "S" };
  assert.equal(lastFmSignature(batch, "x"), md5("artist[0]Aartist[10]Kartist[1]BskSx"));
  // Values are hashed as UTF-8.
  assert.equal(lastFmSignature({ track: "Björk – Jóga" }, "x"), md5("trackBjörk – Jógax"));
}

// --- ListenBrainz payloads ---------------------------------------------------
{
  const item = {
    artist: "Muro",
    title: "Smoke",
    album: "Tests",
    startedAt: 1_800_000_000,
    durationSeconds: 201.4,
    trackNumber: 3,
    recordingMbid: "not-a-uuid",
    releaseMbid: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
  };
  const now = listenBrainzPayload("playing_now", [item], "1.0.0");
  assert.equal(now.listen_type, "playing_now");
  assert.equal("listened_at" in now.payload[0], false, "playing_now must not carry a timestamp");
  const single = listenBrainzPayload("single", [item], "1.0.0").payload[0];
  assert.equal(single.listened_at, 1_800_000_000);
  assert.equal(single.track_metadata.release_name, "Tests");
  assert.equal(single.track_metadata.additional_info.duration_ms, 201_400);
  assert.equal(single.track_metadata.additional_info.tracknumber, "3");
  // Malformed MBIDs are left out rather than getting the listen refused.
  assert.equal("recording_mbid" in single.track_metadata.additional_info, false);
  assert.equal(
    single.track_metadata.additional_info.release_mbid,
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  );
}

// --- Backoff -----------------------------------------------------------------
{
  assert.equal(scrobbleRetryDelayMs(1), 30_000);
  assert.equal(scrobbleRetryDelayMs(2), 60_000);
  assert.equal(scrobbleRetryDelayMs(3), 120_000);
  assert.equal(scrobbleRetryDelayMs(40), SCROBBLE_RETRY_MAX_DELAY_MS);
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-scrobble-smoke-"));
const dbPath = path.join(directory, "library.db");

const insertTrack = (db, id, { title, duration = 200, artist = "Muro Artist" } = {}) =>
  db
    .prepare(
      `
    INSERT INTO tracks(
      id, title, artist, album, album_artist, filename, source_path, import_status,
      duration_seconds, track_number, musicbrainz_trackid, added_at, updated_at
    ) VALUES (?, ?, ?, 'Smoke Album', 'Muro Artist', ?, ?, 'accepted', ?, 4, ?, 1, 1)
  `,
    )
    .run(
      id,
      title ?? `Song ${id}`,
      artist,
      `${id}.flac`,
      path.join(directory, `${id}.flac`),
      duration,
      "11111111-2222-4333-8444-555555555555",
    );

// A reversible stand-in for Electron safeStorage.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${Buffer.from(value).toString("hex")}`),
  decryptString: (buffer) => {
    const text = buffer.toString();
    assert.ok(text.startsWith("enc:"));
    return Buffer.from(text.slice(4), "hex").toString();
  },
};

// --- Credential storage ------------------------------------------------------
{
  const filePath = path.join(directory, "scrobbling.json");
  const store = createCredentialStore({ filePath, safeStorage: fakeSafeStorage });
  assert.equal(store.storage(), "encrypted");
  store.update("listenbrainz", { enabled: true, userName: "muro", secret: "lb-token-secret" });
  const saved = fs.readFileSync(filePath, "utf8");
  assert.equal(saved.includes("lb-token-secret"), false, "secrets must not be written in clear");
  const reloaded = createCredentialStore({ filePath, safeStorage: fakeSafeStorage });
  assert.equal(reloaded.get("listenbrainz").secret, "lb-token-secret");
  assert.equal(reloaded.get("listenbrainz").needsReconnect, false);

  // Without a secret store the token lasts only for the session, and the next
  // start asks the user to reconnect instead of silently losing the account.
  const plainPath = path.join(directory, "scrobbling-plain.json");
  const sessionOnly = createCredentialStore({
    filePath: plainPath,
    safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false },
  });
  assert.equal(sessionOnly.storage(), "session");
  sessionOnly.update("lastfm", { enabled: true, userName: "muro", secret: "session-key" });
  assert.equal(sessionOnly.get("lastfm").secret, "session-key");
  assert.equal(fs.readFileSync(plainPath, "utf8").includes("session-key"), false);
  const afterRestart = createCredentialStore({ filePath: plainPath, safeStorage: null });
  assert.equal(afterRestart.get("lastfm").secret, null);
  assert.equal(afterRestart.get("lastfm").needsReconnect, true);

  // Linux without a keyring uses a hard-coded key; treat it as unavailable.
  const basicText = createCredentialStore({
    filePath,
    safeStorage: { ...fakeSafeStorage, getSelectedStorageBackend: () => "basic_text" },
  });
  assert.equal(basicText.storage(), "session");
}

// --- Scrobble service with a mocked network ----------------------------------
const db = openDatabase(dbPath);
insertTrack(db, "long", { title: "Long Song", duration: 600 });
insertTrack(db, "short", { title: "Short Song", duration: 25 });
for (let index = 0; index < 4; index += 1) insertTrack(db, `t${index}`);

let clock = 1_800_000_000_000;
const requests = [];
const responders = { lastfm: [], listenbrainz: [] };
const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
const fetchImpl = async (url, options = {}) => {
  const target = String(url);
  if (target.startsWith("https://ws.audioscrobbler.com/2.0/")) {
    assert.equal(options.method, "POST");
    const params = Object.fromEntries(new URLSearchParams(String(options.body)));
    const { api_sig: signature, ...signed } = params;
    assert.equal(signature, lastFmSignature(signed, "shared-secret"), "every call is signed");
    assert.equal(params.format, "json");
    requests.push({ service: "lastfm", method: params.method, params });
    const responder = responders.lastfm.shift();
    assert.ok(responder, `unexpected Last.fm call ${params.method}`);
    return responder(params);
  }
  if (target.startsWith("https://api.listenbrainz.org/1/")) {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      service: "listenbrainz",
      endpoint: target.slice("https://api.listenbrainz.org/1/".length),
      authorization: options.headers?.Authorization,
      body,
    });
    const responder = responders.listenbrainz.shift();
    assert.ok(responder, `unexpected ListenBrainz call ${target}`);
    return responder(body);
  }
  throw new Error(`Unexpected request to ${target}`);
};

const lastFmScrobbleResponse = (count, ignored = {}) =>
  jsonResponse({
    scrobbles: {
      "@attr": { accepted: count - Object.keys(ignored).length, ignored: 0 },
      scrobble: Array.from({ length: count }, (_value, index) => ({
        ignoredMessage: ignored[index]
          ? { code: String(ignored[index]), "#text": "Artist was ignored" }
          : { code: "0", "#text": "" },
      })),
    },
  });

const statusEvents = [];
const openedUrls = [];
const timers = [];
const credentialsPath = path.join(directory, "service-credentials.json");
const createService = () =>
  createScrobbleService({
    getDb: () => openDatabase(dbPath),
    credentials: createCredentialStore({
      filePath: credentialsPath,
      safeStorage: fakeSafeStorage,
    }),
    fetchImpl,
    openExternal: async (url) => openedUrls.push(url),
    onStatusChange: (status) => statusEvents.push(status),
    clientVersion: "9.9.9",
    now: () => clock,
    setTimer: (callback, delayMs) => {
      const timer = { callback, delayMs };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer);
      if (index !== -1) timers.splice(index, 1);
    },
  });
let service = createService();
const { commands } = service;

const takeRequests = () => requests.splice(0, requests.length);

// Nothing is connected yet: no network traffic, nothing queued.
{
  const status = commands.scrobble_configure({
    lastFmApiKey: "api-key",
    lastFmSharedSecret: "shared-secret",
  });
  assert.equal(status.lastfm.configured, true);
  assert.equal(status.lastfm.connected, false);
  assert.equal(status.credentialStorage, "encrypted");
  const result = commands.scrobble_submit({
    trackId: "long",
    startedAt: clock - 300_000,
    listenedSeconds: 300,
  });
  assert.deepEqual(result, { queued: 0 });
  await service.idle();
  assert.equal(takeRequests().length, 0);
}

// ListenBrainz: token validation.
{
  assert.equal(
    (await commands.scrobble_listenbrainz_connect({ token: "  " })).error,
    "missing-token",
  );
  responders.listenbrainz.push(() => jsonResponse({ code: 200, valid: false }));
  const invalid = await commands.scrobble_listenbrainz_connect({ token: "bad-token" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "invalid-token");
  responders.listenbrainz.push(() =>
    jsonResponse({ code: 200, message: "Token valid.", valid: true, user_name: "muro-user" }),
  );
  const connected = await commands.scrobble_listenbrainz_connect({ token: "lb-token" });
  assert.equal(connected.ok, true);
  assert.equal(connected.status.listenbrainz.connected, true);
  assert.equal(connected.status.listenbrainz.userName, "muro-user");
  assert.equal(connected.status.listenbrainz.enabled, true);
  const [, validation] = takeRequests();
  assert.equal(validation.endpoint, "validate-token");
  assert.equal(validation.authorization, "Token lb-token");
  // Status never exposes the token.
  assert.equal(JSON.stringify(connected.status).includes("lb-token"), false);
}

// Last.fm desktop auth: token, browser approval, session.
{
  responders.lastfm.push(() => jsonResponse({ token: "auth-token" }));
  const begun = await commands.scrobble_lastfm_begin_auth();
  assert.equal(begun.ok, true);
  assert.equal(begun.status.lastfm.awaitingAuthorization, true);
  const opened = new URL(openedUrls.at(-1));
  assert.equal(opened.origin + opened.pathname, "https://www.last.fm/api/auth/");
  assert.equal(opened.searchParams.get("api_key"), "api-key");
  assert.equal(opened.searchParams.get("token"), "auth-token");

  // Finishing before the user approved it in the browser.
  responders.lastfm.push(() =>
    jsonResponse(
      { error: 14, message: "Unauthorized Token - This token has not been issued" },
      403,
    ),
  );
  const early = await commands.scrobble_lastfm_complete_auth();
  assert.equal(early.error, "not-authorized");
  assert.equal(early.status.lastfm.awaitingAuthorization, true);

  responders.lastfm.push((params) => {
    assert.equal(params.token, "auth-token");
    return jsonResponse({ session: { name: "MuroFm", key: "session-key", subscriber: 0 } });
  });
  const finished = await commands.scrobble_lastfm_complete_auth();
  assert.equal(finished.ok, true);
  assert.equal(finished.status.lastfm.userName, "MuroFm");
  assert.equal(finished.status.lastfm.connected, true);
  assert.equal(finished.status.lastfm.awaitingAuthorization, false);
  await service.idle();
  assert.deepEqual(
    takeRequests().map((request) => request.method),
    ["auth.getToken", "auth.getSession", "auth.getSession"],
  );
  const savedCredentials = fs.readFileSync(credentialsPath, "utf8");
  assert.equal(savedCredentials.includes("session-key"), false);
  assert.equal(savedCredentials.includes("lb-token"), false);
}

// Now playing goes to both services, untimestamped, and is never queued.
{
  responders.lastfm.push(() => jsonResponse({ nowplaying: {} }));
  responders.listenbrainz.push(() => jsonResponse({ status: "ok" }));
  const result = await commands.scrobble_now_playing({ trackId: "long" });
  assert.deepEqual(result.sent.sort(), ["lastfm", "listenbrainz"]);
  const sent = takeRequests();
  const lastFmNowPlaying = sent.find((request) => request.service === "lastfm");
  assert.equal(lastFmNowPlaying.method, "track.updateNowPlaying");
  assert.equal(lastFmNowPlaying.params.sk, "session-key");
  assert.equal(lastFmNowPlaying.params.track, "Long Song");
  assert.equal(lastFmNowPlaying.params.duration, "600");
  assert.equal("timestamp" in lastFmNowPlaying.params, false);
  const listenBrainzNowPlaying = sent.find((request) => request.service === "listenbrainz");
  assert.equal(listenBrainzNowPlaying.body.listen_type, "playing_now");
  assert.equal("listened_at" in listenBrainzNowPlaying.body.payload[0], false);
  // A failed now-playing update is dropped silently.
  responders.lastfm.push(() => jsonResponse({ error: 16, message: "Temporary error" }, 503));
  responders.listenbrainz.push(() => {
    throw new TypeError("fetch failed");
  });
  assert.deepEqual((await commands.scrobble_now_playing({ trackId: "long" })).sent, []);
  takeRequests();
  assert.equal(scrobbleQueueSummary(db, "lastfm").pending, 0);
}

// Threshold rules are enforced again in the main process.
{
  assert.equal(
    commands.scrobble_submit({ trackId: "short", startedAt: clock, listenedSeconds: 25 }).skipped,
    "too-short",
  );
  assert.equal(
    commands.scrobble_submit({ trackId: "long", startedAt: clock, listenedSeconds: 120 }).skipped,
    "not-enough-listening",
  );
  assert.equal(
    commands.scrobble_submit({ trackId: "missing", startedAt: clock, listenedSeconds: 600 })
      .skipped,
    "unknown-track",
  );
  await service.idle();
  assert.equal(takeRequests().length, 0);
}

// An accepted play is sent once to each service with the time it started.
{
  const startedAt = clock - 250_000;
  responders.lastfm.push(() => lastFmScrobbleResponse(1));
  responders.listenbrainz.push(() => jsonResponse({ status: "ok" }));
  const result = commands.scrobble_submit({ trackId: "long", startedAt, listenedSeconds: 240 });
  assert.equal(result.queued, 2);
  await service.idle();
  const sent = takeRequests();
  const scrobble = sent.find((request) => request.service === "lastfm");
  assert.equal(scrobble.method, "track.scrobble");
  assert.equal(scrobble.params["timestamp[0]"], String(Math.floor(startedAt / 1000)));
  assert.equal(scrobble.params["artist[0]"], "Muro Artist");
  assert.equal(scrobble.params["track[0]"], "Long Song");
  assert.equal(scrobble.params["album[0]"], "Smoke Album");
  // Album artist is only sent when it differs from the track artist.
  assert.equal("albumArtist[0]" in scrobble.params, false);
  assert.equal(scrobble.params["mbid[0]"], "11111111-2222-4333-8444-555555555555");
  const listen = sent.find((request) => request.service === "listenbrainz");
  assert.equal(listen.body.listen_type, "single");
  assert.equal(listen.body.payload[0].listened_at, Math.floor(startedAt / 1000));
  assert.equal(
    listen.body.payload[0].track_metadata.additional_info.submission_client_version,
    "9.9.9",
  );
  assert.equal(scrobbleQueueSummary(db, "lastfm").pending, 0);
  assert.equal(scrobbleQueueSummary(db, "listenbrainz").pending, 0);
}

// Offline: network errors and 5xx keep plays queued and back off.
{
  const startedAt = clock - 400_000;
  responders.lastfm.push(() => {
    throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
  });
  responders.listenbrainz.push(() => jsonResponse({ code: 503, error: "Down" }, 503));
  commands.scrobble_submit({ trackId: "t0", startedAt, listenedSeconds: 100 });
  // Submitting the identical play while it is queued is ignored.
  assert.equal(
    commands.scrobble_submit({ trackId: "t0", startedAt, listenedSeconds: 100 }).queued,
    0,
  );
  await service.idle();
  takeRequests();
  const lastFmQueue = scrobbleQueueSummary(db, "lastfm");
  assert.equal(lastFmQueue.pending, 1);
  assert.equal(lastFmQueue.retryAt, clock + 30_000);
  assert.equal(scrobbleQueueSummary(db, "listenbrainz").retryAt, clock + 30_000);
  const status = commands.scrobble_get_status();
  assert.match(status.lastfm.lastError, /unreachable \(ENOTFOUND\)/);
  assert.match(status.listenbrainz.lastError, /HTTP 503/);
  // A retry timer is armed for each service.
  assert.deepEqual(
    timers.map((timer) => timer.delayMs),
    [30_000, 30_000],
  );

  // New plays wait behind the backoff instead of overtaking the queue.
  commands.scrobble_submit({ trackId: "t1", startedAt: startedAt + 1_000, listenedSeconds: 100 });
  await service.idle();
  assert.equal(takeRequests().length, 0, "nothing is sent while backing off");
  assert.equal(scrobbleQueueSummary(db, "lastfm").pending, 2);

  // Second failure doubles the delay.
  clock += 30_000;
  responders.lastfm.push(() => jsonResponse({ error: 11, message: "Service Offline" }, 503));
  responders.listenbrainz.push(() =>
    jsonResponse({ error: "Slow down" }, 429, { "X-RateLimit-Reset-In": "120" }),
  );
  await Promise.all(timers.splice(0).map((timer) => timer.callback()));
  await service.idle();
  takeRequests();
  assert.equal(scrobbleQueueSummary(db, "lastfm").retryAt, clock + 60_000);
  // A rate limit waits at least as long as the service asks.
  assert.equal(scrobbleQueueSummary(db, "listenbrainz").retryAt, clock + 120_000);
}

// The queue survives a restart; the startup flush sends it as one batch.
{
  service.close();
  closeDatabases();
  const reopened = openDatabase(dbPath);
  const persisted = pendingScrobbles(reopened, "lastfm", 50);
  assert.deepEqual(
    persisted.map((item) => [item.trackId, item.startedAt, item.attempts]),
    [
      ["t0", Math.floor((clock - 30_000 - 400_000) / 1000), 2],
      ["t1", Math.floor((clock - 30_000 - 399_000) / 1000), 1],
    ],
  );
  assert.equal(pendingScrobbles(reopened, "listenbrainz", 50).length, 2);

  timers.splice(0);
  service = createService();
  Object.assign(commands, service.commands);
  // Configuring at startup flushes, but the backoff is still in force.
  commands.scrobble_configure({ lastFmApiKey: "api-key", lastFmSharedSecret: "shared-secret" });
  await service.idle();
  assert.equal(takeRequests().length, 0);

  // "Retry now" ignores the backoff.
  responders.lastfm.push(() => lastFmScrobbleResponse(2));
  responders.listenbrainz.push(() => jsonResponse({ status: "ok" }));
  const flushed = await commands.scrobble_flush({ force: true });
  const sent = takeRequests();
  const batch = sent.find((request) => request.service === "lastfm");
  assert.equal(batch.params["track[0]"], "Song t0");
  assert.equal(batch.params["track[1]"], "Song t1");
  const imported = sent.find((request) => request.service === "listenbrainz");
  assert.equal(imported.body.listen_type, "import");
  assert.equal(imported.body.payload.length, 2);
  assert.equal(flushed.lastfm.pending, 0);
  assert.equal(flushed.listenbrainz.pending, 0);
  assert.equal(flushed.lastfm.lastError, null);
}

// Permanently rejected plays are dropped with the reason; the rest go through.
{
  responders.lastfm.push(() => lastFmScrobbleResponse(2, { 0: 1 }));
  // ListenBrainz refuses the batch, so each play is retried on its own.
  responders.listenbrainz.push(() => jsonResponse({ code: 400, error: "Invalid listen" }, 400));
  responders.listenbrainz.push(() => jsonResponse({ code: 400, error: "Invalid listen" }, 400));
  responders.listenbrainz.push(() => jsonResponse({ status: "ok" }));
  // Queue two plays directly so both are sent in a single batch.
  const db2 = openDatabase(dbPath);
  for (const [index, trackId] of ["t2", "t3"].entries()) {
    for (const target of ["lastfm", "listenbrainz"]) {
      enqueueScrobble(
        db2,
        target,
        {
          trackId,
          startedAt: Math.floor(clock / 1000) - 1_000 + index,
          artist: "Muro Artist",
          title: `Song ${trackId}`,
          durationSeconds: 200,
        },
        clock,
      );
    }
  }
  await commands.scrobble_flush({});
  const sent = takeRequests();
  assert.equal(sent.filter((request) => request.service === "listenbrainz").length, 3);
  const lastFmQueue = scrobbleQueueSummary(db2, "lastfm");
  assert.equal(lastFmQueue.pending, 0);
  assert.equal(lastFmQueue.dropped, 1);
  assert.equal(lastFmQueue.lastDropped.title, "Song t2");
  assert.match(lastFmQueue.lastDropped.reason, /Ignored by Last\.fm \(code 1\)/);
  const listenBrainzQueue = scrobbleQueueSummary(db2, "listenbrainz");
  assert.equal(listenBrainzQueue.pending, 0);
  assert.equal(listenBrainzQueue.dropped, 1);
  assert.match(listenBrainzQueue.lastDropped.reason, /HTTP 400: Invalid listen/);
}

// An invalid session pauses sending, keeps the queue and asks to reconnect.
{
  statusEvents.splice(0);
  responders.lastfm.push(() =>
    jsonResponse({ error: 9, message: "Invalid session key - Please re-authenticate" }, 403),
  );
  responders.listenbrainz.push(() => jsonResponse({ code: 401, error: "Invalid token" }, 401));
  commands.scrobble_submit({ trackId: "t2", startedAt: clock - 120_000, listenedSeconds: 110 });
  await service.idle();
  takeRequests();
  const status = commands.scrobble_get_status();
  for (const target of ["lastfm", "listenbrainz"]) {
    assert.equal(status[target].needsReconnect, true);
    assert.equal(status[target].pending, 1);
    assert.equal(status[target].connected, true);
  }
  assert.match(status.lastfm.reconnectReason, /Last\.fm error 9/);
  assert.ok(statusEvents.some((event) => event.lastfm.needsReconnect));

  // While paused nothing is sent, not even with "Retry now", but plays queue up.
  commands.scrobble_submit({ trackId: "t3", startedAt: clock - 60_000, listenedSeconds: 110 });
  await commands.scrobble_flush({ force: true });
  await commands.scrobble_now_playing({ trackId: "t3" });
  assert.equal(takeRequests().length, 0);
  assert.equal(scrobbleQueueSummary(openDatabase(dbPath), "lastfm").pending, 2);

  // Reconnecting resumes sending the queue.
  responders.listenbrainz.push(() => jsonResponse({ valid: true, user_name: "muro-user" }));
  responders.listenbrainz.push(() => jsonResponse({ status: "ok" }));
  const reconnected = await commands.scrobble_listenbrainz_connect({ token: "new-token" });
  assert.equal(reconnected.status.listenbrainz.needsReconnect, false);
  await service.idle();
  const sent = takeRequests();
  assert.equal(sent.at(-1).authorization, "Token new-token");
  assert.equal(sent.at(-1).body.payload.length, 2);
  assert.equal(scrobbleQueueSummary(openDatabase(dbPath), "listenbrainz").pending, 0);

  // Disconnecting forgets the account but keeps queued plays.
  const disconnected = commands.scrobble_disconnect({ service: "lastfm" });
  assert.equal(disconnected.lastfm.connected, false);
  assert.equal(disconnected.lastfm.userName, null);
  assert.equal(disconnected.lastfm.pending, 2);
  assert.equal(fs.readFileSync(credentialsPath, "utf8").includes("MuroFm"), false);
  assert.throws(() => commands.scrobble_disconnect({ service: "spotify" }), /Unknown/);
}

service.close();

// --- Backend wiring ----------------------------------------------------------
{
  const backend = createBackend({
    dbPath,
    cacheDir: path.join(directory, "covers"),
    emit: () => {},
    keyFinder: { close: () => {} },
  });
  const status = await backend.invoke("scrobble_get_status", {});
  assert.equal(status.credentialStorage, "session", "no safeStorage means memory-only secrets");
  assert.equal(status.lastfm.connected, false);
  assert.equal(typeof status.lastfm.pending, "number");
  backend.close();
}

// --- Queue helpers -----------------------------------------------------------
{
  const queueDb = openDatabase(path.join(directory, "queue.db"));
  const id = enqueueScrobble(queueDb, "lastfm", {
    startedAt: 1_700_000_000,
    artist: "A",
    title: "T",
  });
  assert.equal(
    enqueueScrobble(queueDb, "lastfm", { startedAt: 1_700_000_000, artist: "A", title: "T" }),
    null,
  );
  const first = deferScrobbles(queueDb, [id], { now: 1_000, error: "offline" });
  assert.equal(first, 1_000 + 30_000);
  const second = deferScrobbles(queueDb, [id], { now: 2_000, error: "offline" });
  assert.equal(second, 2_000 + 60_000);
  assert.equal(pendingScrobbles(queueDb, "lastfm", 10)[0].attempts, 2);
}

closeDatabases();
fs.rmSync(directory, { recursive: true, force: true });
console.log("scrobble-smoke: ok");
