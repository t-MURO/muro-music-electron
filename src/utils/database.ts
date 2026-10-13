import { invoke } from "@muro/desktop/runtime";
import type { LibrarySnapshot, PlaylistSnapshot } from "./importApi";
import type {
  AlbumCoverCandidate,
  ArtistImageCandidate,
  ArtistProfile,
} from "../types";
import type { ArtistCreditInput } from "./artistCredits";
import type { MetadataWriteResult } from "./tagWriteFailures";

// ============================================================================
// Library Operations
// ============================================================================

export const loadTracks = (
  libraryRoot?: string,
  artistSeparatorExceptions?: string[],
) => {
  return invoke<LibrarySnapshot>("load_tracks", {
    libraryRoot,
    artistSeparatorExceptions,
  });
};

export const clearTracks = () => {
  return invoke<void>("clear_tracks");
};

export type AcceptTracksResult = {
  accepted: number;
  acceptedTrackIds: string[];
  moved: Array<{ trackId: string; sourcePath: string; filename: string }>;
  failures: Array<{ trackId: string; sourcePath: string; message: string }>;
};

export const acceptTracks = (
  trackIds: string[],
  options?: { organize?: boolean; libraryFolder?: string },
) => {
  return invoke<AcceptTracksResult>("accept_tracks", {
    trackIds,
    organize: options?.organize ?? false,
    libraryFolder: options?.libraryFolder ?? "",
  });
};

export type LibraryStructureIssue = {
  trackId: string;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  filename: string;
  currentPath: string;
  currentFolder: string;
  expectedFolder: string;
};

export type LibraryStructureValidationResult = {
  checked: number;
  unavailable: number;
  outsideRoot: number;
  misplaced: LibraryStructureIssue[];
};

export type LibraryStructureRepairResult = {
  requested: number;
  moved: Array<{ trackId: string; sourcePath: string; filename: string }>;
  skipped: number;
  failures: Array<{ trackId: string; sourcePath: string; message: string }>;
};

export const validateLibraryStructure = (
  libraryRoot: string,
) => invoke<LibraryStructureValidationResult>("validate_library_structure", {
  libraryRoot,
});

export const repairLibraryStructure = (
  libraryRoot: string,
  trackIds: string[],
) => invoke<LibraryStructureRepairResult>("repair_library_structure", {
  libraryRoot,
  trackIds,
});

export const unacceptTracks = (trackIds: string[]) => {
  return invoke<void>("unaccept_tracks", { trackIds });
};

export const rejectTracks = (trackIds: string[]) => {
  return invoke<void>("reject_tracks", { trackIds });
};

export type DeleteTracksResult = {
  deletedTrackIds: string[];
  failures: Array<{ trackId: string; path: string; message: string }>;
};

export const deleteTracks = (
  trackIds: string[],
  deleteFromDisk: boolean
) => {
  return invoke<DeleteTracksResult>("delete_tracks", {
    trackIds,
    deleteFromDisk,
  });
};

export const updateTrackBeatGrid = (trackId: string, beatGridJson: string) =>
  invoke<{ updated: boolean }>("update_track_beat_grid", { trackId, beatGridJson });

export const loadCachedArtistProfiles = () =>
  invoke<ArtistProfile[]>("load_cached_artist_profiles");

export type ArtistProfileIdentity = {
  artistId?: string;
  musicBrainzId?: string;
};

export const getArtistProfile = (
  artistName: string,
  force = false,
  providerKeys: ArtistProfileProviderKeys = {},
  identity: ArtistProfileIdentity = {},
) => invoke<ArtistProfile>("get_artist_profile", {
  artistName,
  ...identity,
  force,
  ...providerKeys,
});

export const searchArtistImages = (
  artistName: string,
  providerKeys: ArtistProfileProviderKeys = {},
  identity: ArtistProfileIdentity = {},
) => invoke<ArtistImageCandidate[]>("search_artist_images", {
  artistName,
  ...identity,
  ...providerKeys,
});

export const setArtistImage = (
  artistName: string,
  candidate: ArtistImageCandidate,
  identity: ArtistProfileIdentity = {},
) => invoke<ArtistProfile>("set_artist_image", {
  artistName,
  candidate,
  ...identity,
});

