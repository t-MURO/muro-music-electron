import { useMemo } from "react";
import type { LibraryView } from "./useLibraryView";

type UseSidebarDataArgs = {
  view: LibraryView;
  draggingPlaylistId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onViewChange: (view: LibraryView) => void;
  onPlaylistDrop: (event: React.DragEvent<HTMLButtonElement>, id: string) => void;
  onPlaylistDragEnter: (id: string) => void;
  onPlaylistDragLeave: (id: string) => void;
  onPlaylistDragOver: (id: string) => void;
  onCreatePlaylist: () => void;
  onPlaylistContextMenu: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
};

export const useSidebarData = ({
  view,
  draggingPlaylistId,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onViewChange,
  onPlaylistDrop,
  onPlaylistDragEnter,
  onPlaylistDragLeave,
  onPlaylistDragOver,
  onCreatePlaylist,
  onPlaylistContextMenu,
}: UseSidebarDataArgs) => {
  return useMemo(
    () => ({
      currentView: view,
      draggingPlaylistId,
      canGoBack,
      canGoForward,
      onGoBack,
      onGoForward,
      onViewChange,
      onPlaylistDrop,
      onPlaylistDragEnter,
      onPlaylistDragLeave,
      onPlaylistDragOver,
      onCreatePlaylist,
      onPlaylistContextMenu,
    }),
    [
      canGoBack,
      canGoForward,
      draggingPlaylistId,
      onGoBack,
      onGoForward,
      onPlaylistContextMenu,
      onPlaylistDragEnter,
      onPlaylistDragLeave,
      onPlaylistDragOver,
      onPlaylistDrop,
      onCreatePlaylist,
      onViewChange,
      view,
    ]
  );
};
