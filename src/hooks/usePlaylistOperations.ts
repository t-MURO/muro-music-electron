import { useCallback } from "react";
import { commandManager } from "../command-manager/commandManager";
import { useLibraryStore, useUIStore, notify } from "../stores";
import { useDbPath } from "./useDbPath";
import {
  deletePlaylists,
  restorePlaylists,
  setPlaylistTracks,
  updatePlaylist,
} from "../utils";
import type { LibraryView } from "./useLibraryView";
import { t } from "../i18n";

type UsePlaylistOperationsArgs = {
  currentView: LibraryView;
  navigateToView: (view: LibraryView) => void;
};

export const usePlaylistOperations = ({
  currentView,
  navigateToView,
}: UsePlaylistOperationsArgs) => {
  // Get state and actions from stores
  const playlists = useLibraryStore((s) => s.playlists);
  const setPlaylists = useLibraryStore((s) => s.setPlaylists);
  const playlistEditState = useUIStore((s) => s.playlistEditState);
  const openPlaylistEdit = useUIStore((s) => s.openPlaylistEdit);
  const closePlaylistEdit = useUIStore((s) => s.closePlaylistEdit);
  const setPlaylistEditName = useUIStore((s) => s.setPlaylistEditName);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const resolveDbPath = useDbPath();

  const handleOpenPlaylistEdit = useCallback(
    (playlist: { id: string; name: string }) => {
      openPlaylistEdit(playlist.id, playlist.name);
    },
    [openPlaylistEdit]
  );

  const handleClosePlaylistEdit = useCallback(() => {
    closePlaylistEdit();
  }, [closePlaylistEdit]);

  const handleRenamePlaylist = useCallback(
    async (playlistId: string, nextName: string) => {
      const resolvedDbPath = await resolveDbPath();
      const previousName = playlists.find((playlist) => playlist.id === playlistId)?.name;
      if (!previousName || previousName === nextName) return;
      const command = {
        label: `Rename playlist to ${nextName}`,
        do: async () => {
          await updatePlaylist(resolvedDbPath, playlistId, { name: nextName });
          setPlaylists((current) =>
            current.map((playlist) =>
              playlist.id === playlistId ? { ...playlist, name: nextName } : playlist
            )
          );
          return `Renamed playlist "${previousName}" to "${nextName}".`;
        },
        undo: async () => {
          await updatePlaylist(resolvedDbPath, playlistId, { name: previousName });
          setPlaylists((current) =>
            current.map((playlist) =>
              playlist.id === playlistId
                ? { ...playlist, name: previousName }
                : playlist
            )
          );
          return `Renamed playlist "${nextName}" back to "${previousName}".`;
        },
      };

      try {
        await commandManager.execute(command);
      } catch {
        notify.error(t("toast.playlist.renameFailed"));
      }
    },
    [playlists, resolveDbPath, setPlaylists]
  );

  const handleDeletePlaylists = useCallback(
    async (playlistIds: string[]) => {
      const ids = new Set(playlistIds);
      const removed = playlists
        .map((playlist, index) => ({ playlist, index }))
        .filter(({ playlist }) => ids.has(playlist.id));
      if (removed.length === 0) return;
      const resolvedDbPath = await resolveDbPath();
      const activePlaylistId = currentView.startsWith("playlist:")
        ? currentView.slice("playlist:".length)
        : null;
      const wasOnDeletedPlaylist = activePlaylistId ? ids.has(activePlaylistId) : false;

      const command = {
        label: removed.length === 1 ? "Delete playlist" : `Delete ${removed.length} playlists`,
        do: async () => {
          const result = await deletePlaylists(resolvedDbPath, [...ids]);
          if (result.deleted !== removed.length) {
            throw new Error(`Only ${result.deleted} of ${removed.length} playlists were deleted`);
          }
          setPlaylists((current) =>
            current.filter((playlist) => !ids.has(playlist.id))
          );
          if (wasOnDeletedPlaylist) {
            navigateToView("library");
          }
          return `Deleted ${removed.length} playlist${removed.length === 1 ? "" : "s"}.`;
        },
        undo: async () => {
          const result = await restorePlaylists(
            resolvedDbPath,
            removed.map(({ playlist }) => playlist),
          );
          if (result.restored !== removed.length) {
            throw new Error(`Only ${result.restored} of ${removed.length} playlists were restored`);
          }
          setPlaylists((current) => {
            const next = [...current];
            for (const { playlist, index } of removed) {
              next.splice(Math.min(index, next.length), 0, playlist);
            }
            return next;
          });
          if (wasOnDeletedPlaylist && activePlaylistId) {
            navigateToView(`playlist:${activePlaylistId}` as LibraryView);
          }
          const restoredTracks = removed.reduce(
            (total, entry) => total + entry.playlist.trackIds.length,
            0,
          );
          return `Restored ${removed.length} playlist${removed.length === 1 ? "" : "s"} with ${restoredTracks} track entr${restoredTracks === 1 ? "y" : "ies"}.`;
        },
      };

      try {
        await commandManager.execute(command);
      } catch {
        notify.error(t("toast.playlist.deleteFailed"));
      }
    },
    [resolveDbPath, navigateToView, playlists, setPlaylists, currentView]
  );

  const handlePlaylistEditSubmit = useCallback(() => {
    if (!playlistEditState) {
      return;
    }
    const trimmed = playlistEditState.name.trim();
    if (!trimmed) {
      return;
    }
    void handleRenamePlaylist(playlistEditState.id, trimmed);
    handleClosePlaylistEdit();
  }, [handleRenamePlaylist, playlistEditState, handleClosePlaylistEdit]);

  const handleRemoveTracksFromPlaylist = useCallback(
    async (playlistId: string, trackIds: string[]) => {
      const playlist = playlists.find((item) => item.id === playlistId);
      if (!playlist || trackIds.length === 0) return;

      const removed = new Set(trackIds);
      const previousIds = [...playlist.trackIds];
      const nextIds = previousIds.filter((trackId) => !removed.has(trackId));
      if (nextIds.length === previousIds.length) return;
      const resolvedDbPath = await resolveDbPath();

      clearSelection();
      const removedCount = previousIds.length - nextIds.length;
      try {
        await commandManager.execute({
          label: `Remove ${removedCount} tracks from playlist`,
          do: async () => {
            await setPlaylistTracks(resolvedDbPath, playlistId, nextIds);
            setPlaylists((current) => current.map((item) =>
              item.id === playlistId ? { ...item, trackIds: nextIds } : item
            ));
            return `Removed ${removedCount} track${removedCount === 1 ? "" : "s"} from "${playlist.name}".`;
          },
          undo: async () => {
            await setPlaylistTracks(resolvedDbPath, playlistId, previousIds);
            setPlaylists((current) => current.map((item) =>
              item.id === playlistId ? { ...item, trackIds: previousIds } : item
            ));
            return `Restored ${removedCount} track${removedCount === 1 ? "" : "s"} to "${playlist.name}".`;
          },
        });
      } catch {
        notify.error(t("toast.playlist.removeFailed"));
      }
    },
    [clearSelection, playlists, resolveDbPath, setPlaylists]
  );

  return {
    // Edit modal state
    isPlaylistEditOpen: playlistEditState !== null,
    playlistEditName: playlistEditState?.name ?? "",
    setPlaylistEditName,
    // Handlers
    handleOpenPlaylistEdit,
    handleClosePlaylistEdit,
    handleRenamePlaylist,
    handleDeletePlaylists,
    handleRemoveTracksFromPlaylist,
    handlePlaylistEditSubmit,
  };
};
