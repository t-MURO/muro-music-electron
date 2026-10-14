import type { RepeatMode } from "../stores/playbackStore";

// The listening session is split across two keys: the lists change rarely,
// while the position is rewritten every few seconds during playback and must
// stay cheap to write even for a queue the size of the whole library.
export const PLAYBACK_SESSION_STORAGE_KEY = "muro-playback-session";
export const PLAYBACK_POSITION_STORAGE_KEY = "muro-playback-position";
export const PLAYBACK_SESSION_VERSION = 1;

// A track restored this close to its end would finish the moment play is
// pressed, so it starts over instead.
const END_OF_TRACK_RESTART_SECONDS = 1;

const REPEAT_MODES: readonly RepeatMode[] = ["off", "all", "one"];

/** The list playback was started from, used for repeat-all and "open current track". */
export type PlaybackSessionContext = {
  /** Route the list was shown at; null when it is not known. */
  path: string | null;
  trackIds: string[];
};

export type PlaybackSession = {
  version: typeof PLAYBACK_SESSION_VERSION;
  currentTrackId: string | null;
  queue: string[];
  playingNext: string[];
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  volume: number;
  context: PlaybackSessionContext | null;
};

export type PlaybackSessionPosition = {
  trackId: string;
  positionSecs: number;
};

export type RestoredPlaybackSession = {
  /** Null when the saved track is no longer in the library. */
  currentTrackId: string | null;
  positionSecs: number;
  queue: string[];
  playingNext: string[];
  context: PlaybackSessionContext | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toIdList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

const toFiniteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parseJson = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const serializePlaybackSession = (session: PlaybackSession): string =>
  JSON.stringify(session);

/** Reads a stored session, repairing what it can and rejecting what it cannot. */
export const parsePlaybackSession = (raw: string | null): PlaybackSession | null => {
  const value = parseJson(raw);
  if (!isRecord(value) || value.version !== PLAYBACK_SESSION_VERSION) return null;

  const context = isRecord(value.context)
    ? {
        path:
          typeof value.context.path === "string" && value.context.path.startsWith("/")
            ? value.context.path
            : null,
        trackIds: toIdList(value.context.trackIds),
      }
    : null;

  return {
    version: PLAYBACK_SESSION_VERSION,
    currentTrackId:
      typeof value.currentTrackId === "string" && value.currentTrackId
        ? value.currentTrackId
        : null,
    queue: toIdList(value.queue),
    playingNext: toIdList(value.playingNext),
    shuffleEnabled: value.shuffleEnabled === true,
    repeatMode: REPEAT_MODES.includes(value.repeatMode as RepeatMode)
      ? (value.repeatMode as RepeatMode)
      : "off",
    volume: Math.max(0, Math.min(1, toFiniteNumber(value.volume, 1))),
    context: context && context.trackIds.length > 0 ? context : null,
  };
};

export const serializePlaybackPosition = (position: PlaybackSessionPosition): string =>
  JSON.stringify(position);

export const parsePlaybackPosition = (raw: string | null): PlaybackSessionPosition | null => {
  const value = parseJson(raw);
  if (!isRecord(value) || typeof value.trackId !== "string" || !value.trackId) return null;
  return {
    trackId: value.trackId,
    positionSecs: Math.max(0, toFiniteNumber(value.positionSecs, 0)),
  };
};

/**
 * Drops every track the library no longer has. The position only applies
 * when it was saved for the restored current track.
 */
export const prunePlaybackSession = (
  session: PlaybackSession,
  position: PlaybackSessionPosition | null,
  lookupTrack: (trackId: string) => { durationSeconds: number } | undefined,
): RestoredPlaybackSession => {
  const keep = (ids: string[]) => ids.filter((id) => lookupTrack(id) !== undefined);
  const currentTrack = session.currentTrackId ? lookupTrack(session.currentTrackId) : undefined;
  const currentTrackId = currentTrack ? session.currentTrackId : null;

  let positionSecs = 0;
  if (currentTrack && position?.trackId === currentTrackId) {
    const duration = currentTrack.durationSeconds;
    positionSecs =
      duration > 0 && position.positionSecs >= duration - END_OF_TRACK_RESTART_SECONDS
        ? 0
        : position.positionSecs;
  }

  const contextTrackIds = session.context ? keep(session.context.trackIds) : [];
  return {
    currentTrackId,
    positionSecs,
    queue: keep(session.queue),
    playingNext: keep(session.playingNext),
    context:
      session.context && contextTrackIds.length > 0
        ? { path: session.context.path, trackIds: contextTrackIds }
        : null,
  };
};
