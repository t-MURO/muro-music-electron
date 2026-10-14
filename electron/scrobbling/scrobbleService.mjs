import { SCROBBLE_SERVICES, createCredentialStore } from "./credentials.mjs";
import {
  LASTFM_EXPIRED_TOKEN,
  LASTFM_MAX_BATCH,
  LASTFM_UNAUTHORIZED_TOKEN,
  createLastFmClient,
} from "./lastfm.mjs";
import { LISTENBRAINZ_MAX_BATCH, createListenBrainzClient } from "./listenbrainz.mjs";
import { ScrobbleRequestError } from "./scrobbleErrors.mjs";
import {
  completeScrobbles,
  deferScrobbles,
  dropScrobbles,
  enqueueScrobble,
  pendingScrobbles,
  scrobbleQueueSummary,
  scrobbleRetryAt,
} from "./scrobbleQueue.mjs";

// Both services use the same rule: a track longer than 30 seconds counts once
// it has played for half its length or four minutes, whichever comes first.
export const SCROBBLE_MIN_TRACK_SECONDS = 30;
export const SCROBBLE_MAX_LISTEN_SECONDS = 240;
// Position updates arrive about once a second, so the renderer may report a
// play a moment before the exact threshold.
const LISTEN_TOLERANCE_SECONDS = 1;
// Tokens from auth.getToken are valid for 60 minutes.
const LASTFM_TOKEN_LIFETIME_MS = 60 * 60_000;
const MAX_STARTED_AT_AGE_MS = 7 * 24 * 60 * 60_000;

/** Seconds of listening a track needs before it is scrobbled; null if it never is. */
export const scrobbleThresholdSeconds = (durationSeconds) => {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= SCROBBLE_MIN_TRACK_SECONDS) return null;
  return Math.min(duration / 2, SCROBBLE_MAX_LISTEN_SECONDS);
};

const assertService = (service) => {
  if (!SCROBBLE_SERVICES.includes(service)) {
    throw new Error(`Unknown scrobbling service: ${String(service)}`);
  }
  return service;
};

const SERVICE_LABELS = { lastfm: "Last.fm", listenbrainz: "ListenBrainz" };

