import { useCallback } from "react";
import { commandManager } from "../command-manager/commandManager";
import { useLibraryStore, useUIStore, notify } from "../stores";
import { useDbPath } from "./useDbPath";
import {
  addTracksToPlaylist,
  createPlaylist,
  deletePlaylist,
  setPlaylistTracks,
  updatePlaylist,
} from "../utils";
import type { LibraryView } from "./useLibraryView";

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
      let previousName: string | null = null;
      const command = {
        label: `Rename playlist to ${nextName}`,
        do: () => {
          setPlaylists((current) =>
            current.map((playlist) => {
              if (playlist.id !== playlistId) {
                return playlist;
              }
              previousName = playlist.name;
              return { ...playlist, name: nextName };
            })
          );
          updatePlaylist(resolvedDbPath, playlistId, { name: nextName }).catch(() => {
            notify.error("Failed to rename playlist");
          });
        },
        undo: () => {
          if (previousName === null) {
            return;
          }
          setPlaylists((current) =>
            current.map((playlist) =>
              playlist.id === playlistId
                ? { ...playlist, name: previousName ?? playlist.name }
                : playlist
            )
          );
          updatePlaylist(resolvedDbPath, playlistId, { name: previousName }).catch(() => {
            notify.error("Failed to restore playlist name");
          });
        },
      };

      commandManager.execute(command);
    },
    [resolveDbPath, setPlaylists]
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
        do: () => {
          setPlaylists((current) =>
            current.filter((playlist) => !ids.has(playlist.id))
          );
          if (wasOnDeletedPlaylist) {
            navigateToView("library");
          }
          Promise.all(removed.map(({ playlist }) =>
            deletePlaylist(resolvedDbPath, playlist.id)
          )).catch(() => notify.error("Failed to delete playlists"));
        },
        undo: () => {
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
          Promise.all(removed.map(async ({ playlist }) => {
            await createPlaylist(
              resolvedDbPath,
              playlist.id,
              playlist.name,
              playlist.folderId,
              playlist.sortOrder,
            );
            if (playlist.trackIds.length > 0) {
              await addTracksToPlaylist(resolvedDbPath, playlist.id, playlist.trackIds);
            }
          })).catch(() => notify.error("Failed to restore playlists"));
        },
      };

      commandManager.execute(command);
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
      commandManager.execute({
        label: `Remove ${previousIds.length - nextIds.length} tracks from playlist`,
        do: () => {
          setPlaylists((current) => current.map((item) =>
            item.id === playlistId ? { ...item, trackIds: nextIds } : item
          ));
          setPlaylistTracks(resolvedDbPath, playlistId, nextIds).catch(() => {
            notify.error("Failed to remove tracks from playlist");
          });
        },
        undo: () => {
          setPlaylists((current) => current.map((item) =>
            item.id === playlistId ? { ...item, trackIds: previousIds } : item
          ));
          setPlaylistTracks(resolvedDbPath, playlistId, previousIds).catch(() => {
            notify.error("Failed to restore playlist tracks");
          });
        },
      });
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
