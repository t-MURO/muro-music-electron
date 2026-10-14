import {
  ScrobbleRequestError,
  musicBrainzIdOrNull,
  networkError,
  timeoutSignal,
} from "./scrobbleErrors.mjs";

// https://listenbrainz.readthedocs.io/en/latest/users/api/core.html
export const LISTENBRAINZ_API_ROOT = "https://api.listenbrainz.org/1/";
// The API takes up to 1000 listens per request; smaller batches keep each
// payload far below its size limit and lose less work to a failed request.
export const LISTENBRAINZ_MAX_BATCH = 100;
const DEFAULT_RATE_LIMIT_DELAY_MS = 10_000;

const trackMetadata = (item, clientVersion) => {
  const durationMs = Math.round(Number(item.durationSeconds) * 1000);
  const trackNumber = Math.trunc(Number(item.trackNumber));
  const additionalInfo = Object.fromEntries(
    Object.entries({
      media_player: "Muro Music",
      submission_client: "Muro Music",
      submission_client_version: clientVersion,
      duration_ms: durationMs > 0 ? durationMs : null,
      tracknumber: trackNumber > 0 ? String(trackNumber) : null,
      recording_mbid: musicBrainzIdOrNull(item.recordingMbid),
      release_mbid: musicBrainzIdOrNull(item.releaseMbid),
    }).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
  return {
    artist_name: item.artist,
    track_name: item.title,
    ...(item.album ? { release_name: item.album } : {}),
    additional_info: additionalInfo,
  };
};

export const listenBrainzPayload = (listenType, items, clientVersion) => ({
  listen_type: listenType,
  payload: items.map((item) =>
    listenType === "playing_now"
      ? // A playing_now listen must not carry a timestamp.
        { track_metadata: trackMetadata(item, clientVersion) }
      : {
          listened_at: Math.trunc(item.startedAt),
          track_metadata: trackMetadata(item, clientVersion),
        },
  ),
});

export const createListenBrainzClient = ({
  fetchImpl = globalThis.fetch,
  timeoutMs,
  clientVersion,
  userAgent = "MuroMusic (https://github.com/t-MURO/muro-music-electron)",
} = {}) => {
  const request = async (endpoint, token, { method = "GET", body } = {}) => {
    let response;
    try {
      response = await fetchImpl(`${LISTENBRAINZ_API_ROOT}${endpoint}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Token ${token}`,
          "User-Agent": userAgent,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: timeoutSignal(timeoutMs),
      });
    } catch (error) {
      throw networkError("ListenBrainz", error);
    }
    const payload = await response.json().catch(() => null);
    if (response.ok) return payload ?? {};
    const detail = typeof payload?.error === "string" ? `: ${payload.error}` : "";
    const message = `ListenBrainz responded with HTTP ${response.status}${detail}`;
    if (response.status === 401) throw new ScrobbleRequestError("auth", message);
    if (response.status === 429) {
      const resetSeconds = Number(response.headers.get("X-RateLimit-Reset-In"));
      throw new ScrobbleRequestError("retry", message, {
        retryAfterMs:
          Number.isFinite(resetSeconds) && resetSeconds > 0
            ? resetSeconds * 1000
            : DEFAULT_RATE_LIMIT_DELAY_MS,
      });
    }
    if (response.status >= 500) throw new ScrobbleRequestError("retry", message);
    throw new ScrobbleRequestError("rejected", message);
  };

  return {
    async validateToken(token) {
      const payload = await request("validate-token", token);
      return {
        valid: payload?.valid === true,
        userName: typeof payload?.user_name === "string" ? payload.user_name : "",
      };
    },

    playingNow: (token, item) =>
      request("submit-listens", token, {
        method: "POST",
        body: listenBrainzPayload("playing_now", [item], clientVersion),
      }),

    /** ListenBrainz accepts or refuses a request as a whole. */
    async submitListens(token, items) {
      await request("submit-listens", token, {
        method: "POST",
        body: listenBrainzPayload(items.length === 1 ? "single" : "import", items, clientVersion),
      });
      return items.map(() => ({ ok: true }));
    },
  };
};
