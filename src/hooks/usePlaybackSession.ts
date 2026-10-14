import { useEffect, useRef, useState, type RefObject } from "react";
import type { Track } from "../types";
import { usePlaybackStore, useSettingsStore, trackToCurrentTrack } from "../stores";
import { isRemoteOutputActive } from "../stores/remoteOutputStore";
import { playbackLoadFile, playbackSetVolume } from "../utils/playbackApi";
import { resolveGainFactor } from "../utils/replayGain";
import {
  PLAYBACK_POSITION_STORAGE_KEY,
  PLAYBACK_SESSION_STORAGE_KEY,
  PLAYBACK_SESSION_VERSION,
  parsePlaybackPosition,
  parsePlaybackSession,
  prunePlaybackSession,
  serializePlaybackPosition,
  serializePlaybackSession,
  type PlaybackSession,
} from "../utils/playbackSession";

const POSITION_SAVE_INTERVAL_MS = 5_000;
const SESSION_SAVE_DELAY_MS = 300;

type PlaybackSource = { path: string; trackIds: string[] } | null;

type UsePlaybackSessionArgs = {
  libraryLoading: boolean;
  allTracksById: Map<string, Track>;
  /** Track ids of the list playback was started from. */
  playbackContextIdsRef: RefObject<string[]>;
  /** Route of that list, for "open current track". */
  playbackSourceRef: RefObject<PlaybackSource>;
};

const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // Usually the storage quota. A stale session is worse than none.
    window.localStorage.removeItem(key);
    console.warn("Failed to save the listening session", error);
  }
};

const clearStoredSession = () => {
  window.localStorage.removeItem(PLAYBACK_SESSION_STORAGE_KEY);
  window.localStorage.removeItem(PLAYBACK_POSITION_STORAGE_KEY);
};

/**
 * Saves the queue, the current track and its position, and brings them back
 * paused after a restart. Remote outputs are never reconnected: a restored
 * session always comes back on the local output.
 */
