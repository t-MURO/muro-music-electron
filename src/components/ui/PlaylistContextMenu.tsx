import { Pencil, Trash2 } from "lucide-react";
import { t } from "../../i18n";
import { Popover, PopoverItem } from "./Popover";

type PlaylistContextMenuProps = {
  isOpen: boolean;
  position: { x: number; y: number };
  playlistName?: string;
  onEdit: () => void;
  onDelete: () => void;
};

export const PlaylistContextMenu = ({
  isOpen,
  position,
  playlistName,
  onEdit,
  onDelete,
}: PlaylistContextMenuProps) => {
  return (
    <Popover isOpen={isOpen} position={position} className="w-52 py-1">
      {playlistName && (
        <div className="mx-2 mb-1 truncate rounded-[var(--radius-md)] bg-[var(--panel-muted)] px-2 py-1 text-xs font-medium text-[var(--color-text-muted)]">
          {playlistName}
        </div>
      )}
      <PopoverItem onClick={onEdit}>
        <Pencil className="h-4 w-4 opacity-60" />
        {t("menu.edit")}
      </PopoverItem>
      <PopoverItem variant="danger" onClick={onDelete}>
        <Trash2 className="h-4 w-4 opacity-70" />
        {t("menu.delete")}
      </PopoverItem>
    </Popover>
  );
};
