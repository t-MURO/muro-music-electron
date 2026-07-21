import path from "node:path";

// Shared DLNA vocabulary: stable error codes, the direct-play format list,
// and UPnP AVTransport state normalization. Mirrors electron/cast/castState.

export const DLNA_ERROR_CODES = {
  deviceNotFound: "DLNA_DEVICE_NOT_FOUND",
  connectFailed: "DLNA_CONNECT_FAILED",
  loadFailed: "DLNA_LOAD_FAILED",
  unsupportedFormat: "DLNA_UNSUPPORTED_FORMAT",
  mediaServerUnreachable: "DLNA_MEDIA_SERVER_UNREACHABLE",
  sessionEnded: "DLNA_SESSION_ENDED",
  commandFailed: "DLNA_COMMAND_FAILED",
};

// DLNA renderers (HEOS, most AVRs) decode far more than Cast receivers, so
// the allowlist is broader; genuinely exotic imports still get a clear error.
const DLNA_CONTENT_TYPES = new Map([
  [".mp3", "audio/mpeg"],
  [".flac", "audio/flac"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".m4a", "audio/mp4"],
  [".mp4", "audio/mp4"],
  [".aac", "audio/aac"],
  [".aif", "audio/aiff"],
  [".aiff", "audio/aiff"],
  [".alac", "audio/mp4"],
]);

export const dlnaContentTypeFor = (filePath) =>
  DLNA_CONTENT_TYPES.get(path.extname(String(filePath ?? "")).toLowerCase()) ?? null;

export const createDlnaError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const CODE_PREFIX_PATTERN = /^(DLNA_[A-Z_]+):\s*/;

export const toDlnaErrorPayload = (error) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const embedded = CODE_PREFIX_PATTERN.exec(rawMessage);
  const code = typeof error?.code === "string" && error.code.startsWith("DLNA_")
    ? error.code
    : embedded?.[1] ?? DLNA_ERROR_CODES.commandFailed;
  return { code, message: rawMessage.replace(CODE_PREFIX_PATTERN, "") };
};

const TRANSPORT_STATE_MAP = new Map([
  ["PLAYING", "playing"],
  ["PAUSED_PLAYBACK", "paused"],
  ["PAUSED_RECORDING", "paused"],
  ["TRANSITIONING", "buffering"],
  ["STOPPED", "idle"],
  ["NO_MEDIA_PRESENT", "idle"],
]);

// Combine GetTransportInfo + GetPositionInfo results into the same media
// status shape the cast service emits.
export const normalizeTransportStatus = ({ transportState, positionSecs, durationSecs } = {}) => ({
  mediaSessionId: null,
  playerState: TRANSPORT_STATE_MAP.get(transportState) ?? "idle",
  idleReason: null,
  position: Number.isFinite(positionSecs) ? positionSecs : 0,
  duration: Number.isFinite(durationSecs) && durationSecs > 0 ? durationSecs : null,
  contentId: null,
});

// AVTransport has no FINISHED reason: a natural end is a PLAYING → STOPPED
// edge with the last known position close to the track duration. Explicit
// stops from Muro set a suppression flag before issuing the command.
const FINISH_WINDOW_SECS = 5;

export const isDlnaFinishedTransition = (previousStatus, nextStatus) =>
  Boolean(
    previousStatus &&
    (previousStatus.playerState === "playing" || previousStatus.playerState === "buffering") &&
    nextStatus &&
    nextStatus.playerState === "idle" &&
    previousStatus.duration !== null &&
    previousStatus.duration > 0 &&
    previousStatus.duration - previousStatus.position <= FINISH_WINDOW_SECS,
  );

export const dlnaSessionStateForStatus = (status) => {
  if (!status) return "connected";
  if (status.playerState === "playing") return "playing";
  if (status.playerState === "paused") return "paused";
  if (status.playerState === "buffering") return "buffering";
  return "connected";
};
