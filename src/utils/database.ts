import { invoke } from "@muro/desktop/runtime";
import type { LibrarySnapshot, PlaylistSnapshot } from "./importApi";
import type { ArtistImageCandidate, ArtistProfile } from "../types";

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

export const searchArtistImages = (
  dbPath: string,
  artistName: string,
  providerKeys: ArtistProfileProviderKeys = {},
) => invoke<ArtistImageCandidate[]>("search_artist_images", {
  dbPath,
  artistName,
  ...providerKeys,
});

export const setArtistImage = (
  dbPath: string,
  artistName: string,
  candidate: ArtistImageCandidate,
) => invoke<ArtistProfile>("set_artist_image", { dbPath, artistName, candidate });

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

export type FetchedCoverArt = {
  fullPath: string;
  thumbPath: string;
  sourceUrl?: string | null;
};

export const fetchTrackCoverArt = (
  dbPath: string,
  trackId: string,
  metadata: { album?: string; artist?: string } = {},
) => invoke<FetchedCoverArt | null>("fetch_track_cover_art", {
  dbPath,
  trackId,
  ...metadata,
});

export type MetadataSearchCandidate = {
  id: string;
  score: number;
  recordingId: string | null;
  releaseId: string | null;
  releaseGroupId: string | null;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  year: number | null;
  country: string | null;
  status: string | null;
  genre: string | null;
  albumMatch: boolean;
};

export const searchTrackMetadata = (
  metadata: { title: string; artist: string; album?: string },
) => invoke<MetadataSearchCandidate[]>("search_track_metadata", metadata);

export type AcoustIdCandidate = MetadataSearchCandidate & {
  acoustidId: string;
};

export type AcoustIdIdentificationResult = {
  trackId: string;
  cached: boolean;
  duration: number;
  candidates: AcoustIdCandidate[];
};

export const identifyTrackWithAcoustId = (
  dbPath: string,
  trackId: string,
  clientKey: string,
  force = false,
) => invoke<AcoustIdIdentificationResult>("identify_track_acoustid", {
  dbPath,
  trackId,
  clientKey,
  force,
});

export type AlbumMetadataCandidate = {
  id: string;
  score: number;
  title: string;
  artist: string;
  releaseGroupId: string | null;
  year: number | null;
  country: string | null;
  status: string | null;
  barcode: string | null;
  trackCount: number;
  disambiguation: string | null;
};

export type AlbumMetadataTrack = {
  id: string;
  recordingId: string | null;
  title: string;
  artist: string;
  trackNumber: number;
  trackTotal: number;
  discNumber: number;
  discTotal: number;
};

export type AlbumMetadataRelease = {
  id: string;
  title: string;
  artist: string;
  releaseGroupId: string | null;
  year: number | null;
  country: string | null;
  status: string | null;
  label: string | null;
  genre: string | null;
  discTotal: number | null;
  tracks: AlbumMetadataTrack[];
};

export const searchAlbumMetadata = (metadata: { album: string; artist: string }) =>
  invoke<AlbumMetadataCandidate[]>("search_album_metadata", metadata);

export const loadAlbumMetadata = (releaseId: string) =>
  invoke<AlbumMetadataRelease>("load_album_metadata", { releaseId });

export type TechnicalMetadataScanResult = {
  checked: number;
  updated: number;
  failed: number;
  remaining: number;
};

export const scanTechnicalMetadata = (dbPath: string, limit = 25) =>
  invoke<TechnicalMetadataScanResult>("scan_technical_metadata", { dbPath, limit });

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
  sortOrder?: number,
) => {
  return invoke<void>("create_playlist", {
    dbPath,
    id,
    name,
    folderId,
    sortOrder,
  });
};

export const updatePlaylist = (
  dbPath: string,
  playlistId: string,
  updates: { name?: string; folderId?: string | null; sortOrder?: number },
) => invoke<void>("update_playlist", { dbPath, playlistId, ...updates });

export const reorderPlaylists = (
  dbPath: string,
  items: Array<{ id: string; folderId?: string; sortOrder: number }>,
) => invoke<void>("reorder_playlists", { dbPath, items });

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

export const createPlaylistFolder = (
  dbPath: string,
  id: string,
  name: string,
  parentId?: string,
  sortOrder?: number,
) => invoke<void>("create_playlist_folder", { dbPath, id, name, parentId, sortOrder });

export const updatePlaylistFolder = (dbPath: string, folderId: string, name: string) =>
  invoke<void>("update_playlist_folder", { dbPath, folderId, name });

export const deletePlaylistFolder = (dbPath: string, folderId: string) =>
  invoke<void>("delete_playlist_folder", { dbPath, folderId });

export type PlaylistFolderImportScan = {
  name: string;
  audioFileCount: number;
  files: string[];
  entries: Array<{
    path: string;
    relativePath: string;
    folderPath: string | null;
  }>;
  folders: Array<{
    path: string;
    name: string;
    parentPath: string | null;
  }>;
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

export type OrganizedLibraryExportResult = {
  exportRoot: string;
  tracks: number;
  filesCopied: number;
  tracksFailed: number;
  playlistsExported: number;
  playlistEntriesExported: number;
  playlistEntriesMissing: number;
  librarySwitchRequested: boolean;
  librarySwitched: boolean;
  librarySwitchError: string | null;
  failures: Array<{ trackId: string; sourcePath: string; message: string }>;
};

export const exportOrganizedLibrary = (
  dbPath: string,
  destinationPath: string,
  useAsCurrentLibrary: boolean,
) => invoke<OrganizedLibraryExportResult>("export_organized_library", {
  dbPath,
  destinationPath,
  useAsCurrentLibrary,
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
