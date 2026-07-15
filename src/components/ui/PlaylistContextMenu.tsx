import { Download, FolderInput, Pencil, Trash2 } from "lucide-react";
import { t } from "../../i18n";
import type { PlaylistFolder } from "../../types";
import { Popover, PopoverDivider, PopoverItem } from "./Popover";

type PlaylistContextMenuProps = {
  isOpen: boolean;
  position: { x: number; y: number };
  playlistName?: string;
  folders?: PlaylistFolder[];
  currentFolderId?: string;
  onExport?: () => void;
  onMoveToFolder?: (folderId: string | null) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export const PlaylistContextMenu = ({
  isOpen,
  position,
  playlistName,
  folders = [],
  currentFolderId,
  onExport,
  onMoveToFolder,
  onEdit,
  onDelete,
  onClose,
}: PlaylistContextMenuProps) => {
  return (
    <Popover isOpen={isOpen} position={position} className="max-h-[70vh] w-56 overflow-y-auto py-1" onClose={onClose}>
      {playlistName && (
        <div className="mx-2 mb-1 truncate rounded-[var(--radius-md)] bg-[var(--panel-muted)] px-2 py-1 text-xs font-medium text-[var(--color-text-muted)]">
          {playlistName}
        </div>
      )}
      <PopoverItem onClick={onEdit}>
        <Pencil className="h-4 w-4 opacity-60" />
        {t("menu.edit")}
      </PopoverItem>
      {onExport && (
        <PopoverItem onClick={onExport}>
          <Download className="h-4 w-4 opacity-60" />
          Export playlist
        </PopoverItem>
      )}
      {onMoveToFolder && (folders.length > 0 || currentFolderId) && (
        <>
          <PopoverDivider />
          <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            Move to
          </div>
          {currentFolderId && (
            <PopoverItem onClick={() => onMoveToFolder(null)}>
              <FolderInput className="h-4 w-4 opacity-60" />
              Playlists
            </PopoverItem>
          )}
          {folders
            .filter((folder) => folder.id !== currentFolderId)
            .map((folder) => (
              <PopoverItem key={folder.id} onClick={() => onMoveToFolder(folder.id)}>
                <FolderInput className="h-4 w-4 opacity-60" />
                <span className="truncate">{folder.name}</span>
              </PopoverItem>
            ))}
        </>
      )}
      <PopoverDivider />
      <PopoverItem variant="danger" onClick={onDelete}>
        <Trash2 className="h-4 w-4 opacity-70" />
        {t("menu.delete")}
      </PopoverItem>
    </Popover>
  );
};
