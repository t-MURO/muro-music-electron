import { useCallback, useRef } from "react";
import { useLibraryStore, notify } from "../stores";
import {
  addTracksToPlaylist,
  createPlaylist,
  deletePlaylist,
  exportPlaylistFile,
  importFiles,
  importedTrackToTrack,
  importPlaylistFile,
} from "../utils";
import { useDbPath } from "./useDbPath";

const normalizePath = (value: string) =>
  value.replace(/\//g, "\\").toLocaleLowerCase();

export const usePlaylistTransfer = () => {
  const sequenceRef = useRef(0);
  const setInboxTracks = useLibraryStore((state) => state.setInboxTracks);
  const setPlaylists = useLibraryStore((state) => state.setPlaylists);
  const resolveDbPath = useDbPath();

  const importPlaylist = useCallback(async (filePath: string) => {
    try {
      const dbPath = await resolveDbPath();
      const parsed = await importPlaylistFile(dbPath, filePath);
      const missingPaths = [...new Set(
        parsed.entries
          .filter((entry) => !entry.track_id && entry.exists)
          .map((entry) => entry.path)
      )];
      const imported = missingPaths.length > 0 ? await importFiles(dbPath, missingPaths) : [];
      const converted = imported.map(importedTrackToTrack);
      if (converted.length > 0) {
        setInboxTracks((current) => {
          const existing = new Set(current.map((track) => track.id));
          return [...converted.filter((track) => !existing.has(track.id)), ...current];
        });
      }

      const importedIdByPath = new Map(
        imported.map((track) => [normalizePath(track.source_path), track.id])
      );
      const orderedTrackIds = parsed.entries
        .map((entry) => entry.track_id ?? importedIdByPath.get(normalizePath(entry.path)) ?? null)
        .filter((trackId): trackId is string => Boolean(trackId));
      const trackIds = [...new Set(orderedTrackIds)];
      if (trackIds.length === 0) {
        notify.error("The playlist did not contain any available audio files");
        return null;
      }

      sequenceRef.current += 1;
      const playlist = {
        id: `playlist-import-${Date.now()}-${sequenceRef.current}`,
        name: parsed.name || "Imported Playlist",
        trackIds,
      };
      await createPlaylist(dbPath, playlist.id, playlist.name);
      try {
        await addTracksToPlaylist(dbPath, playlist.id, playlist.trackIds);
      } catch (error) {
        await deletePlaylist(dbPath, playlist.id).catch(() => undefined);
        throw error;
      }
      setPlaylists((current) => [...current, playlist]);

      const skipped = parsed.entries.length - trackIds.length;
      notify.success(
        skipped > 0
          ? `Imported ${playlist.name} with ${trackIds.length} tracks (${skipped} unavailable)`
          : `Imported ${playlist.name} with ${trackIds.length} tracks`
      );
      return playlist.id;
    } catch {
      notify.error("Failed to import playlist");
      return null;
    }
  }, [resolveDbPath, setInboxTracks, setPlaylists]);

  const exportPlaylist = useCallback(async (playlistId: string, filePath: string) => {
    try {
      const dbPath = await resolveDbPath();
      const result = await exportPlaylistFile(dbPath, playlistId, filePath);
      notify.success(`Exported ${result.exported} tracks`);
      return true;
    } catch {
      notify.error("Failed to export playlist");
      return false;
    }
  }, [resolveDbPath]);

  return { importPlaylist, exportPlaylist };
};