export type ArtistProfileProviderKeys = {
  braveSearchApiKey?: string;
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
  providerKeys: ArtistProfileProviderKeys = {},
  limit = 25,
) => invoke<ArtistProfileScanResult>("scan_artist_profiles", { ...providerKeys, limit });

export type FetchedCoverArt = {
  fullPath: string;
  thumbPath: string;
  sourceUrl?: string | null;
  provider?: "cover-art-archive" | "deezer" | "brave-search" | null;
};

export const fetchTrackCoverArt = (
  trackId: string,
  metadata: { album?: string; artist?: string } = {},
) => invoke<FetchedCoverArt | null>("fetch_track_cover_art", {
  trackId,
  ...metadata,
});

export const searchAlbumCoverImages = (
  metadata: { album: string; artist: string },
  braveSearchApiKey: string,
) => invoke<AlbumCoverCandidate[]>("search_album_cover_images", {
  ...metadata,
  braveSearchApiKey,
});

export const cacheAlbumCoverCandidate = (
  candidate: AlbumCoverCandidate,
) => invoke<FetchedCoverArt>("cache_album_cover_candidate", { candidate });

export type MetadataSearchCandidate = {
  id: string;
  score: number;
  recordingId: string | null;
  releaseId: string | null;
  releaseGroupId: string | null;
  title: string;
  artist: string;
  artistCredits?: ArtistCreditInput[];
  album: string;
  albumArtist: string;
  albumArtistCredits?: ArtistCreditInput[];
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
  trackId: string,
  clientKey: string,
  force = false,
) => invoke<AcoustIdIdentificationResult>("identify_track_acoustid", {
  trackId,
  clientKey,
  force,
});

export type AlbumMetadataCandidate = {
  id: string;
  score: number;
  title: string;
  artist: string;
  artistCredits?: ArtistCreditInput[];
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
  artistCredits?: ArtistCreditInput[];
  trackNumber: number;
  trackTotal: number;
  discNumber: number;
  discTotal: number;
};

