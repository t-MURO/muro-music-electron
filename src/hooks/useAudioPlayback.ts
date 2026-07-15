import { useCallback, useEffect, useRef } from "react";
import { listen } from "@muro/desktop/events";
import type { Track } from "../types";
import { usePlaybackStore, trackToCurrentTrack, notify } from "../stores";
import {
  playbackGetState,
  playbackPause,
  playbackPlay,
  playbackPlayFile,
  playbackSeek,
  playbackSetSeekMode,
  playbackSetVolume,
  playbackToggle,
  type PlaybackState,
} from "../utils";

// Keep the playback track type available to hook consumers.
export type { CurrentTrack } from "../stores";

export type AudioPlaybackState = {
  isPlaying: boolean;
  currentPosition: number;
  duration: number;
  volume: number;
  currentTrack: ReturnType<typeof usePlaybackStore.getState>["currentTrack"];
};

type UseAudioPlaybackOptions = {
  onTrackEnd?: () => void;
  onMediaControl?: (action: string) => void;
  seekMode?: "fast" | "accurate";
};

type MediaControlEvent = string | {
  action?: string;
  source?: string;
};

export const useAudioPlayback = (options: UseAudioPlaybackOptions = {}) => {
  const { onTrackEnd, onMediaControl, seekMode } = options;

  // Get state and actions from store
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentTrack = usePlaybackStore((s) => s.currentTrack);
  const currentPosition = usePlaybackStore((s) => s.currentPosition);
  const duration = usePlaybackStore((s) => s.duration);
  const volume = usePlaybackStore((s) => s.volume);

  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying);
  const setCurrentTrack = usePlaybackStore((s) => s.setCurrentTrack);
  const setCurrentPosition = usePlaybackStore((s) => s.setCurrentPosition);
  const setDuration = usePlaybackStore((s) => s.setDuration);
  const setVolume = usePlaybackStore((s) => s.setVolume);

  // Use refs for callbacks to avoid effect re-runs
  const onTrackEndRef = useRef(onTrackEnd);
  const onMediaControlRef = useRef(onMediaControl);
  const latestGlobalMediaControlRef = useRef<Map<string, number>>(new Map());
  const pendingMediaSessionControlsRef = useRef<Set<{
    group: string;
    receivedAt: number;
    timeoutId: number;
  }>>(new Set());

  useEffect(() => {
    onTrackEndRef.current = onTrackEnd;
  }, [onTrackEnd]);

  useEffect(() => {
    onMediaControlRef.current = onMediaControl;
  }, [onMediaControl]);

  // Convert the playback runtime state to the store format.
  const updateFromPlaybackState = useCallback(
    (playbackState: PlaybackState) => {
      setIsPlaying(playbackState.is_playing);
      setCurrentPosition(playbackState.current_position);
      setDuration(playbackState.duration);
      setVolume(playbackState.volume);

      if (playbackState.current_track) {
        setCurrentTrack({
          id: playbackState.current_track.id,
          title: playbackState.current_track.title,
          artist: playbackState.current_track.artist,
          album: playbackState.current_track.album,
          sourcePath: playbackState.current_track.source_path,
          durationSeconds: playbackState.duration,
          coverArtPath: playbackState.current_track.cover_art_path,
          coverArtThumbPath: playbackState.current_track.cover_art_thumb_path,
        });
      } else {
        setCurrentTrack(null);
      }
    },
    [setIsPlaying, setCurrentPosition, setDuration, setVolume, setCurrentTrack]
  );

  // Listen for playback state updates from the desktop runtime.
  useEffect(() => {
    let cancelled = false;
    let removeListeners: (() => void) | null = null;

    const setup = async () => {
      const listeners = await Promise.all([
        listen<PlaybackState>("muro://playback-state", (event) => {
          updateFromPlaybackState(event.payload);
        }),
        listen<number>("muro://playback-position", (event) => {
          setCurrentPosition(event.payload);
        }),
        listen<MediaControlEvent>("muro://media-control", (event) => {
          const action = typeof event.payload === "string"
            ? event.payload
            : event.payload?.action;
          if (!action) return;

          const source = typeof event.payload === "string"
            ? "legacy"
            : event.payload.source ?? "unknown";
          const group = action === "play" || action === "pause" || action === "toggle"
            ? "playback"
            : action;
          const receivedAt = performance.now();

          if (source === "global-shortcut") {
            latestGlobalMediaControlRef.current.set(group, receivedAt);
            for (const pending of pendingMediaSessionControlsRef.current) {
              if (pending.group !== group) continue;
              window.clearTimeout(pending.timeoutId);
              pendingMediaSessionControlsRef.current.delete(pending);
            }
            onMediaControlRef.current?.(action);
            return;
          }

          if (source === "media-session") {
            const latestGlobal = latestGlobalMediaControlRef.current.get(group) ?? -Infinity;
            if (receivedAt - latestGlobal < 250) return;

            const pending = {
              group,
              receivedAt,
              timeoutId: 0,
            };
            pending.timeoutId = window.setTimeout(() => {
              pendingMediaSessionControlsRef.current.delete(pending);
              const globalAfterEvent = latestGlobalMediaControlRef.current.get(group) ?? -Infinity;
              if (globalAfterEvent >= receivedAt && globalAfterEvent - receivedAt < 250) return;
              onMediaControlRef.current?.(action);
            }, 60);
            pendingMediaSessionControlsRef.current.add(pending);
            return;
          }

          onMediaControlRef.current?.(action);
        }),
        listen("muro://track-ended", () => {
          onTrackEndRef.current?.();
        }),
      ]);

      const cleanup = () => listeners.forEach((removeListener) => removeListener());
      if (cancelled) {
        cleanup();
        return;
      }
      removeListeners = cleanup;

      // Get initial state
      try {
        const initialState = await playbackGetState();
        if (!cancelled) updateFromPlaybackState(initialState);
      } catch (error) {
        if (!cancelled) notify.error("Failed to get initial playback state");
      }
    };

    void setup();

    return () => {
      cancelled = true;
      removeListeners?.();
      for (const pending of pendingMediaSessionControlsRef.current) {
        window.clearTimeout(pending.timeoutId);
      }
      pendingMediaSessionControlsRef.current.clear();
    };
  }, [setCurrentPosition, updateFromPlaybackState]);

  useEffect(() => {
    if (!seekMode) {
      return;
    }
    playbackSetSeekMode(seekMode).catch(() => {
      notify.error("Failed to set seek mode");
    });
  }, [seekMode]);

  const playTrack = useCallback(
    async (track: Track) => {
      try {
        await playbackPlayFile(
          track.id,
          track.title,
          track.artist,
          track.album,
          track.sourcePath,
          track.durationSeconds,
          track.coverArtPath,
          track.coverArtThumbPath
        );
        setIsPlaying(true);
        setCurrentPosition(0);
        setDuration(track.durationSeconds);
        setCurrentTrack(trackToCurrentTrack(track));
      } catch (error) {
        notify.error("Failed to play track");
      }
    },
    [setIsPlaying, setCurrentPosition, setDuration, setCurrentTrack]
  );

  const togglePlay = useCallback(async () => {
    try {
      const isNowPlaying = await playbackToggle();
      setIsPlaying(isNowPlaying);
    } catch (error) {
      notify.error("Failed to toggle playback");
    }
  }, [setIsPlaying]);

  const play = useCallback(async () => {
    try {
      await playbackPlay();
      setIsPlaying(true);
    } catch (error) {
      notify.error("Failed to play");
    }
  }, [setIsPlaying]);

  const pause = useCallback(async () => {
    try {
      await playbackPause();
      setIsPlaying(false);
    } catch (error) {
      notify.error("Failed to pause");
    }
  }, [setIsPlaying]);

  const seek = useCallback(
    async (positionSecs: number) => {
      try {
        await playbackSeek(positionSecs);
        setCurrentPosition(positionSecs);
      } catch (error) {
        notify.error("Failed to seek");
      }
    },
    [setCurrentPosition]
  );

  const handleSetVolume = useCallback(
    async (newVolume: number) => {
      try {
        const clamped = Math.max(0, Math.min(1, newVolume));
        await playbackSetVolume(clamped);
        setVolume(clamped);
      } catch (error) {
        notify.error("Failed to set volume");
      }
    },
    [setVolume]
  );

  return {
    isPlaying,
    currentPosition,
    duration,
    volume,
    currentTrack,
    playTrack,
    togglePlay,
    play,
    pause,
    seek,
    setVolume: handleSetVolume,
  };
};
