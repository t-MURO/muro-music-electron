import { useCallback } from "react";
import { invoke } from "@muro/desktop/runtime";
import { useLibraryStore, useUIStore } from "../stores";
import type { Track, TrackMetadataUpdates } from "../types";
import {
  fetchTrackCoverArt,
  searchTrackMetadata,
  searchAlbumMetadata,
  loadAlbumMetadata,
  type FetchedCoverArt,
  type MetadataSearchCandidate,
  type AlbumMetadataCandidate,
  type AlbumMetadataRelease,
} from "../utils/database";
import { useDbPath } from "./useDbPath";

export const useTrackEdit = () => {
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const editTrackIds = useUIStore((s) => s.editTrackIds);
  const openEditModal = useUIStore((s) => s.openEditModal);
  const closeEditModal = useUIStore((s) => s.closeEditModal);
  const resolveDbPath = useDbPath();

  const handleSaveMetadata = useCallback(
    async (trackIds: string[], updates: TrackMetadataUpdates) => {
      // Build the updates map for the desktop command.
      const updateMap: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          updateMap[key] = value;
        }
      }

      if (Object.keys(updateMap).length === 0) {
        return;
      }

      const dbPath = await resolveDbPath();
      await invoke("update_track_metadata", {
        dbPath,
        trackIds,
        updates: updateMap,
      });

      // Update local state
      const updateTrackList = (trackList: Track[]): Track[] =>
        trackList.map((track) => {
          if (trackIds.includes(track.id)) {
            return { ...track, ...updates };
          }
          return track;
        });

      setTracks(updateTrackList);
      setInboxTracks(updateTrackList);
    },
    [resolveDbPath, setTracks, setInboxTracks]
  );

  const handleFetchCoverArt = useCallback(
    async (
      trackId: string,
      metadata: { album?: string; artist?: string },
    ): Promise<FetchedCoverArt | null> => {
      const dbPath = await resolveDbPath();
      return fetchTrackCoverArt(dbPath, trackId, metadata);
    },
    [resolveDbPath],
  );

  const handleSearchMetadata = useCallback(
    (track: Track): Promise<MetadataSearchCandidate[]> => searchTrackMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
    }),
    [],
  );

  const handleSearchAlbumMetadata = useCallback(
    (tracks: Track[]): Promise<AlbumMetadataCandidate[]> => {
      const first = tracks[0];
      if (!first) return Promise.resolve([]);
      return searchAlbumMetadata({
        album: first.album,
        artist: first.artists || first.artist,
      });
    },
    [],
  );

  const handleLoadAlbumMetadata = useCallback(
    (releaseId: string): Promise<AlbumMetadataRelease> => loadAlbumMetadata(releaseId),
    [],
  );

  return {
    editTrackIds,
    isEditModalOpen: editTrackIds.length > 0,
    openEditModal,
    closeEditModal,
    handleSaveMetadata,
    handleFetchCoverArt,
    handleSearchMetadata,
    handleSearchAlbumMetadata,
    handleLoadAlbumMetadata,
  };
};
