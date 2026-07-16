import { invoke } from "@muro/desktop/runtime";
import type { LibrarySnapshot, PlaylistSnapshot } from "./importApi";
import type { ArtistProfile } from "../types";

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

export type DeleteTracksResult = {
  deletedTrackIds: string[];
  failures: Array<{ trackId: string; path: string; message: string }>;
};

export const deleteTracks = (
  dbPath: string,
  trackIds: string[],
  deleteFromDisk: boolean
) => {
  return invoke<DeleteTracksResult>("delete_tracks", {
    dbPath,
    trackIds,
    deleteFromDisk,
  });
};

export const updateTrackBeatGrid = (dbPath: string, trackId: string, beatGridJson: string) =>
  invoke<{ updated: boolean }>("update_track_beat_grid", { dbPath, trackId, beatGridJson });

export const loadCachedArtistProfiles = (dbPath: string) =>
  invoke<ArtistProfile[]>("load_cached_artist_profiles", { dbPath });

export const getArtistProfile = (
  dbPath: string,
  artistName: string,
  force = false,
  providerKeys: ArtistProfileProviderKeys = {},
) => invoke<ArtistProfile>("get_artist_profile", {
  dbPath,
  artistName,
  force,
  ...providerKeys,
});

export type ArtistProfileProviderKeys = {
  fanartApiKey?: string;
  lastFmApiKey?: string;
  theAudioDbApiKey?: string;
};

export type ArtistProfileScanResult = {
  checked: number;
  updated: number;
  failed: number;
  queued: number;
  remaining: number;
  totalArtists: number;
};

export const scanArtistProfiles = (
  dbPath: string,
  providerKeys: ArtistProfileProviderKeys = {},
  limit = 25,
) => invoke<ArtistProfileScanResult>("scan_artist_profiles", { dbPath, ...providerKeys, limit });

export type AlbumCoverScanResult = {
  checked: number;
  updated: number;
  failed: number;
  queued: number;
  remaining: number;
  totalAlbums: number;
};

export const scanAlbumCovers = (dbPath: string, limit = 25) =>
  invoke<AlbumCoverScanResult>("scan_album_covers", { dbPath, limit });

// ============================================================================
// Playlist Operations
// ============================================================================

export const loadPlaylists = (dbPath: string) => {
  return invoke<PlaylistSnapshot>("load_playlists", { dbPath });
};

export const createPlaylist = (
  dbPath: string,
  id: string,
  name: string,
  folderId?: string,
) => {
  return invoke<void>("create_playlist", {
    dbPath,
    id,
    name,
    folderId,
  });
};

export const updatePlaylist = (
  dbPath: string,
  playlistId: string,
  updates: { name?: string; folderId?: string | null },
) => invoke<void>("update_playlist", { dbPath, playlistId, ...updates });

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

export const setPlaylistTracks = (
  dbPath: string,
  playlistId: string,
  trackIds: string[]
) => {
  return invoke<void>("set_playlist_tracks", {
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

export const createPlaylistFolder = (dbPath: string, id: string, name: string) =>
  invoke<void>("create_playlist_folder", { dbPath, id, name });

export const updatePlaylistFolder = (dbPath: string, folderId: string, name: string) =>
  invoke<void>("update_playlist_folder", { dbPath, folderId, name });

export const deletePlaylistFolder = (dbPath: string, folderId: string) =>
  invoke<void>("delete_playlist_folder", { dbPath, folderId });

export type PlaylistFolderImportScan = {
  name: string;
  files: string[];
};

export const listPlaylistFiles = (directoryPath: string) =>
  invoke<PlaylistFolderImportScan>("list_playlist_files", { directoryPath });

export const importPlaylistFile = (dbPath: string, filePath: string) =>
  invoke<import("./importApi").ImportedPlaylistFile>("import_playlist_file", {
    dbPath,
    filePath,
  });

export const exportPlaylistFile = (
  dbPath: string,
  playlistId: string,
  filePath: string,
) => invoke<{ exported: number; filePath: string }>("export_playlist_file", {
  dbPath,
  playlistId,
  filePath,
});

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
