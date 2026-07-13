import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import type { ColumnConfig, Track } from "../../types";
import { TableHeader } from "./TableHeader";
import { TableEmptyState } from "./TableEmptyState";
import { TableRow } from "./TableRow";
import { usePlaybackStore, useUIStore } from "../../stores";
import { LEADING_COLUMN_WIDTH, PAGE_STEP } from "../../constants/ui";

type TrackTableProps = {
  tracks: Track[];
  columns: ColumnConfig[];
  emptyTitle: string;
  emptyDescription: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  emptySecondaryActionLabel?: string;
  onEmptySecondaryAction?: () => void;
  onRowSelect: (
    index: number,
    id: string,
    options?: { isMetaKey?: boolean; isShiftKey?: boolean }
  ) => void;
  onRowMouseDown: (event: React.MouseEvent, id: string) => void;
  onRowContextMenu: (
    event: React.MouseEvent,
    id: string,
    index: number,
    isSelected: boolean
  ) => void;
  onRowDoubleClick?: (trackId: string) => void;
  onColumnResize: (key: ColumnConfig["key"], width: number) => void;
  onColumnAutoFit: (key: ColumnConfig["key"]) => void;
  onColumnReorder?: (dragKey: ColumnConfig["key"], targetIndex: number) => void;
  onHeaderContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onSortChange?: (key: ColumnConfig["key"]) => void;
  onRatingChange: (id: string, rating: number) => void;
};

