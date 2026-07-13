import {
  AudioWaveform,
  ListChecks,
  ListPlus,
  Pencil,
  Play,
  SkipForward,
  Trash2,
} from "lucide-react";
import { t } from "../../i18n";
import { Popover, PopoverDivider, PopoverHeader, PopoverItem } from "./Popover";

type ContextMenuProps = {
  isOpen: boolean;
  position: { x: number; y: number };
  selectionCount: number;
  onPlay?: () => void;
  onPlayNext?: () => void;
  onAddToQueue?: () => void;
  onAddToPlaylist?: () => void;
  onShowBpmKey?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

export const ContextMenu = ({
  isOpen,
  position,
  selectionCount,
  onPlay,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
  onShowBpmKey,
  onEdit,
  onDelete,
}: ContextMenuProps) => {
  return (
    <Popover isOpen={isOpen} position={position} className="w-52 py-1">
      {selectionCount > 1 && (
        <PopoverHeader>{selectionCount} selected</PopoverHeader>
      )}
      <PopoverItem onClick={onPlay}>
        <Play className="h-4 w-4 opacity-60" />
        {t("menu.play")}
      </PopoverItem>
      <PopoverItem onClick={onPlayNext}>
        <SkipForward className="h-4 w-4 opacity-60" />
        {t("menu.playNext")}
      </PopoverItem>
      <PopoverItem onClick={onAddToQueue}>
        <ListChecks className="h-4 w-4 opacity-60" />
        {t("menu.addQueue")}
      </PopoverItem>
      <PopoverItem onClick={onAddToPlaylist}>
        <ListPlus className="h-4 w-4 opacity-60" />
        {t("menu.addPlaylist")}
      </PopoverItem>
      <PopoverDivider />
      <PopoverItem onClick={onShowBpmKey}>
        <AudioWaveform className="h-4 w-4 opacity-60" />
        {t("menu.showBpmKey")}
      </PopoverItem>
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
