import { useMemo } from "react";
import type { LibraryView } from "./useLibraryView";

type UseSidebarDataArgs = {
  view: LibraryView;
  draggingPlaylistId: string | null;
  onViewChange: (view: LibraryView) => void;
  onPlaylistDrop: (event: React.DragEvent<HTMLButtonElement>, id: string) => void;
  onPlaylistDragEnter: (id: string) => void;
  onPlaylistDragLeave: (id: string) => void;
  onPlaylistDragOver: (id: string) => void;
  onCreatePlaylist: () => void;
  onPlaylistContextMenu: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
  onCreateSmartCrate: () => void;
  onEditSmartCrate: (id: string) => void;
  onDeleteSmartCrate: (id: string) => void;
};

export const useSidebarData = ({
  view,
  draggingPlaylistId,
  onViewChange,
  onPlaylistDrop,
  onPlaylistDragEnter,
  onPlaylistDragLeave,
  onPlaylistDragOver,
  onCreatePlaylist,
  onPlaylistContextMenu,
  onCreateSmartCrate,
  onEditSmartCrate,
  onDeleteSmartCrate,
}: UseSidebarDataArgs) => {
  return useMemo(
    () => ({
      currentView: view,
      draggingPlaylistId,
      onViewChange,
      onPlaylistDrop,
      onPlaylistDragEnter,
      onPlaylistDragLeave,
      onPlaylistDragOver,
      onCreatePlaylist,
      onPlaylistContextMenu,
      onCreateSmartCrate,
      onEditSmartCrate,
      onDeleteSmartCrate,
    }),
    [
      draggingPlaylistId,
      onPlaylistContextMenu,
      onPlaylistDragEnter,
      onPlaylistDragLeave,
      onPlaylistDragOver,
      onPlaylistDrop,
      onCreatePlaylist,
      onCreateSmartCrate,
      onDeleteSmartCrate,
      onEditSmartCrate,
      onViewChange,
      view,
    ]
  );
};
