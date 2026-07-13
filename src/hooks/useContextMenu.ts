import { useCallback, useState } from "react";

type UseContextMenuArgs = {
  selectedIds: Set<string>;
  onSelectRow: (index: number, id: string) => void;
};

export const useContextMenu = ({
  selectedIds,
  onSelectRow,
}: UseContextMenuArgs) => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [menuSelection, setMenuSelection] = useState<string[]>([]);

  const openForRow = useCallback(
    (
      event: React.MouseEvent,
      trackId: string,
      index: number,
      isSelected: boolean
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isSelected) {
        onSelectRow(index, trackId);
        setMenuSelection([trackId]);
      } else {
        setMenuSelection(Array.from(selectedIds));
      }
      setMenuPosition({ x: event.clientX, y: event.clientY });
      setOpenMenuId(trackId);
    },
    [onSelectRow, selectedIds]
  );

  const closeMenu = useCallback(() => {
    setOpenMenuId(null);
    setMenuSelection([]);
  }, []);

  return {
    closeMenu,
    menuPosition,
    menuSelection,
    openForRow,
    openMenuId,
  };
};
