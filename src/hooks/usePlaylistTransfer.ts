import { useCallback, useRef } from "react";
import { useLibraryStore, notify } from "../stores";
import {
  addTracksToPlaylist,
  createPlaylist,
  createPlaylistFolder,
  deletePlaylist,
  deletePlaylistFolder,
  exportPlaylistFile,
  importFiles,
  importedTrackToTrack,
  importPlaylistFile,
  listPlaylistFiles,
} from "../utils";
import { useDbPath } from "./useDbPath";

const normalizePath = (value: string) =>
  value.replace(/\//g, "\\").toLocaleLowerCase();

export const usePlaylistTransfer = () => {
  const sequenceRef = useRef(0);
  const setInboxTracks = useLibraryStore((state) => state.setInboxTracks);
  const setPlaylists = useLibraryStore((state) => state.setPlaylists);
  const setPlaylistFolders = useLibraryStore((state) => state.setPlaylistFolders);
  const resolveDbPath = useDbPath();

  const importPlaylistIntoStore = useCallback(async (
    dbPath: string,
    filePath: string,
    folderId?: string,
  ) => {
    const parsed = await importPlaylistFile(dbPath, filePath);
    const missingPaths = [...new Set(
      parsed.entries
        .filter((entry) => !entry.track_id && entry.exists)
        .map((entry) => entry.path)
    )];
    const importResult = missingPaths.length > 0
      ? await importFiles(dbPath, missingPaths)
      : { imported: [], scanned: 0, failures: [] };
    const imported = importResult.imported;
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
    if (trackIds.length === 0) return null;

    sequenceRef.current += 1;
    const playlist = {
      id: `playlist-import-${Date.now()}-${sequenceRef.current}`,
      name: parsed.name || "Imported Playlist",
      trackIds,
      folderId,
    };
    await createPlaylist(dbPath, playlist.id, playlist.name, folderId);
    try {
      await addTracksToPlaylist(dbPath, playlist.id, playlist.trackIds);
    } catch (error) {
      await deletePlaylist(dbPath, playlist.id).catch(() => undefined);
      throw error;
    }
    setPlaylists((current) => [...current, playlist]);

    const skipped = parsed.entries.length - trackIds.length;
    return { playlist, skipped };
  }, [setInboxTracks, setPlaylists]);

  const importPlaylist = useCallback(async (filePath: string) => {
    try {
      const dbPath = await resolveDbPath();
      const result = await importPlaylistIntoStore(dbPath, filePath);
      if (!result) {
        notify.error("The playlist did not contain any available audio files");
        return null;
      }
      notify.success(
        result.skipped > 0
          ? `Imported ${result.playlist.name} with ${result.playlist.trackIds.length} tracks (${result.skipped} unavailable)`
          : `Imported ${result.playlist.name} with ${result.playlist.trackIds.length} tracks`
      );
      return result.playlist.id;
    } catch {
      notify.error("Failed to import playlist");
      return null;
    }
  }, [importPlaylistIntoStore, resolveDbPath]);

  const importPlaylistFolder = useCallback(async (directoryPath: string) => {
    let folderId: string | null = null;
    try {
      const scan = await listPlaylistFiles(directoryPath);
      if (scan.files.length === 0) {
        notify.error("The selected folder does not contain any M3U, M3U8, or PLS playlists");
        return null;
      }

      const dbPath = await resolveDbPath();
      sequenceRef.current += 1;
      folderId = `playlist-folder-import-${Date.now()}-${sequenceRef.current}`;
      const folder = { id: folderId, name: scan.name || "Imported Playlists" };
      await createPlaylistFolder(dbPath, folder.id, folder.name);
      setPlaylistFolders((current) => [...current, folder]);

      notify.info(`Importing ${scan.files.length} playlists from ${folder.name}`);
      const playlistIds: string[] = [];
      for (const filePath of scan.files) {
        try {
          const result = await importPlaylistIntoStore(dbPath, filePath, folder.id);
          if (result) playlistIds.push(result.playlist.id);
        } catch {
          // Keep importing the remaining files and summarize partial failures.
        }
      }

      if (playlistIds.length === 0) {
        await deletePlaylistFolder(dbPath, folder.id).catch(() => undefined);
        setPlaylistFolders((current) => current.filter((item) => item.id !== folder.id));
        notify.error(`Imported 0 of ${scan.files.length} playlists`);
        return null;
      }

      notify.success(
        `Imported ${playlistIds.length} of ${scan.files.length} playlists into ${folder.name}`
      );
      return { folderId: folder.id, playlistIds };
    } catch {
      if (folderId) {
        setPlaylistFolders((current) => current.filter((folder) => folder.id !== folderId));
      }
      notify.error("Failed to import playlist folder");
      return null;
    }
  }, [importPlaylistIntoStore, resolveDbPath, setPlaylistFolders]);

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

  return { importPlaylist, importPlaylistFolder, exportPlaylist };
};
