import { invoke } from "@muro/desktop/runtime";
import type { LibrarySnapshot, PlaylistSnapshot } from "./importApi";

// ============================================================================
// Library Operations
// ============================================================================

export const loadTracks = (dbPath: string) => {
  return invoke<LibrarySnapshot>("load_tracks", { dbPath });
};

export const clearTracks = (dbPath: string) => {
  return invoke<void>("clear_tracks", { dbPath });
};

export const acceptTracks = (dbPath: string, trackIds: string[]) => {
  return invoke<void>("accept_tracks", { dbPath, trackIds });
};

export const unacceptTracks = (dbPath: string, trackIds: string[]) => {
  return invoke<void>("unaccept_tracks", { dbPath, trackIds });
};

export const rejectTracks = (dbPath: string, trackIds: string[]) => {
  return invoke<void>("reject_tracks", { dbPath, trackIds });
};

// ============================================================================
// Playlist Operations
// ============================================================================

export const loadPlaylists = (dbPath: string) => {
  return invoke<PlaylistSnapshot>("load_playlists", { dbPath });
};

export const createPlaylist = (dbPath: string, id: string, name: string) => {
  return invoke<void>("create_playlist", {
    dbPath,
    id,
    name,
  });
};

export const deletePlaylist = (dbPath: string, playlistId: string) => {
  return invoke<void>("delete_playlist", {
    dbPath,
    playlistId,
  });
};

export const addTracksToPlaylist = (
  dbPath: string,
  playlistId: string,
  trackIds: string[]
) => {
  return invoke<void>("add_tracks_to_playlist", {
    dbPath,
    playlistId,
    trackIds,
  });
};

export const removeLastTracksFromPlaylist = (
  dbPath: string,
  playlistId: string,
  count: number
) => {
  return invoke<void>("remove_last_tracks_from_playlist", {
    dbPath,
    playlistId,
    count,
  });
};

// ============================================================================
// Backfill Operations
// ============================================================================

export const backfillSearchText = (dbPath: string) => {
  return invoke<number>("backfill_search_text", { dbPath });
};

export const backfillCoverArt = (dbPath: string) => {
  return invoke<number>("backfill_cover_art", { dbPath });
};

// ============================================================================
// Recently Played Operations
// ============================================================================

export const loadRecentlyPlayed = (dbPath: string, limit: number = 50) => {
  return invoke<import("./importApi").ImportedTrack[]>("load_recently_played", {
    dbPath,
    limit,
  });
};

export const recordTrackPlay = (dbPath: string, trackId: string) => {
  return invoke<void>("record_track_play", { dbPath, trackId });
};
