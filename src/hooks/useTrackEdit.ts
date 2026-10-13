import { useCallback } from "react";
import { invoke } from "@muro/desktop/runtime";
import { notify, useLibraryStore, useSettingsStore, useUIStore } from "../stores";
import type { Track, TrackMetadataUpdates } from "../types";
import { t } from "../i18n";
import {
  cacheAlbumCoverCandidate,
  fetchTrackCoverArt,
  searchAlbumCoverImages,
  searchTrackMetadata,
  searchAlbumMetadata,
  loadAlbumMetadata,
  identifyTrackWithAcoustId,
  type FetchedCoverArt,
  type MetadataSearchCandidate,
  type AlbumMetadataCandidate,
  type AlbumMetadataRelease,
  type AcoustIdIdentificationResult,
} from "../utils/database";
import type { AlbumCoverCandidate } from "../types";
import { albumArtistDisplay } from "../utils/artistCredits";
import {
  recordMetadataWrite,
  showTagWriteFailures,
  type MetadataWriteResult,
} from "../utils/tagWriteFailures";

export const useTrackEdit = () => {
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const editTrackIds = useUIStore((s) => s.editTrackIds);
  const openEditModal = useUIStore((s) => s.openEditModal);
  const closeEditModal = useUIStore((s) => s.closeEditModal);
  const acoustIdClientKey = useSettingsStore((state) => state.acoustIdClientKey);
  const braveSearchApiKey = useSettingsStore((state) => state.braveSearchApiKey);

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

      const result = await invoke<MetadataWriteResult | undefined>("update_track_metadata", {
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

      // The library is updated before any file is touched, so a failed tag
      // write leaves the edit saved in Muro. Say so, and offer a retry.
      const failedWrites = recordMetadataWrite(trackIds, updateMap, result);
      showTagWriteFailures();
      if (updates.coverArtPath && result && failedWrites === 0) {
        notify.success(
          trackIds.length === 1
            ? t("toast.cover.embeddedOne")
            : t("toast.cover.embeddedMany", { count: String(result.filesWritten) }),
        );
      }
    },
    [setTracks, setInboxTracks],
  );

  const handleFetchCoverArt = useCallback(
    async (
      trackId: string,
      metadata: { album?: string; artist?: string },
    ): Promise<FetchedCoverArt | { candidates: AlbumCoverCandidate[] } | null> => {
      let providerError: unknown = null;
      try {
        const cover = await fetchTrackCoverArt(trackId, metadata);
        if (cover) return cover;
      } catch (error) {
        providerError = error;
      }

      const candidates = await searchAlbumCoverImages(
        {
          album: metadata.album ?? "",
          artist: metadata.artist ?? "",
        },
        braveSearchApiKey,
      );
      if (candidates.length > 0) return { candidates };

      if (providerError) throw providerError;
      return null;
    },
    [braveSearchApiKey],
  );

  const handleCacheCoverCandidate = useCallback(
    (candidate: AlbumCoverCandidate): Promise<FetchedCoverArt> =>
      cacheAlbumCoverCandidate(candidate),
    [],
  );

  const handleSearchMetadata = useCallback(
    (track: Track): Promise<MetadataSearchCandidate[]> =>
      searchTrackMetadata({
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
        artist: albumArtistDisplay(first),
      });
    },
    [],
  );

  const handleLoadAlbumMetadata = useCallback(
    (releaseId: string): Promise<AlbumMetadataRelease> => loadAlbumMetadata(releaseId),
    [],
  );

  const handleIdentifyWithAcoustId = useCallback(
    async (track: Track, force = false): Promise<AcoustIdIdentificationResult> => {
      return identifyTrackWithAcoustId(track.id, acoustIdClientKey, force);
    },
    [acoustIdClientKey],
  );

  return {
    editTrackIds,
    isEditModalOpen: editTrackIds.length > 0,
    openEditModal,
    closeEditModal,
    handleSaveMetadata,
    handleFetchCoverArt,
    handleCacheCoverCandidate,
    handleSearchMetadata,
    handleSearchAlbumMetadata,
    handleLoadAlbumMetadata,
    handleIdentifyWithAcoustId,
  };
};