export const createScrobbleService = ({
  getDb,
  credentials = createCredentialStore(),
  fetchImpl = globalThis.fetch,
  openExternal = null,
  onStatusChange = null,
  clientVersion,
  timeoutMs,
  now = () => Date.now(),
  setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer = (timer) => clearTimeout(timer),
}) => {
  const lastFm = createLastFmClient({ fetchImpl, timeoutMs });
  const listenBrainz = createListenBrainzClient({ fetchImpl, timeoutMs, clientVersion });
  // The API key and shared secret are renderer settings, pushed here on startup
  // and whenever they change.
  let lastFmApp = { apiKey: "", sharedSecret: "" };
  let pendingLastFmToken = null;
  let closed = false;
  const flushChains = new Map();
  const retryTimers = new Map();
  const lastErrors = new Map();

  const database = () => {
    try {
      return getDb();
    } catch {
      return null;
    }
  };

  const lastFmConfigured = () => Boolean(lastFmApp.apiKey && lastFmApp.sharedSecret);

  /** Whether plays for this service should be queued at all. */
  const accepting = (account) =>
    account.enabled && Boolean(account.secret || account.needsReconnect);

  /** Whether queued plays and now-playing updates may be sent right now. */
  const canSend = (service, account) =>
    !closed &&
    account.enabled &&
    Boolean(account.secret) &&
    !account.needsReconnect &&
    (service !== "lastfm" || lastFmConfigured());

  const serviceStatus = (service) => {
    const account = credentials.get(service);
    const db = database();
    const queue = db
      ? scrobbleQueueSummary(db, service)
      : { pending: 0, dropped: 0, retryAt: null, lastDropped: null };
    return {
      enabled: account.enabled,
      connected: Boolean(account.secret),
      userName: account.userName,
      needsReconnect: account.needsReconnect,
      reconnectReason: account.reconnectReason,
      lastError: lastErrors.get(service) ?? null,
      ...queue,
      retryAt: queue.retryAt && queue.retryAt > now() ? queue.retryAt : null,
    };
  };

  const status = () => ({
    credentialStorage: credentials.storage(),
    lastfm: {
      ...serviceStatus("lastfm"),
      configured: lastFmConfigured(),
      awaitingAuthorization: Boolean(pendingLastFmToken),
    },
    listenbrainz: serviceStatus("listenbrainz"),
  });

  const publish = () => {
    const snapshot = status();
    try {
      onStatusChange?.(snapshot);
    } catch (error) {
      console.warn("Failed to publish scrobbling status:", error?.message ?? error);
    }
    return snapshot;
  };

  const pauseForReconnect = (service, error) => {
    lastErrors.set(service, error.message);
    credentials.update(service, { needsReconnect: true, reconnectReason: error.message });
  };

  const scheduleRetry = (service) => {
    clearTimer(retryTimers.get(service));
    retryTimers.delete(service);
    const db = database();
    if (closed || !db || !canSend(service, credentials.get(service))) return;
    if (scrobbleQueueSummary(db, service).pending === 0) return;
    const delayMs = scrobbleRetryAt(db, service) - now();
    if (delayMs <= 0) return;
    const timer = setTimer(() => {
      retryTimers.delete(service);
      void flush(service);
    }, delayMs);
    timer?.unref?.();
    retryTimers.set(service, timer);
  };

  const send = (service, account, items) =>
    service === "lastfm"
      ? lastFm.scrobble(lastFmApp, account.secret, items)
      : listenBrainz.submitListens(account.secret, items);

  const flushService = async (service, { force = false } = {}) => {
    const db = database();
    if (!db) return;
    const batchSize = service === "lastfm" ? LASTFM_MAX_BATCH : LISTENBRAINZ_MAX_BATCH;
    // After a whole batch is refused, its plays are resent one at a time so a
    // single malformed play does not take the others down with it.
    let sendIndividually = 0;
    while (true) {
      const account = credentials.get(service);
      if (!canSend(service, account)) return;
      if (!force && scrobbleRetryAt(db, service) > now()) return;
      const items = pendingScrobbles(db, service, sendIndividually > 0 ? 1 : batchSize);
      if (items.length === 0) return;
      if (sendIndividually > 0) sendIndividually -= 1;
      let results;
      try {
        results = await send(service, account, items);
      } catch (caught) {
        const error =
          caught instanceof ScrobbleRequestError
            ? caught
            : new ScrobbleRequestError("retry", caught?.message ?? String(caught));
        if (error.kind === "auth") {
          pauseForReconnect(service, error);
          return;
        }
        if (error.kind === "retry") {
          lastErrors.set(service, error.message);
          deferScrobbles(
            db,
            items.map((item) => item.id),
            { now: now(), error: error.message, minDelayMs: error.retryAfterMs },
          );
          return;
        }
        if (items.length > 1) {
          sendIndividually = items.length;
          continue;
        }
        dropScrobbles(db, [{ id: items[0].id, reason: error.message }], now());
        continue;
      }
      lastErrors.delete(service);
      completeScrobbles(
        db,
        items.filter((_item, index) => results[index]?.ok).map((item) => item.id),
      );
      dropScrobbles(
        db,
        items
          .map((item, index) => ({ id: item.id, result: results[index] }))
          .filter(({ result }) => result && !result.ok && !result.retry)
          .map(({ id, result }) => ({ id, reason: result.reason })),
        now(),
      );
      const deferred = items.filter((_item, index) => results[index]?.retry);
      if (deferred.length > 0) {
        const reason = results.find((result) => result?.retry)?.reason;
        lastErrors.set(service, reason ?? null);
        deferScrobbles(
          db,
          deferred.map((item) => item.id),
          { now: now(), error: reason },
        );
        return;
      }
    }
  };

  /** Flushes run one at a time per service; a later request waits for the current one. */
  const flush = (service, options) => {
    const previous = flushChains.get(service) ?? Promise.resolve();
    const run = previous
      .then(() => flushService(service, options))
      .catch((error) => {
        console.warn(`Failed to send scrobbles to ${SERVICE_LABELS[service]}:`, error?.message);
      })
      .finally(() => {
        if (flushChains.get(service) === run) flushChains.delete(service);
        scheduleRetry(service);
        publish();
      });
    flushChains.set(service, run);
    return run;
  };

  const flushAll = (options) =>
    Promise.all(SCROBBLE_SERVICES.map((service) => flush(service, options)));

  /** Metadata comes from the library, never from the renderer. */
  const trackForScrobble = (trackId, fallbackDurationSeconds) => {
    const db = database();
    if (!db) return null;
    const row = db
      .prepare(
        `
      SELECT id, title, artist, album, album_artist, track_number, duration_seconds,
             musicbrainz_trackid, musicbrainz_albumid
      FROM tracks WHERE id = ?
    `,
      )
      .get(String(trackId ?? ""));
    if (!row) return null;
    const artist = String(row.artist ?? "").trim();
    const title = String(row.title ?? "").trim();
    if (!artist || !title) return null;
    const storedDuration = Number(row.duration_seconds);
    const fallbackDuration = Number(fallbackDurationSeconds);
    return {
      trackId: String(row.id),
      artist,
      title,
      album: String(row.album ?? "").trim(),
      albumArtist: String(row.album_artist ?? "").trim(),
      trackNumber: Number(row.track_number) > 0 ? Number(row.track_number) : null,
      durationSeconds:
        storedDuration > 0 ? storedDuration : fallbackDuration > 0 ? fallbackDuration : null,
      recordingMbid: row.musicbrainz_trackid ?? null,
      releaseMbid: row.musicbrainz_albumid ?? null,
    };
  };

  const playStartedAt = (startedAtMs, listenedSeconds) => {
    const current = now();
    const value = Number(startedAtMs);
    const valid =
      Number.isFinite(value) &&
      value <= current + 60_000 &&
      value >= current - MAX_STARTED_AT_AGE_MS;
    return Math.floor((valid ? value : current - listenedSeconds * 1000) / 1000);
  };

  const failure = (error, message) => ({ ok: false, error, message, status: publish() });

  const commands = {
    scrobble_get_status: () => status(),

    scrobble_configure: ({ lastFmApiKey, lastFmSharedSecret }) => {
      const next = {
        apiKey: String(lastFmApiKey ?? "").trim(),
        sharedSecret: String(lastFmSharedSecret ?? "").trim(),
      };
      if (next.apiKey !== lastFmApp.apiKey || next.sharedSecret !== lastFmApp.sharedSecret) {
        pendingLastFmToken = null;
        // A wrong key or secret pauses sending just like a revoked session.
        // After the user corrects them the stored session gets another try;
        // if it really was revoked, the next request pauses again.
        const account = credentials.get("lastfm");
        if (account.secret && account.needsReconnect && lastFmApp.apiKey) {
          credentials.update("lastfm", { needsReconnect: false, reconnectReason: null });
        }
      }
      lastFmApp = next;
      // The renderer configures on startup, so this is also the startup flush.
      void flushAll();
      return publish();
    },

    scrobble_set_enabled: ({ service, enabled }) => {
      credentials.update(assertService(service), { enabled: Boolean(enabled) });
      if (enabled) void flush(service);
      else scheduleRetry(service);
      return publish();
    },

    scrobble_lastfm_begin_auth: async () => {
      if (!lastFmConfigured()) return failure("missing-api-credentials");
      if (typeof openExternal !== "function") return failure("browser-unavailable");
      try {
        const token = await lastFm.getToken(lastFmApp);
        pendingLastFmToken = { token, createdAt: now() };
        await openExternal(lastFm.authorizationUrl(lastFmApp, token));
      } catch (error) {
        pendingLastFmToken = null;
        return failure(error?.kind === "retry" ? "network" : "request-failed", error?.message);
      }
      return { ok: true, status: publish() };
    },

    scrobble_lastfm_complete_auth: async () => {
      if (!lastFmConfigured()) return failure("missing-api-credentials");
      if (!pendingLastFmToken || now() - pendingLastFmToken.createdAt > LASTFM_TOKEN_LIFETIME_MS) {
        pendingLastFmToken = null;
        return failure("token-expired");
      }
      try {
        const { sessionKey, userName } = await lastFm.getSession(
          lastFmApp,
          pendingLastFmToken.token,
        );
        pendingLastFmToken = null;
        lastErrors.delete("lastfm");
        credentials.update("lastfm", {
          enabled: true,
          userName,
          secret: sessionKey,
          needsReconnect: false,
          reconnectReason: null,
        });
      } catch (error) {
        if (error?.code === LASTFM_UNAUTHORIZED_TOKEN) return failure("not-authorized");
        if (error?.code === LASTFM_EXPIRED_TOKEN) {
          pendingLastFmToken = null;
          return failure("token-expired");
        }
        return failure(error?.kind === "retry" ? "network" : "request-failed", error?.message);
      }
      void flush("lastfm");
      return { ok: true, status: publish() };
    },

    scrobble_lastfm_cancel_auth: () => {
      pendingLastFmToken = null;
      return publish();
    },

    scrobble_listenbrainz_connect: async ({ token }) => {
      const value = String(token ?? "").trim();
      if (!value) return failure("missing-token");
      // User tokens are UUIDs; anything else cannot be sent as a header.
      if (!/^[\w-]{1,128}$/.test(value)) return failure("invalid-token");
      let result;
      try {
        result = await listenBrainz.validateToken(value);
      } catch (error) {
        return failure(
          error?.kind === "retry"
            ? "network"
            : error?.kind === "auth"
              ? "invalid-token"
              : "request-failed",
          error?.message,
        );
      }
      if (!result.valid) return failure("invalid-token");
      lastErrors.delete("listenbrainz");
      credentials.update("listenbrainz", {
        enabled: true,
        userName: result.userName || null,
        secret: value,
        needsReconnect: false,
        reconnectReason: null,
      });
      void flush("listenbrainz");
      return { ok: true, status: publish() };
    },

    // Queued plays stay in the database and are sent after reconnecting.
    scrobble_disconnect: ({ service }) => {
      assertService(service);
      if (service === "lastfm") pendingLastFmToken = null;
      lastErrors.delete(service);
      credentials.update(service, {
        enabled: false,
        userName: null,
        secret: null,
        needsReconnect: false,
        reconnectReason: null,
      });
      scheduleRetry(service);
      return publish();
    },

    // Now playing is best effort: it is never queued or retried.
    scrobble_now_playing: async ({ trackId, durationSeconds }) => {
      const services = SCROBBLE_SERVICES.filter((service) =>
        canSend(service, credentials.get(service)),
      );
      if (services.length === 0) return { sent: [] };
      const item = trackForScrobble(trackId, durationSeconds);
      if (!item) return { sent: [] };
      const sent = [];
      let changed = false;
      await Promise.all(
        services.map(async (service) => {
          const account = credentials.get(service);
          try {
            if (service === "lastfm")
              await lastFm.updateNowPlaying(lastFmApp, account.secret, item);
            else await listenBrainz.playingNow(account.secret, item);
            sent.push(service);
          } catch (error) {
            if (error?.kind === "auth") {
              pauseForReconnect(service, error);
              changed = true;
            }
          }
        }),
      );
      if (changed) publish();
      return { sent };
    },

    scrobble_submit: ({ trackId, startedAt, listenedSeconds, durationSeconds }) => {
      const services = SCROBBLE_SERVICES.filter((service) => accepting(credentials.get(service)));
      if (services.length === 0) return { queued: 0 };
      const item = trackForScrobble(trackId, durationSeconds);
      if (!item) return { queued: 0, skipped: "unknown-track" };
      const threshold = scrobbleThresholdSeconds(item.durationSeconds);
      if (threshold === null) return { queued: 0, skipped: "too-short" };
      const listened = Math.max(0, Number(listenedSeconds) || 0);
      if (listened + LISTEN_TOLERANCE_SECONDS < threshold) {
        return { queued: 0, skipped: "not-enough-listening" };
      }
      const db = database();
      const play = { ...item, startedAt: playStartedAt(startedAt, listened) };
      let queued = 0;
      for (const service of services) {
        if (enqueueScrobble(db, service, play, now()) !== null) queued += 1;
      }
      for (const service of services) void flush(service);
      return { queued };
    },

    /** force sends right away, ignoring the current backoff ("Retry now"). */
    scrobble_flush: async ({ force } = {}) => {
      await flushAll({ force: Boolean(force) });
      return status();
    },
  };

  return {
    commands,
    status,
    flushAll,
    /** Resolves once every flush started so far has finished. */
    idle: () => Promise.all([...flushChains.values()]),
    close() {
      closed = true;
      for (const timer of retryTimers.values()) clearTimer(timer);
      retryTimers.clear();
    },
  };
};
