import { invoke } from "@muro/desktop/runtime";
import type { TransitionPlan } from "../lib/mix/plan";

// ============================================================================
// Types
// ============================================================================

export type PlaybackState = {
  is_playing: boolean;
  current_position: number;
  duration: number;
  volume: number;
  current_track: {
    id: string;
    title: string;
    artist: string;
    album: string;
    source_path: string;
    cover_art_path?: string;
    cover_art_thumb_path?: string;
  } | null;
};

// ============================================================================
// Playback Control
// ============================================================================

export const playbackPlayFile = (
  id: string,
  title: string,
  artist: string,
  album: string,
  sourcePath: string,
  durationHint: number,
  coverArtPath?: string,
  coverArtThumbPath?: string
) => {
  return invoke<void>("playback_play_file", {
    id,
    title,
    artist,
    album,
    sourcePath,
    durationHint,
    coverArtPath,
    coverArtThumbPath,
  });
};

export const playbackToggle = () => {
  return invoke<boolean>("playback_toggle");
};

export const playbackPlay = () => {
  return invoke<void>("playback_play");
};

export const playbackPause = () => {
  return invoke<void>("playback_pause");
};

export const playbackStop = () => {
  return invoke<void>("playback_stop");
};

export const playbackSeek = (positionSecs: number) => {
  return invoke<void>("playback_seek", { positionSecs });
};

export const playbackSetVolume = (volume: number) => {
  return invoke<void>("playback_set_volume", { volume });
};

export const playbackSetSeekMode = (mode: "fast" | "accurate") => {
  return invoke<void>("playback_set_seek_mode", { mode });
};

export const playbackGetState = () => {
  return invoke<PlaybackState>("playback_get_state");
};

export const playbackIsFinished = () => {
  return invoke<boolean>("playback_is_finished");
};

// ============================================================================
// DJ Transitions
// ============================================================================

export type TransitionStatePayload = {
  status: "armed" | "active" | "completed" | "cancelled";
  progress: number;
  from_id: string;
  to_id: string;
  to_title: string;
};

export const playbackTransitionTo = (
  track: {
    id: string;
    title: string;
    artist: string;
    album: string;
    sourcePath: string;
    durationHint: number;
    coverArtPath?: string;
    coverArtThumbPath?: string;
  },
  plan: TransitionPlan,
  preservePitch = true
) => {
  return invoke<void>("playback_transition_to", { track, plan, preservePitch });
};

export const playbackCancelTransition = () => {
  return invoke<void>("playback_cancel_transition");
};
