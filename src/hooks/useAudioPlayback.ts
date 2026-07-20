import { useCallback, useEffect, useRef } from "react";
import { listen } from "@muro/desktop/events";
import { t } from "../i18n";
import type { Track } from "../types";
import { usePlaybackStore, trackToCurrentTrack, notify } from "../stores";
import { useCastStore, isCastOutputActive } from "../stores/castStore";
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
import type { TransitionStatePayload } from "../utils/playbackApi";
import {
  castErrorCode,
  castGetState,
  castLoadTrack,
  castPause,
  castPlay,
  castSeek,
  castSetVolume,
  type CastDiscoverySnapshot,
  type CastMediaStatusEvent,
  type CastSessionState,
} from "../utils/castApi";

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
  const setTransition = usePlaybackStore((s) => s.setTransition);

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
        // While the cast output is active the receiver's status drives the
        // store; events from the (paused) local element are ignored.
        listen<PlaybackState>("muro://playback-state", (event) => {
          if (isCastOutputActive()) return;
          updateFromPlaybackState(event.payload);
        }),
        listen<number>("muro://playback-position", (event) => {
          if (isCastOutputActive()) return;
          setCurrentPosition(event.payload);
        }),
        listen<CastDiscoverySnapshot>("muro://cast-devices", (event) => {
          useCastStore.getState().applyDiscovery(event.payload);
        }),
        listen<CastSessionState>("muro://cast-state", (event) => {
          useCastStore.getState().applySessionState(event.payload);
        }),
        listen<CastMediaStatusEvent>("muro://cast-media-status", (event) => {
          const { status, finished } = event.payload;
          useCastStore.getState().applyMediaStatus(status);
          if (isCastOutputActive()) {
            setCurrentPosition(status.position);
            if (typeof status.duration === "number" && status.duration > 0) {
              setDuration(status.duration);
            }
            setIsPlaying(status.playerState === "playing" || status.playerState === "buffering");
          }
          if (finished) onTrackEndRef.current?.();
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
          if (isCastOutputActive()) return;
          onTrackEndRef.current?.();
        }),
        listen<TransitionStatePayload>("muro://transition-state", (event) => {
          const { status, progress, from_id, to_id, to_title } = event.payload;
          if (status === "cancelled") {
            setTransition(null);
            return;
          }
          setTransition({
            status,
            fromId: from_id,
            toId: to_id,
            toTitle: to_title,
            progress,
          });
        }),
      ]);

      const cleanup = () => listeners.forEach((removeListener) => removeListener());
      if (cancelled) {
        cleanup();
        return;
      }
      removeListeners = cleanup;

      // Recover cast session state first (survives a renderer reload).
      try {
        const castState = await castGetState();
        if (!cancelled) {
          useCastStore.getState().applySessionState(castState);
          useCastStore.getState().applyDiscovery(castState.discovery);
        }
      } catch {
        // The desktop bridge may predate cast support; local playback works.
      }

      // Get initial state
      try {
        const initialState = await playbackGetState();
        if (!cancelled && !isCastOutputActive()) updateFromPlaybackState(initialState);
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
  }, [setCurrentPosition, setTransition, updateFromPlaybackState]);

  useEffect(() => {
    if (!seekMode) {
      return;
    }
    playbackSetSeekMode(seekMode).catch(() => {
      notify.error("Failed to set seek mode");
    });
  }, [seekMode]);

  // Commands below route to exactly one output: the Cast receiver while a
  // cast session owns playback, the local audio element otherwise.
  const playTrack = useCallback(
    async (track: Track) => {
      if (isCastOutputActive()) {
        try {
          await castLoadTrack({
            trackId: track.id,
            sourcePath: track.sourcePath,
            title: track.title,
            artist: track.artist,
            album: track.album,
            durationSeconds: track.durationSeconds,
            coverArtPath: track.coverArtPath,
            startPositionSecs: 0,
            autoplay: true,
          });
          setIsPlaying(true);
          setCurrentPosition(0);
          setDuration(track.durationSeconds);
          setCurrentTrack(trackToCurrentTrack(track));
        } catch (error) {
          notify.error(
            castErrorCode(error) === "CAST_UNSUPPORTED_FORMAT"
              ? t("player.cast.unsupported")
              : t("player.cast.loadFailed"),
          );
        }
        return;
      }
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
    if (isCastOutputActive()) {
      const remoteState = useCastStore.getState().remoteMedia?.playerState;
      try {
        if (remoteState === "playing" || remoteState === "buffering") {
          await castPause();
          setIsPlaying(false);
        } else {
          await castPlay();
          setIsPlaying(true);
        }
      } catch (error) {
        notify.error(t("player.cast.commandFailed"));
      }
      return;
    }
    try {
      const isNowPlaying = await playbackToggle();
      setIsPlaying(isNowPlaying);
    } catch (error) {
      notify.error("Failed to toggle playback");
    }
  }, [setIsPlaying]);

  const play = useCallback(async () => {
    if (isCastOutputActive()) {
      try {
        await castPlay();
        setIsPlaying(true);
      } catch (error) {
        notify.error(t("player.cast.commandFailed"));
      }
      return;
    }
    try {
      await playbackPlay();
      setIsPlaying(true);
    } catch (error) {
      notify.error("Failed to play");
    }
  }, [setIsPlaying]);

  const pause = useCallback(async () => {
    if (isCastOutputActive()) {
      try {
        await castPause();
        setIsPlaying(false);
      } catch (error) {
        notify.error(t("player.cast.commandFailed"));
      }
      return;
    }
    try {
      await playbackPause();
      setIsPlaying(false);
    } catch (error) {
      notify.error("Failed to pause");
    }
  }, [setIsPlaying]);

  const seek = useCallback(
    async (positionSecs: number) => {
      if (isCastOutputActive()) {
        try {
          await castSeek(positionSecs);
          setCurrentPosition(positionSecs);
        } catch (error) {
          notify.error(t("player.cast.commandFailed"));
        }
        return;
      }
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
      const clamped = Math.max(0, Math.min(1, newVolume));
      if (isCastOutputActive()) {
        try {
          await castSetVolume(clamped);
          setVolume(clamped);
        } catch (error) {
          notify.error(t("player.cast.commandFailed"));
        }
        return;
      }
      try {
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
