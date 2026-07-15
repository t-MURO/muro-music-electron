import { useCallback, useRef } from "react";
import { useLibraryStore, notify } from "../stores";
import {
  createPlaylistFolder as createPlaylistFolderInDatabase,
  deletePlaylistFolder as deletePlaylistFolderInDatabase,
  updatePlaylist,
  updatePlaylistFolder as updatePlaylistFolderInDatabase,
} from "../utils";
import { useDbPath } from "./useDbPath";

export const usePlaylistFolders = () => {
  const sequenceRef = useRef(0);
  const setPlaylists = useLibraryStore((state) => state.setPlaylists);
  const setPlaylistFolders = useLibraryStore((state) => state.setPlaylistFolders);
  const resolveDbPath = useDbPath();

  const createFolder = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    sequenceRef.current += 1;
    const folder = {
      id: `playlist-folder-${Date.now()}-${sequenceRef.current}`,
      name: trimmed,
    };
    try {
      const dbPath = await resolveDbPath();
      await createPlaylistFolderInDatabase(dbPath, folder.id, folder.name);
      setPlaylistFolders((current) => [...current, folder]);
      notify.success(`Created folder ${folder.name}`);
      return folder.id;
    } catch {
      notify.error("Failed to create playlist folder");
      return null;
    }
  }, [resolveDbPath, setPlaylistFolders]);

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    try {
      const dbPath = await resolveDbPath();
      await updatePlaylistFolderInDatabase(dbPath, folderId, trimmed);
      setPlaylistFolders((current) => current.map((folder) =>
        folder.id === folderId ? { ...folder, name: trimmed } : folder
      ));
      notify.success(`Renamed folder to ${trimmed}`);
      return true;
    } catch {
      notify.error("Failed to rename playlist folder");
      return false;
    }
  }, [resolveDbPath, setPlaylistFolders]);

  const removeFolder = useCallback(async (folderId: string) => {
    try {
      const dbPath = await resolveDbPath();
      await deletePlaylistFolderInDatabase(dbPath, folderId);
      setPlaylistFolders((current) => current.filter((folder) => folder.id !== folderId));
      setPlaylists((current) => current.map((playlist) =>
        playlist.folderId === folderId ? { ...playlist, folderId: undefined } : playlist
      ));
      notify.success("Deleted playlist folder");
      return true;
    } catch {
      notify.error("Failed to delete playlist folder");
      return false;
    }
  }, [resolveDbPath, setPlaylistFolders, setPlaylists]);

  const movePlaylist = useCallback(async (
    playlistId: string,
    folderId: string | null,
  ) => {
    try {
      const dbPath = await resolveDbPath();
      await updatePlaylist(dbPath, playlistId, { folderId });
      setPlaylists((current) => current.map((playlist) =>
        playlist.id === playlistId
          ? { ...playlist, folderId: folderId ?? undefined }
          : playlist
      ));
      notify.success(folderId ? "Moved playlist to folder" : "Moved playlist to Playlists");
      return true;
    } catch {
      notify.error("Failed to move playlist");
      return false;
    }
  }, [resolveDbPath, setPlaylists]);

  return { createFolder, renameFolder, removeFolder, movePlaylist };
};
