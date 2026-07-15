import { memo } from "react";
import { Check, Circle, Play } from "lucide-react";
import type { ColumnConfig, Track } from "../../types";
import { RatingCell } from "./RatingCell";

type TableRowProps = {
  track: Track;
  index: number;
  isSelected: boolean;
  isPlayingTrack: boolean;
  isCurrentlyPlaying: boolean;
  visibleColumns: ColumnConfig[];
  gridTemplateColumns: string;
  tableWidth: number;
  virtualStart: number;
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
  onRatingChange: (id: string, rating: number) => void;
};

const getColumnDisplayValue = (track: Track, key: ColumnConfig["key"]) => {
  switch (key) {
    case "artists":
      return track.artists ?? track.artist;
    case "trackNumber":
      return track.trackNumber === undefined || track.trackNumber === null
        ? ""
        : String(track.trackNumber);
    case "trackTotal":
      return track.trackTotal === undefined || track.trackTotal === null
        ? ""
        : String(track.trackTotal);
    case "key":
      return track.key ?? "";
    case "bpm":
      return track.bpm === undefined || track.bpm === null
        ? ""
        : track.bpm.toFixed(1);
    case "format": {
      const pathParts = track.sourcePath.split(/[\\/]/);
      const filename = pathParts[pathParts.length - 1] ?? "";
      const extensionParts = filename.split(".");
      const extension = filename.includes(".") ? extensionParts[extensionParts.length - 1] : "";
      return extension?.toUpperCase() ?? "";
    }
    case "year":
      return track.year === undefined || track.year === null
        ? ""
        : String(track.year);
    case "date":
      return track.date ?? "";
    case "dateAdded":
      return track.dateAdded ?? "";
    case "dateModified":
      return track.dateModified ?? "";
    default: {
      const value = track[key as keyof Track];
      return value === undefined || value === null ? "" : String(value);
    }
  }
};

export const TableRow = memo(
  ({
    track,
    index,
    isSelected,
    isPlayingTrack,
    isCurrentlyPlaying,
    visibleColumns,
    gridTemplateColumns,
    tableWidth,
    virtualStart,
    onRowSelect,
    onRowMouseDown,
    onRowContextMenu,
    onRowDoubleClick,
    onRatingChange,
  }: TableRowProps) => {
    const rowBaseClass = isSelected
      ? "bg-[var(--color-bg-active)]"
      : "bg-[var(--color-bg-primary)]";

    return (
      <div
        className={`group grid select-none items-center border-b border-[var(--color-border-light)] text-[12px] text-[var(--color-text-secondary)] ${rowBaseClass} hover:bg-[var(--color-bg-hover)]`}
        style={{
          gridTemplateColumns,
          height: "var(--table-row-height)",
          position: "absolute",
          top: virtualStart,
          left: 0,
          width: "100%",
          minWidth: tableWidth,
        }}
        onClick={(event) => {
          event.stopPropagation();
          onRowSelect(index, track.id, {
            isMetaKey: event.metaKey || event.ctrlKey,
            isShiftKey: event.shiftKey,
          });
        }}
        onDoubleClick={() => {
          onRowDoubleClick?.(track.id);
        }}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest("button, input, select, textarea")) {
            return;
          }
          onRowMouseDown(event, track.id);
        }}
        onContextMenu={(event) =>
          onRowContextMenu(event, track.id, index, isSelected)
        }
        role="row"
      >
        <div
          className="sticky left-0 z-30 flex h-[var(--table-row-height)] items-center justify-center border-r border-[var(--color-border-light)] bg-[var(--color-bg-primary)] group-hover:bg-[var(--color-bg-hover)] relative"
          role="cell"
        >
          {isSelected && (
            <span
              className="pointer-events-none absolute inset-0 bg-[var(--color-bg-active)]"
              aria-hidden="true"
            />
          )}
          <span className={`relative z-10 flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border ${isSelected ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border)] text-transparent group-hover:border-[var(--color-text-muted)]"}`}>
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
        </div>
        {visibleColumns.map((column) => {
          const value = getColumnDisplayValue(track, column.key);
          if (column.key === "rating") {
            const currentRating = Number(track.rating) || 0;
            return (
              <RatingCell
                key={column.key}
                trackId={track.id}
                title={track.title}
                rating={currentRating}
                onRate={onRatingChange}
              />
            );
          }
          const isTitleColumn = column.key === "title";
          const textColorClass = isTitleColumn && isPlayingTrack ? "text-[var(--color-accent)]" : "";
          const numericClass = column.key === "bpm" || column.key === "duration" || column.key === "bitrate" ? "tabular-nums" : "";
          const keyClass = column.key === "key" && value ? "font-semibold text-[var(--color-accent)]" : "";
          return (
            <div
              key={column.key}
              className={`flex h-[var(--table-row-height)] items-center border-l border-[var(--color-border-light)] px-3 ${isTitleColumn ? "font-medium text-[var(--color-text-primary)]" : ""} ${numericClass} ${keyClass} ${textColorClass}`}
              role="cell"
            >
              {isTitleColumn && (
                isPlayingTrack
                  ? <Play className={`mr-2 h-3 w-3 shrink-0 text-[var(--color-accent)] ${isCurrentlyPlaying ? "opacity-100" : "opacity-70"}`} fill="currentColor" />
                  : <Circle className="mr-2 h-2 w-2 shrink-0 text-[var(--color-text-muted)]" fill="currentColor" strokeWidth={0} />
              )}
              <span className="block truncate">{value}</span>
            </div>
          );
        })}
      </div>
    );
  }
);