export type AlbumMetadataRelease = {
  id: string;
  title: string;
  artist: string;
  artistCredits?: ArtistCreditInput[];
  albumArtistCredits?: ArtistCreditInput[];
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

export const scanTechnicalMetadata = (limit = 25) =>
  invoke<TechnicalMetadataScanResult>("scan_technical_metadata", { limit });

// ============================================================================
// Playlist Operations
// ============================================================================

export const loadPlaylists = (libraryRoot?: string) => {
  return invoke<PlaylistSnapshot>("load_playlists", { libraryRoot });
};

export const createPlaylist = (
  id: string,
  name: string,
  folderId?: string,
  sortOrder?: number,
  sourcePath?: string,
) => {
  return invoke<void>("create_playlist", {
    id,
    name,
    folderId,
    sortOrder,
    sourcePath,
  });
};

export const updatePlaylist = (
  playlistId: string,
  updates: { name?: string; folderId?: string | null; sortOrder?: number },
) => invoke<void>("update_playlist", { playlistId, ...updates });

export const reorderPlaylists = (
  items: Array<{ id: string; folderId?: string; sortOrder: number }>,
) => invoke<void>("reorder_playlists", { items });

export const deletePlaylist = (playlistId: string) => {
  return invoke<void>("delete_playlist", {
    playlistId,
  });
};

export const deletePlaylists = (playlistIds: string[]) =>
  invoke<{ deleted: number }>("delete_playlists", { playlistIds });

export const restorePlaylists = (
  playlists: Array<{
    id: string;
    name: string;
    trackIds: string[];
    folderId?: string;
    sortOrder: number;
    sourcePath?: string;
    sourceMtimeMs?: number;
    sourceSize?: number;
    sourceSyncError?: string;
    lastSyncedAt?: number;
  }>,
) => invoke<{ restored: number }>("restore_playlists", { playlists });

export const addTracksToPlaylist = (
  playlistId: string,
  trackIds: string[]
) => {
  return invoke<void>("add_tracks_to_playlist", {
    playlistId,
    trackIds,
  });
};

export const setPlaylistTracks = (
  playlistId: string,
  trackIds: string[]
) => {
  return invoke<void>("set_playlist_tracks", {
    playlistId,
    trackIds,
  });
};

export const removeLastTracksFromPlaylist = (
  playlistId: string,
  count: number
) => {
  return invoke<void>("remove_last_tracks_from_playlist", {
    playlistId,
    count,
  });
};

export const createPlaylistFolder = (
  id: string,
  name: string,
  parentId?: string,
  sortOrder?: number,
) => invoke<void>("create_playlist_folder", { id, name, parentId, sortOrder });

export const updatePlaylistFolder = (folderId: string, name: string) =>
  invoke<void>("update_playlist_folder", { folderId, name });

export const deletePlaylistFolder = (folderId: string) =>
  invoke<void>("delete_playlist_folder", { folderId });

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

export const importPlaylistFile = (filePath: string) =>
  invoke<import("./importApi").ImportedPlaylistFile>("import_playlist_file", {
    filePath,
  });

export type PlaylistSourceSyncResult = {
  playlistId: string;
  name: string;
  sourcePath: string;
  trackIds: string[];
  imported: import("./importApi").ImportedTrack[];
  added: number;
  removed: number;
  skipped: number;
  changed: boolean;
  sourceSyncError: string | null;
  errorChanged: boolean;
  reason: "startup" | "watch" | "manual";
};

export const configurePlaylistSync = () =>
  invoke<{ linked: number; synced: number; changed: number }>(
    "configure_playlist_sync",
  );

export const syncPlaylistSource = (playlistId: string) =>
  invoke<PlaylistSourceSyncResult | null>("sync_playlist_source", {
    playlistId,
  });

export const exportPlaylistFile = (
  playlistId: string,
  filePath: string,
) => invoke<{ exported: number; filePath: string }>("export_playlist_file", {
  playlistId,
  filePath,
});

export type PlaylistCollectionExportResult = {
  exportRoot: string;
  playlistsExported: number;
  playlistEntriesExported: number;
};

export const exportAllPlaylists = (
  destinationPath: string,
) => invoke<PlaylistCollectionExportResult>("export_all_playlists", {
  destinationPath,
});

export type ItunesLibraryExportResult = {
  destinationPath: string;
  tracksExported: number;
  missingTracksReferenced: number;
  playlistFoldersExported: number;
  playlistsExported: number;
  playlistEntriesExported: number;
  playlistEntriesSkipped: number;
};

export const exportItunesLibrary = (
  destinationPath: string,
) => invoke<ItunesLibraryExportResult>("export_itunes_library", {
  destinationPath,
});

export type LibraryBackupResult = {
  destinationPath: string;
  bytes: number;
  manifest: {
    version: number;
    backupId: string;
    createdAt: string;
    counts: {
      tracks: number;
      playlists: number;
      playlistFolders: number;
      playlistEntries: number;
      artworkFiles: number;
      smartCrates: number;
    };
  };
};

export const createLibraryBackup = (
  destinationPath: string,
  settingsJson: string,
  smartCratesJson: string,
) => invoke<LibraryBackupResult>("create_library_backup", {
  destinationPath,
  settingsJson,
  smartCratesJson,
});

export type LibraryRestoreResult = {
  archivePath: string;
  recoveryPath: string | null;
  settingsJson: string;
  smartCratesJson: string;
  restoredArtworkFiles: number;
  manifest: LibraryBackupResult["manifest"];
};

export const restoreLibraryBackup = (archivePath: string) =>
  invoke<LibraryRestoreResult>("restore_library_backup", { archivePath });

export type MetadataHistoryEntry = {
  id: number;
  trackId: string;
  changedAt: string;
  source: string;
  title: string;
  artist: string;
  changes: Record<string, { before: unknown; after: unknown }>;
};

export const listMetadataHistory = (
  trackId?: string,
  limit = 100,
) => invoke<MetadataHistoryEntry[]>("list_metadata_history", { trackId, limit });

export const rollbackMetadataChange = (
  historyId: number,
  field: string,
) => invoke<MetadataWriteResult & { trackId: string; updates: Record<string, unknown> }>(
  "rollback_metadata_change",
  { historyId, field },
);

export type PlaylistHistoryState = {
  entries: Array<{ id: number; action: string; createdAt: string; undone: boolean }>;
  canUndo: boolean;
  canRedo: boolean;
};

export type PlaylistSnapshotEntry = {
  id: string;
  name: string;
  createdAt: string;
};

export const listPlaylistHistory = (limit = 50) =>
  invoke<PlaylistHistoryState>("list_playlist_history", { limit });
export const undoPlaylistHistory = () =>
  invoke("undo_playlist_history");
export const redoPlaylistHistory = () =>
  invoke("redo_playlist_history");
export const createPlaylistSnapshot = (name: string) =>
  invoke<PlaylistSnapshotEntry>("create_playlist_snapshot", { name });
export const listPlaylistSnapshots = () =>
  invoke<PlaylistSnapshotEntry[]>("list_playlist_snapshots");
export const restorePlaylistSnapshot = (snapshotId: string) =>
  invoke("restore_playlist_snapshot", { snapshotId });
export const deletePlaylistSnapshot = (snapshotId: string) =>
  invoke<{ deleted: boolean }>("delete_playlist_snapshot", { snapshotId });

export type ListeningStatistics = {
  listeningSeconds: number;
  plays: number;
  uniqueTracks: number;
  discoveryRate: number;
  topArtists: Array<{ name: string; plays: number; listeningSeconds: number }>;
  topAlbums: Array<{ name: string; plays: number; listeningSeconds: number }>;
  monthly: Array<{ month: string; plays: number; listeningSeconds: number }>;
  neglectedTracks: Array<{
    id: string;
    title: string;
    artist: string;
    album: string;
    lastPlayedAt: string | null;
    playCount: number;
  }>;
};

export const loadListeningStatistics = () =>
  invoke<ListeningStatistics>("load_listening_statistics");

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
  destinationPath: string,
  useAsCurrentLibrary: boolean,
) => invoke<OrganizedLibraryExportResult>("export_organized_library", {
  destinationPath,
  useAsCurrentLibrary,
});

