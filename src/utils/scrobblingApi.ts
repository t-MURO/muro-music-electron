import { invoke } from "@muro/desktop/runtime";

// ============================================================================
// Types
// ============================================================================

export type ScrobbleServiceId = "lastfm" | "listenbrainz";

export type ScrobbleServiceStatus = {
  enabled: boolean;
  connected: boolean;
  userName: string | null;
  /** Sending is paused until the user connects the account again. */
  needsReconnect: boolean;
  reconnectReason: string | null;
  /** Why the most recent send failed, while it is being retried. */
  lastError: string | null;
  pending: number;
  dropped: number;
  /** When sending resumes after a failure (ms since epoch), if it is backing off. */
  retryAt: number | null;
  lastDropped: { title: string; artist: string; reason: string; droppedAt: number } | null;
};

export type ScrobbleStatus = {
  /** "session" means secrets cannot be stored securely and last until restart. */
  credentialStorage: "encrypted" | "session";
  lastfm: ScrobbleServiceStatus & { configured: boolean; awaitingAuthorization: boolean };
  listenbrainz: ScrobbleServiceStatus;
};

export type ScrobbleActionError =
  | "missing-api-credentials"
  | "browser-unavailable"
  | "network"
  | "request-failed"
  | "not-authorized"
  | "token-expired"
  | "missing-token"
  | "invalid-token";

export type ScrobbleActionResult =
  | { ok: true; status: ScrobbleStatus }
  | { ok: false; error: ScrobbleActionError; message?: string; status: ScrobbleStatus };

// ============================================================================
// Commands
// ============================================================================

export const getScrobbleStatus = () => invoke<ScrobbleStatus>("scrobble_get_status");

export const configureScrobbling = (lastFmApiKey: string, lastFmSharedSecret: string) =>
  invoke<ScrobbleStatus>("scrobble_configure", { lastFmApiKey, lastFmSharedSecret });

export const setScrobbleServiceEnabled = (service: ScrobbleServiceId, enabled: boolean) =>
  invoke<ScrobbleStatus>("scrobble_set_enabled", { service, enabled });

/** Opens the Last.fm authorization page in the browser. */
export const beginLastFmAuth = () => invoke<ScrobbleActionResult>("scrobble_lastfm_begin_auth");

/** Exchanges the approved token for a session key. */
export const completeLastFmAuth = () =>
  invoke<ScrobbleActionResult>("scrobble_lastfm_complete_auth");

export const cancelLastFmAuth = () => invoke<ScrobbleStatus>("scrobble_lastfm_cancel_auth");

export const connectListenBrainz = (token: string) =>
  invoke<ScrobbleActionResult>("scrobble_listenbrainz_connect", { token });

export const disconnectScrobbleService = (service: ScrobbleServiceId) =>
  invoke<ScrobbleStatus>("scrobble_disconnect", { service });

export const sendNowPlaying = (trackId: string, durationSeconds: number) =>
  invoke<{ sent: ScrobbleServiceId[] }>("scrobble_now_playing", { trackId, durationSeconds });

export const submitScrobble = (play: {
  trackId: string;
  /** When playback of this play began, in ms since epoch. */
  startedAt: number;
  listenedSeconds: number;
  durationSeconds: number;
}) => invoke<{ queued: number }>("scrobble_submit", play);

/** force ignores the current backoff and sends queued plays right away. */
export const flushScrobbles = (force = false) =>
  invoke<ScrobbleStatus>("scrobble_flush", { force });
