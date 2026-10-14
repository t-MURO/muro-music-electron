import crypto from "node:crypto";
import {
  ScrobbleRequestError,
  musicBrainzIdOrNull,
  networkError,
  timeoutSignal,
} from "./scrobbleErrors.mjs";

// Scrobbling 2.0: https://www.last.fm/api/scrobbling
export const LASTFM_API_ROOT = "https://ws.audioscrobbler.com/2.0/";
export const LASTFM_AUTH_URL = "https://www.last.fm/api/auth/";
export const LASTFM_MAX_BATCH = 50;

// Documented as "try again later": 11 service offline, 16 temporary error.
// 29 (rate limit exceeded) clears up on its own as well.
const RETRYABLE_ERRORS = new Set([11, 16, 29]);
// 4 authentication failed, 9 invalid session key, 10 invalid API key,
// 13 invalid signature (wrong shared secret), 26 suspended API key. None of
// them can succeed until the user fixes the connection.
const AUTH_ERRORS = new Set([4, 9, 10, 13, 26]);
// auth.getSession before the user approved the token in the browser.
export const LASTFM_UNAUTHORIZED_TOKEN = 14;
export const LASTFM_EXPIRED_TOKEN = 15;
// ignoredMessage 5: the daily scrobble limit was reached; tomorrow it works.
const RETRYABLE_IGNORED_CODES = new Set([5]);

/**
 * api_sig: every parameter except format/callback, sorted by name in byte
 * order, concatenated as name+value, followed by the shared secret, MD5-hashed.
 */
export const lastFmSignature = (params, sharedSecret) => {
  const base = Object.keys(params)
    .filter((name) => name !== "format" && name !== "callback")
    .sort()
    .map((name) => `${name}${params[name]}`)
    .join("");
  return crypto.createHash("md5").update(`${base}${sharedSecret}`, "utf8").digest("hex");
};

const withoutEmptyValues = (params) =>
  Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([name, value]) => [name, String(value)]),
  );

const trackParams = (item, suffix = "") => {
  const duration = Math.round(Number(item.durationSeconds));
  const trackNumber = Math.trunc(Number(item.trackNumber));
  return {
    [`artist${suffix}`]: item.artist,
    [`track${suffix}`]: item.title,
    [`album${suffix}`]: item.album || null,
    [`albumArtist${suffix}`]:
      item.albumArtist && item.albumArtist !== item.artist ? item.albumArtist : null,
    [`trackNumber${suffix}`]: trackNumber > 0 ? trackNumber : null,
    [`duration${suffix}`]: duration > 0 ? duration : null,
    [`mbid${suffix}`]: musicBrainzIdOrNull(item.recordingMbid),
  };
};

const listOf = (value) => (Array.isArray(value) ? value : value ? [value] : []);

export const createLastFmClient = ({
  fetchImpl = globalThis.fetch,
  timeoutMs,
  userAgent = "MuroMusic (https://github.com/t-MURO/muro-music-electron)",
} = {}) => {
  // Everything is POSTed so tokens, session keys and signatures never end up
  // in a URL (and therefore never in a logged error message).
  const call = async (method, params, { apiKey, sharedSecret }) => {
    if (!apiKey || !sharedSecret) {
      throw new ScrobbleRequestError("auth", "The Last.fm API key or shared secret is missing");
    }
    const signed = withoutEmptyValues({ ...params, method, api_key: apiKey });
    signed.api_sig = lastFmSignature(signed, sharedSecret);
    let response;
    try {
      response = await fetchImpl(LASTFM_API_ROOT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          "User-Agent": userAgent,
        },
        body: new URLSearchParams({ ...signed, format: "json" }),
        signal: timeoutSignal(timeoutMs),
      });
    } catch (error) {
      throw networkError("Last.fm", error);
    }
    const payload = await response.json().catch(() => null);
    const code = Number(payload?.error);
    if (payload && Number.isInteger(code) && code > 0) {
      const message = `Last.fm error ${code}: ${String(payload.message ?? "request failed")}`;
      const kind = RETRYABLE_ERRORS.has(code)
        ? "retry"
        : AUTH_ERRORS.has(code)
          ? "auth"
          : "rejected";
      throw new ScrobbleRequestError(kind, message, { code });
    }
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new ScrobbleRequestError(
        retryable ? "retry" : "rejected",
        `Last.fm responded with HTTP ${response.status}`,
      );
    }
    if (!payload || typeof payload !== "object") {
      throw new ScrobbleRequestError("retry", "Last.fm sent an unreadable response");
    }
    return payload;
  };

  return {
    async getToken(app) {
      const payload = await call("auth.getToken", {}, app);
      if (typeof payload.token !== "string" || !payload.token) {
        throw new ScrobbleRequestError("retry", "Last.fm did not return an authorization token");
      }
      return payload.token;
    },

    authorizationUrl: ({ apiKey }, token) => {
      const url = new URL(LASTFM_AUTH_URL);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("token", token);
      return url.toString();
    },

    async getSession(app, token) {
      const payload = await call("auth.getSession", { token }, app);
      const session = payload.session;
      if (typeof session?.key !== "string" || !session.key) {
        throw new ScrobbleRequestError("retry", "Last.fm did not return a session");
      }
      return { sessionKey: session.key, userName: String(session.name ?? "") };
    },

    updateNowPlaying: (app, sessionKey, item) =>
      call("track.updateNowPlaying", { ...trackParams(item), sk: sessionKey }, app),

    /**
     * Sends up to 50 plays. Resolves with one result per item, in order:
     * accepted, or ignored with the reason Last.fm gave.
     */
    async scrobble(app, sessionKey, items) {
      if (items.length > LASTFM_MAX_BATCH) {
        throw new Error(`Last.fm accepts at most ${LASTFM_MAX_BATCH} scrobbles per request`);
      }
      const params = { sk: sessionKey };
      items.forEach((item, index) => {
        Object.assign(params, trackParams(item, `[${index}]`), {
          [`timestamp[${index}]`]: Math.trunc(item.startedAt),
        });
      });
      const payload = await call("track.scrobble", params, app);
      const scrobbles = listOf(payload.scrobbles?.scrobble);
      return items.map((_item, index) => {
        const ignored = scrobbles[index]?.ignoredMessage;
        const ignoredCode = Number(ignored?.code ?? 0);
        if (!ignoredCode) return { ok: true };
        const text = String(ignored?.["#text"] ?? "").trim();
        return {
          ok: false,
          retry: RETRYABLE_IGNORED_CODES.has(ignoredCode),
          reason: `Ignored by Last.fm (code ${ignoredCode})${text ? `: ${text}` : ""}`,
        };
      });
    },
  };
};
