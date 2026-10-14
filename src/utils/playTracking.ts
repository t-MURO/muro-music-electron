import type { Track } from "../types";

// Seconds near the start of a track. Jumping back into this window after a
// play was counted (repeat-one, replaying the track, seeking to its start)
// begins a new play of the same track.
export const PLAY_RESTART_WINDOW_SECONDS = 2;

// Waits between record_track_play attempts. Once they are used up the play is
// given up on rather than retried on every position update.
export const RECORD_PLAY_RETRY_DELAYS_MS = [2_000, 10_000, 30_000] as const;

// Last.fm and ListenBrainz scrobble a track longer than 30 seconds once it
// has played for half its length or four minutes, whichever comes first.
// electron/scrobbling/scrobbleService.mjs checks the same rule again.
export const SCROBBLE_MIN_TRACK_SECONDS = 30;
export const SCROBBLE_MAX_LISTEN_SECONDS = 240;

/** Seconds of listening before a play is scrobbled, or null for tracks that never are. */
export const scrobbleThresholdSeconds = (durationSeconds: number | undefined): number | null => {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= SCROBBLE_MIN_TRACK_SECONDS) return null;
  return Math.min(duration / 2, SCROBBLE_MAX_LISTEN_SECONDS);
};

export const hasReachedScrobbleThreshold = (
  listenedSeconds: number,
  durationSeconds: number | undefined,
): boolean => {
  const threshold = scrobbleThresholdSeconds(durationSeconds);
  return threshold !== null && listenedSeconds >= threshold;
};

export const isPlayRestart = (previousPosition: number, position: number): boolean =>
  position < PLAY_RESTART_WINDOW_SECONDS &&
  previousPosition - position >= PLAY_RESTART_WINDOW_SECONDS;

const wait = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export const retryWithBackoff = async <T>(
  task: () => Promise<T>,
  delaysMs: readonly number[],
  sleep: (delayMs: number) => Promise<void> = wait,
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= delaysMs.length) throw error;
      await sleep(delaysMs[attempt]);
    }
  }
};

export type RecordedPlay = {
  trackId: string;
  playedAt: string;
  previousLastPlayedAt: string | undefined;
};

// Undoes the optimistic play-count bump for a play the backend never stored.
// Only the fields this play changed are restored, so later edits survive.
export const revertRecordedPlay = (track: Track, play: RecordedPlay): Track => {
  if (track.id !== play.trackId) return track;
  return {
    ...track,
    playCount: Math.max(0, (track.playCount || 0) - 1),
    lastPlayedAt:
      track.lastPlayedAt === play.playedAt ? play.previousLastPlayedAt : track.lastPlayedAt,
  };
};

// Recently played only lists tracks that were stored as played, so a track
// whose first play failed to record is dropped instead of reverted.
export const revertRecentlyPlayed = (tracks: Track[], play: RecordedPlay): Track[] =>
  tracks.flatMap((track) => {
    if (track.id !== play.trackId || track.lastPlayedAt !== play.playedAt) return [track];
    return play.previousLastPlayedAt ? [revertRecordedPlay(track, play)] : [];
  });
