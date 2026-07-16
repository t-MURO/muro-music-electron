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
    const libraryTrackIdByPath = new Map(
      useLibraryStore.getState().tracks.map((track) => [normalizePath(track.sourcePath), track.id])
    );
    const missingPaths = [...new Set(
      parsed.entries
        .filter((entry) => (
          !entry.track_id
          && !libraryTrackIdByPath.has(normalizePath(entry.path))
          && entry.exists
        ))
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
      .map((entry) => {
        const normalizedPath = normalizePath(entry.path);
        return entry.track_id
          ?? libraryTrackIdByPath.get(normalizedPath)
          ?? importedIdByPath.get(normalizedPath)
          ?? null;
      })
      .filter((trackId): trackId is string => Boolean(trackId));
    const trackIds = [...new Set(orderedTrackIds)];
    if (trackIds.length === 0) return null;

    sequenceRef.current += 1;
    const sortOrder = useLibraryStore.getState().playlists
      .filter((item) => item.folderId === folderId)
      .reduce((highest, item) => Math.max(highest, item.sortOrder), -1) + 1;
    const playlist = {
      id: `playlist-import-${Date.now()}-${sequenceRef.current}`,
      name: parsed.name || "Imported Playlist",
      trackIds,
      folderId,
      sortOrder,
    };
    await createPlaylist(dbPath, playlist.id, playlist.name, folderId, sortOrder);
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
    let dbPath: string | null = null;
    const createdFolderIds: string[] = [];
    const cleanupFolders = async () => {
      if (!dbPath || createdFolderIds.length === 0) return;
      for (const folderId of [...createdFolderIds].reverse()) {
        await deletePlaylistFolder(dbPath, folderId).catch(() => undefined);
      }
      const created = new Set(createdFolderIds);
      setPlaylistFolders((current) => current.filter((folder) => !created.has(folder.id)));
    };
    try {
      const scan = await listPlaylistFiles(directoryPath);
      if (scan.files.length === 0) {
        notify.error("The selected folder does not contain any M3U, M3U8, or PLS playlists");
        return null;
      }

      dbPath = await resolveDbPath();
      sequenceRef.current += 1;
      const rootFolder = {
        id: `playlist-folder-import-${Date.now()}-${sequenceRef.current}`,
        name: scan.name || "Imported Playlists",
        sortOrder: useLibraryStore.getState().playlistFolders
          .filter((folder) => !folder.parentId)
          .reduce((highest, folder) => Math.max(highest, folder.sortOrder), -1) + 1,
      };
      await createPlaylistFolder(
        dbPath,
        rootFolder.id,
        rootFolder.name,
        undefined,
        rootFolder.sortOrder,
      );
      createdFolderIds.push(rootFolder.id);

      const folderIdByPath = new Map<string, string>([["", rootFolder.id]]);
      const nextSortOrderByParent = new Map<string, number>();
      const importedFolders = [rootFolder];
      for (const scannedFolder of scan.folders) {
        const parentId = folderIdByPath.get(scannedFolder.parentPath ?? "") ?? rootFolder.id;
        const sortOrder = nextSortOrderByParent.get(parentId) ?? 0;
        nextSortOrderByParent.set(parentId, sortOrder + 1);
        sequenceRef.current += 1;
        const folder = {
          id: `playlist-folder-import-${Date.now()}-${sequenceRef.current}`,
          name: scannedFolder.name,
          parentId,
          sortOrder,
        };
        await createPlaylistFolder(dbPath, folder.id, folder.name, parentId, sortOrder);
        createdFolderIds.push(folder.id);
        folderIdByPath.set(scannedFolder.path, folder.id);
        importedFolders.push(folder);
      }
      setPlaylistFolders((current) => [...current, ...importedFolders]);

      notify.info(`Importing ${scan.files.length} playlists from ${rootFolder.name}`);
      const playlistIds: string[] = [];
      for (const entry of scan.entries) {
        try {
          const folderId = folderIdByPath.get(entry.folderPath ?? "") ?? rootFolder.id;
          const result = await importPlaylistIntoStore(dbPath, entry.path, folderId);
          if (result) playlistIds.push(result.playlist.id);
        } catch {
          // Keep importing the remaining files and summarize partial failures.
        }
      }

      if (playlistIds.length === 0) {
        await cleanupFolders();
        notify.error(`Imported 0 of ${scan.files.length} playlists`);
        return null;
      }

      notify.success(
        `Imported ${playlistIds.length} of ${scan.files.length} playlists into ${rootFolder.name}`
      );
      return { folderId: rootFolder.id, playlistIds };
    } catch {
      await cleanupFolders();
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
