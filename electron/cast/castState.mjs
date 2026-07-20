import path from "node:path";

// Shared Cast vocabulary: session states, stable error codes, the
// direct-cast format allowlist, and receiver status normalization.

export const CAST_SESSION_STATES = [
  "idle",
  "connecting",
  "connected",
  "loading",
  "playing",
  "paused",
  "buffering",
  "disconnecting",
  "error",
];

export const CAST_ERROR_CODES = {
  deviceNotFound: "CAST_DEVICE_NOT_FOUND",
  connectTimeout: "CAST_CONNECT_TIMEOUT",
  connectFailed: "CAST_CONNECT_FAILED",
  loadFailed: "CAST_LOAD_FAILED",
  unsupportedFormat: "CAST_UNSUPPORTED_FORMAT",
  mediaServerUnreachable: "CAST_MEDIA_SERVER_UNREACHABLE",
  sessionEnded: "CAST_SESSION_ENDED",
  commandFailed: "CAST_COMMAND_FAILED",
};

// Conservative direct-cast allowlist. Extensions whose containers can hide
// receiver-unsupported codecs (.m4a may be ALAC, .aiff always is) are
// excluded until verified on a physical device.
const DIRECT_CAST_CONTENT_TYPES = new Map([
  [".mp3", "audio/mpeg"],
  [".flac", "audio/flac"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".opus", "audio/ogg"],
]);

export const castContentTypeFor = (filePath) =>
  DIRECT_CAST_CONTENT_TYPES.get(path.extname(String(filePath ?? "")).toLowerCase()) ?? null;

export const createCastError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const CODE_PREFIX_PATTERN = /^(CAST_[A-Z_]+):\s*/;

// Convert an error into a stable serializable {code, message} shape. The code
// may live on the error object or be embedded in the message (Electron drops
// custom properties when an error crosses ipcRenderer.invoke).
export const toCastErrorPayload = (error) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const embedded = CODE_PREFIX_PATTERN.exec(rawMessage);
  const code = typeof error?.code === "string" && error.code.startsWith("CAST_")
    ? error.code
    : embedded?.[1] ?? CAST_ERROR_CODES.commandFailed;
  return { code, message: rawMessage.replace(CODE_PREFIX_PATTERN, "") };
};

const PLAYER_STATE_MAP = new Map([
  ["PLAYING", "playing"],
  ["PAUSED", "paused"],
  ["BUFFERING", "buffering"],
  ["LOADING", "buffering"],
  ["IDLE", "idle"],
]);

// Normalize one entry of a receiver MEDIA_STATUS payload.
export const normalizeMediaStatus = (rawStatus) => {
  if (!rawStatus || typeof rawStatus !== "object") return null;
  const media = rawStatus.media ?? {};
  return {
    mediaSessionId: rawStatus.mediaSessionId ?? null,
    playerState: PLAYER_STATE_MAP.get(rawStatus.playerState) ?? "idle",
    idleReason: rawStatus.idleReason ?? null,
    position: Number.isFinite(rawStatus.currentTime) ? rawStatus.currentTime : 0,
    duration: Number.isFinite(media.duration) ? media.duration : null,
    contentId: media.contentId ?? null,
  };
};

// A track finished naturally when the receiver transitions from an active
// media session to IDLE with FINISHED. The edge condition (previous state not
// already idle) keeps repeated or re-delivered FINISHED statuses from
// advancing the queue twice. User stops, load errors, and disconnects report
// different idle reasons and must not advance at all.
export const isFinishedTransition = (previousStatus, nextStatus) =>
  Boolean(
    previousStatus &&
    previousStatus.mediaSessionId !== null &&
    previousStatus.playerState !== "idle" &&
    nextStatus &&
    nextStatus.playerState === "idle" &&
    nextStatus.idleReason === "FINISHED",
  );

// Session state implied by a media status while connected.
export const sessionStateForMediaStatus = (status) => {
  if (!status) return "connected";
  if (status.playerState === "playing") return "playing";
  if (status.playerState === "paused") return "paused";
  if (status.playerState === "buffering") return "buffering";
  return "connected";
};