export const TrackTable = memo(
  ({
    tracks,
    columns,
    emptyTitle,
    emptyDescription,
    emptyActionLabel,
    onEmptyAction,
    emptySecondaryActionLabel,
    onEmptySecondaryAction,
    onRowSelect,
    onRowMouseDown,
    onRowContextMenu,
    onRowDoubleClick,
    onColumnResize,
    onColumnAutoFit,
    onColumnReorder,
    onHeaderContextMenu,
    onSortChange,
    onRatingChange,
  }: TrackTableProps) => {
    // Read state from stores
    const selectedIds = useUIStore((s) => s.selectedIds);
    const activeIndex = useUIStore((s) => s.activeIndex);
    const sortState = useUIStore((s) => s.sortState);
    const selectAll = useUIStore((s) => s.selectAll);
    const clearSelection = useUIStore((s) => s.clearSelection);
    const isCurrentlyPlaying = usePlaybackStore((s) => s.isPlaying);
    const currentTrack = usePlaybackStore((s) => s.currentTrack);
    const playingTrackId = currentTrack?.id;
    const tableContainerRef = useRef<HTMLDivElement | null>(null);
    const [rowHeight, setRowHeight] = useState(48);

    useEffect(() => {
      const updateRowHeight = () => {
        const value = getComputedStyle(document.documentElement)
          .getPropertyValue("--table-row-height")
          .trim();
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed)) {
          setRowHeight(parsed);
        }
      };
      updateRowHeight();

      // Listen for theme changes via data-theme attribute
      const observer = new MutationObserver(updateRowHeight);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
      });
      return () => observer.disconnect();
    }, []);

    const visibleColumns = useMemo(
      () => columns.filter((column) => column.visible),
      [columns]
    );
    const tableWidth = useMemo(() => {
      return (
        visibleColumns.reduce((total, column) => total + column.width, 0) +
        LEADING_COLUMN_WIDTH
      );
    }, [visibleColumns]);
    const gridTemplateColumns = useMemo(
      () =>
        [`${LEADING_COLUMN_WIDTH}px`, ...visibleColumns.map((column) => `${column.width}px`)].join(
          " "
        ),
      [visibleColumns]
    );

    const rowVirtualizer = useVirtualizer({
      count: tracks.length,
      getScrollElement: () => tableContainerRef.current,
      estimateSize: () => rowHeight,
      overscan: 50,
    });
    const virtualRows = rowVirtualizer.getVirtualItems();

    const clampIndex = (index: number) =>
      Math.max(0, Math.min(tracks.length - 1, index));

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.currentTarget !== event.target) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll(tracks.map((t) => t.id));
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (event.key === "Enter" && activeIndex !== null) {
        event.preventDefault();
        const track = tracks[activeIndex];
        if (track) {
          onRowDoubleClick?.(track.id);
        }
        return;
      }

      if (tracks.length === 0) {
        return;
      }

      const current = activeIndex ?? 0;
      let nextIndex = current;

      if (event.key === "ArrowDown") {
        nextIndex = clampIndex(current + 1);
      } else if (event.key === "ArrowUp") {
        nextIndex = clampIndex(current - 1);
      } else if (event.key === "PageDown") {
        nextIndex = clampIndex(current + PAGE_STEP);
      } else if (event.key === "PageUp") {
        nextIndex = clampIndex(current - PAGE_STEP);
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = tracks.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      const track = tracks[nextIndex];
      if (!track) {
        return;
      }
      onRowSelect(nextIndex, track.id, { isShiftKey: event.shiftKey });
      rowVirtualizer.scrollToIndex(nextIndex, { align: "auto" });
    };

    // Stable callbacks for TableRow to prevent re-renders
    const handleRowSelectStable = useCallback(
      (index: number, id: string, options?: { isMetaKey?: boolean; isShiftKey?: boolean }) => {
        onRowSelect(index, id, options);
      },
      [onRowSelect]
    );

    const handleRowMouseDownStable = useCallback(
      (event: React.MouseEvent, id: string) => {
        onRowMouseDown(event, id);
      },
      [onRowMouseDown]
    );

    const handleRowContextMenuStable = useCallback(
      (event: React.MouseEvent, id: string, index: number, isSelected: boolean) => {
        onRowContextMenu(event, id, index, isSelected);
      },
      [onRowContextMenu]
    );

    const handleRowDoubleClickStable = useCallback(
      (trackId: string) => {
        onRowDoubleClick?.(trackId);
      },
      [onRowDoubleClick]
    );

    const handleRatingChangeStable = useCallback(
      (id: string, rating: number) => {
        onRatingChange(id, rating);
      },
      [onRatingChange]
    );

    return (
      <div
        ref={tableContainerRef}
        className="relative min-h-0 flex-1 min-w-0 overflow-x-auto overflow-y-auto"
        role="grid"
        aria-rowcount={tracks.length}
        aria-colcount={visibleColumns.length + 1}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <TableHeader
          columns={visibleColumns}
          tableWidth={tableWidth}
          leadingColumnWidth={LEADING_COLUMN_WIDTH}
          gridTemplateColumns={gridTemplateColumns}
          onColumnResize={onColumnResize}
          onColumnAutoFit={onColumnAutoFit}
          onColumnReorder={onColumnReorder}
          onHeaderContextMenu={onHeaderContextMenu}
          onSortChange={onSortChange}
          sortState={sortState}
        />
        {tracks.length === 0 ? (
          <TableEmptyState
            title={emptyTitle}
            description={emptyDescription}
            primaryActionLabel={emptyActionLabel}
            onPrimaryAction={onEmptyAction}
            secondaryActionLabel={emptySecondaryActionLabel}
            onSecondaryAction={onEmptySecondaryAction}
          />
        ) : (
        <div
          className="relative"
          style={{ height: rowVirtualizer.getTotalSize(), minWidth: tableWidth }}
        >
          {virtualRows.map((virtualRow: VirtualItem) => {
            const track = tracks[virtualRow.index];
            if (!track) {
              return null;
            }
            return (
              <TableRow
                key={virtualRow.key}
                track={track}
                index={virtualRow.index}
                isSelected={selectedIds.has(track.id)}
                isPlayingTrack={track.id === playingTrackId}
                isCurrentlyPlaying={isCurrentlyPlaying}
                visibleColumns={visibleColumns}
                gridTemplateColumns={gridTemplateColumns}
                tableWidth={tableWidth}
                virtualStart={virtualRow.start}
                onRowSelect={handleRowSelectStable}
                onRowMouseDown={handleRowMouseDownStable}
                onRowContextMenu={handleRowContextMenuStable}
                onRowDoubleClick={handleRowDoubleClickStable}
                onRatingChange={handleRatingChangeStable}
              />
            );
          })}
        </div>
        )}
      </div>
    );
  }
);
