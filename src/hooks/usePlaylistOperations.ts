import { useCallback } from "react";
import { commandManager } from "../command-manager/commandManager";
import { useLibraryStore, useUIStore, notify } from "../stores";
import { useDbPath } from "./useDbPath";
import { addTracksToPlaylist, createPlaylist, deletePlaylist, setPlaylistTracks } from "../utils";
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
    (playlistId: string, nextName: string) => {
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
        },
      };

      commandManager.execute(command);
    },
    [setPlaylists]
  );

  const handleDeletePlaylist = useCallback(
    async (playlistId: string) => {
      const playlist = playlists.find((p) => p.id === playlistId);
      if (!playlist) {
        return;
      }

      const resolvedDbPath = await resolveDbPath();
      const removedPlaylist = { ...playlist };
      const removedIndex = playlists.findIndex((p) => p.id === playlistId);
      const wasOnDeletedPlaylist = currentView === `playlist:${playlistId}`;

      const command = {
        label: "Delete playlist",
        do: () => {
          setPlaylists((current) =>
            current.filter((p) => p.id !== playlistId)
          );
          if (wasOnDeletedPlaylist) {
            navigateToView("library");
          }
          deletePlaylist(resolvedDbPath, playlistId).catch(() => {
            notify.error("Failed to delete playlist");
          });
        },
        undo: () => {
          setPlaylists((current) => {
            const next = [...current];
            const insertIndex = Math.min(removedIndex, next.length);
            next.splice(insertIndex, 0, removedPlaylist);
            return next;
          });
          if (wasOnDeletedPlaylist) {
            navigateToView(`playlist:${playlistId}` as LibraryView);
          }
          // Recreate playlist and restore tracks
          createPlaylist(
            resolvedDbPath,
            removedPlaylist.id,
            removedPlaylist.name
          )
            .then(() => {
              if (removedPlaylist.trackIds.length > 0) {
                return addTracksToPlaylist(
                  resolvedDbPath,
                  removedPlaylist.id,
                  removedPlaylist.trackIds
                );
              }
            })
            .catch(() => {
              notify.error("Failed to restore playlist");
            });
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
    handleRenamePlaylist(playlistEditState.id, trimmed);
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
    handleDeletePlaylist,
    handleRemoveTracksFromPlaylist,
    handlePlaylistEditSubmit,
  };
};
