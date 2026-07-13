import { memo } from "react";
import { Disc3 } from "lucide-react";
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
      ? "bg-[var(--color-accent-light)]"
      : "bg-[var(--color-bg-primary)]";

    return (
      <div
        className={`group grid select-none items-center ${rowBaseClass} hover:bg-[var(--color-bg-hover)]`}
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
          className="sticky left-0 z-30 flex h-[var(--table-row-height)] items-center justify-center bg-[var(--color-bg-primary)] group-hover:bg-[var(--color-bg-hover)] relative"
          role="cell"
        >
          {isSelected && (
            <span
              className="pointer-events-none absolute inset-0 bg-[var(--color-accent-light)]"
              aria-hidden="true"
            />
          )}
          {isPlayingTrack && (
            <Disc3
              className={`relative z-10 h-4 w-4 shrink-0 text-[var(--color-accent)] ${
                isCurrentlyPlaying ? "animate-spin-slow" : ""
              }`}
            />
          )}
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
          const textColorClass = isPlayingTrack
            ? "text-[var(--color-accent)]"
            : "";
          return (
            <div
              key={column.key}
              className={`flex h-[var(--table-row-height)] items-center px-[var(--spacing-md)] ${isTitleColumn ? "font-medium" : ""} ${textColorClass}`}
              role="cell"
            >
              <span className="block truncate">{value}</span>
            </div>
          );
        })}
      </div>
    );
  }
);