// ============================================================================
// Backfill Operations
// ============================================================================

export const backfillSearchText = () => {
  return invoke<number>("backfill_search_text");
};

export const backfillCoverArt = () => {
  return invoke<number>("backfill_cover_art");
};

export type ArtistCreditMigrationResult = {
  skipped: boolean;
  tracksChecked: number;
  setsCreated: number;
  setsReplaced: number;
  creditsCreated: number;
};

export const migrateArtistCredits = (
  artistSeparatorExceptions: string[] = [],
) => invoke<ArtistCreditMigrationResult>("migrate_artist_credits", {
  artistSeparatorExceptions,
});

export type ArtistMergeIdentity = {
  artistId: string;
  musicBrainzId?: string;
};

export type ArtistMergeResult = {
  sourceArtistId: string;
  artistId: string;
  name: string;
  musicBrainzId: string | null;
  creditsMerged: number;
  tracksAffected: number;
};

export const mergeArtists = (
  source: ArtistMergeIdentity,
  target: ArtistMergeIdentity,
) => invoke<ArtistMergeResult>("merge_artists", {
  sourceArtistId: source.artistId,
  sourceMusicBrainzId: source.musicBrainzId,
  targetArtistId: target.artistId,
  targetMusicBrainzId: target.musicBrainzId,
});

// ============================================================================
// Recently Played Operations
// ============================================================================

export const loadRecentlyPlayed = (
  limit: number = 50,
  libraryRoot?: string,
  artistSeparatorExceptions?: string[],
) => {
  return invoke<import("./importApi").ImportedTrack[]>("load_recently_played", {
    limit,
    libraryRoot,
    artistSeparatorExceptions,
  });
};

export const recordTrackPlay = (trackId: string) => {
  return invoke<{ historyId: number; playedAt: string }>("record_track_play", {
    trackId,
  });
};

export const updatePlayHistory = (
  historyId: number,
  listenedSeconds: number,
) => invoke<{ updated: boolean }>("update_play_history", {
  historyId,
  listenedSeconds,
});