export const usePlaybackSession = ({
  libraryLoading,
  allTracksById,
  playbackContextIdsRef,
  playbackSourceRef,
}: UsePlaybackSessionArgs) => {
  const restoreLastSession = useSettingsStore((s) => s.restoreLastSession);
  const savedSessionRef = useRef<PlaybackSession | null>(null);
  const restoreStartedRef = useRef(false);
  // Saving only starts once the saved session was restored or skipped, so the
  // empty startup state never overwrites it.
  const [sessionReady, setSessionReady] = useState(false);

  // Modes and volume go first, before any track is current, so the shuffle
  // effect in App does not re-derive the restored "Playing next" list.
  useEffect(() => {
    if (!useSettingsStore.getState().restoreLastSession) return;
    const session = parsePlaybackSession(window.localStorage.getItem(PLAYBACK_SESSION_STORAGE_KEY));
    savedSessionRef.current = session;
    if (!session) return;
    const playback = usePlaybackStore.getState();
    playback.setShuffleEnabled(session.shuffleEnabled);
    playback.setRepeatMode(session.repeatMode);
    playbackSetVolume(session.volume)
      .then(() => usePlaybackStore.getState().setVolume(session.volume))
      .catch(() => undefined);
  }, []);

  // The lists and the current track need the library to drop removed tracks.
  useEffect(() => {
    if (libraryLoading || restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    const session = savedSessionRef.current;
    savedSessionRef.current = null;

    const restore = async () => {
      if (!session) return;
      const playback = usePlaybackStore.getState();
      // Something was started while the library loaded; it wins.
      if (playback.currentTrack || playback.queue.length > 0) return;

      const restored = prunePlaybackSession(
        session,
        parsePlaybackPosition(window.localStorage.getItem(PLAYBACK_POSITION_STORAGE_KEY)),
        (trackId) => allTracksById.get(trackId),
      );
      playbackContextIdsRef.current = restored.context?.trackIds ?? [];
      playbackSourceRef.current =
        restored.context?.path != null
          ? { path: restored.context.path, trackIds: restored.context.trackIds }
          : null;
      playback.setQueue(restored.queue);
      playback.setPlayingNext(restored.playingNext);

      const track = restored.currentTrackId ? allTracksById.get(restored.currentTrackId) : null;
      if (!track || isRemoteOutputActive()) return;
      const { replayGainMode, replayGainPreampDb, replayGainPreventClipping } =
        useSettingsStore.getState();
      try {
        await playbackLoadFile(
          {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            sourcePath: track.sourcePath,
            durationHint: track.durationSeconds,
            coverArtPath: track.coverArtPath,
            coverArtThumbPath: track.coverArtThumbPath,
            gainFactor: resolveGainFactor(track, {
              mode: replayGainMode,
              preampDb: replayGainPreampDb,
              preventClipping: replayGainPreventClipping,
            }),
          },
          restored.positionSecs,
        );
        playback.setIsPlaying(false);
        playback.setCurrentPosition(restored.positionSecs);
        playback.setDuration(track.durationSeconds);
        playback.setCurrentTrack(trackToCurrentTrack(track));
      } catch (error) {
        // The file may be unreadable now; the queue is still worth keeping.
        console.warn("Failed to restore the last track", error);
      }
    };

    void restore().finally(() => setSessionReady(true));
  }, [allTracksById, libraryLoading, playbackContextIdsRef, playbackSourceRef]);

  useEffect(() => {
    if (!sessionReady) return;
    if (!restoreLastSession) {
      clearStoredSession();
      return;
    }

    let sessionTimer: number | null = null;
    let lastPositionSaveAt = 0;

    const saveSession = () => {
      if (sessionTimer !== null) {
        window.clearTimeout(sessionTimer);
        sessionTimer = null;
      }
      const state = usePlaybackStore.getState();
      const contextTrackIds = playbackContextIdsRef.current;
      writeStorage(
        PLAYBACK_SESSION_STORAGE_KEY,
        serializePlaybackSession({
          version: PLAYBACK_SESSION_VERSION,
          currentTrackId: state.currentTrack?.id ?? null,
          queue: state.queue,
          playingNext: state.playingNext,
          shuffleEnabled: state.shuffleEnabled,
          repeatMode: state.repeatMode,
          volume: state.volume,
          context:
            contextTrackIds.length > 0
              ? { path: playbackSourceRef.current?.path ?? null, trackIds: contextTrackIds }
              : null,
        }),
      );
    };

    const savePosition = () => {
      lastPositionSaveAt = Date.now();
      const { currentTrack, currentPosition } = usePlaybackStore.getState();
      if (!currentTrack) {
        window.localStorage.removeItem(PLAYBACK_POSITION_STORAGE_KEY);
        return;
      }
      writeStorage(
        PLAYBACK_POSITION_STORAGE_KEY,
        serializePlaybackPosition({ trackId: currentTrack.id, positionSecs: currentPosition }),
      );
    };

    const flush = () => {
      saveSession();
      savePosition();
    };

    flush();
    const unsubscribe = usePlaybackStore.subscribe((state, previous) => {
      const trackChanged = state.currentTrack?.id !== previous.currentTrack?.id;
      if (
        trackChanged ||
        state.queue !== previous.queue ||
        state.playingNext !== previous.playingNext ||
        state.shuffleEnabled !== previous.shuffleEnabled ||
        state.repeatMode !== previous.repeatMode ||
        state.volume !== previous.volume
      ) {
        // Coalesce the bursts a track change or a volume drag produces.
        if (sessionTimer !== null) window.clearTimeout(sessionTimer);
        sessionTimer = window.setTimeout(saveSession, SESSION_SAVE_DELAY_MS);
      }

      if (trackChanged || state.isPlaying !== previous.isPlaying) {
        savePosition();
      } else if (
        state.currentPosition !== previous.currentPosition &&
        // A seek while paused is saved at once; playback is throttled.
        (!state.isPlaying || Date.now() - lastPositionSaveAt >= POSITION_SAVE_INTERVAL_MS)
      ) {
        savePosition();
      }
    });
    window.addEventListener("beforeunload", flush);

    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", flush);
      if (sessionTimer !== null) saveSession();
    };
  }, [playbackContextIdsRef, playbackSourceRef, restoreLastSession, sessionReady]);
};
