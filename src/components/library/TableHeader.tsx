import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { t } from "../../i18n";
import { useResizable } from "../../hooks";
import type { ColumnConfig } from "../../types";

type SortState = {
  key: ColumnConfig["key"];
  direction: "asc" | "desc";
} | null;

type TableHeaderProps = {
  columns: ColumnConfig[];
  tableWidth: number;
  leadingColumnWidth: number;
  gridTemplateColumns: string;
  onColumnResize: (key: ColumnConfig["key"], width: number) => void;
  onColumnAutoFit: (key: ColumnConfig["key"]) => void;
  onColumnReorder?: (dragKey: ColumnConfig["key"], targetIndex: number) => void;
  onHeaderContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onSortChange?: (key: ColumnConfig["key"]) => void;
  sortState?: SortState;
};

type DragState = {
  key: ColumnConfig["key"];
  startX: number;
  offsetX: number;
  isDragging: boolean;
};

export const TableHeader = ({
  columns,
  tableWidth,
  leadingColumnWidth,
  gridTemplateColumns,
  onColumnResize,
  onColumnAutoFit,
  onColumnReorder,
  onHeaderContextMenu,
  onSortChange,
  sortState,
}: TableHeaderProps) => {
  const { startResize } = useResizable();
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragBaseLeftRef = useRef<number | null>(null);
  const lastTargetIndexRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const columnsRef = useRef(columns);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useEffect(() => {
    if (!dragState) {
      dragBaseLeftRef.current = null;
      lastTargetIndexRef.current = null;
    }
  }, [dragState]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const currentState = dragStateRef.current;
      if (!currentState) {
        return;
      }

      const dragElement = columnRefs.current[currentState.key];
      let nextStartX = currentState.startX;
      if (dragElement) {
        const rect = dragElement.getBoundingClientRect();
        const baseLeft = rect.left - currentState.offsetX;
        if (dragBaseLeftRef.current === null) {
          dragBaseLeftRef.current = baseLeft;
        } else {
          const delta = baseLeft - dragBaseLeftRef.current;
          if (Math.abs(delta) > 0.5) {
            nextStartX += delta;
          }
          dragBaseLeftRef.current = baseLeft;
        }
      }

      const offsetX = event.clientX - nextStartX;
      const isDragging = currentState.isDragging || Math.abs(offsetX) > 4;
      const nextState = { ...currentState, startX: nextStartX, offsetX, isDragging };
      dragStateRef.current = nextState;
      setDragState(nextState);

      if (!isDragging || !onColumnReorder) {
        return;
      }

      const nextColumns = columnsRef.current;
      const positions = nextColumns
        .map((column) => {
          const rect = columnRefs.current[column.key]?.getBoundingClientRect();
          if (!rect) {
            return null;
          }
          return {
            key: column.key,
            center: (rect.left + rect.right) / 2,
          };
        })
        .filter(
          (item): item is { key: ColumnConfig["key"]; center: number } =>
            item !== null
        );

      const remaining = positions.filter((item) => item.key !== currentState.key);
      if (remaining.length === 0) {
        return;
      }

      let targetIndex = remaining.findIndex((item) => event.clientX < item.center);
      if (targetIndex === -1) {
        targetIndex = remaining.length;
      }

      if (lastTargetIndexRef.current !== targetIndex) {
        lastTargetIndexRef.current = targetIndex;
        onColumnReorder(currentState.key, targetIndex);
      }
    };

    const handlePointerUp = () => {
      if (dragStateRef.current?.isDragging) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      setDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, onColumnReorder]);

  return (
    <div
      className="sticky top-0 z-30 bg-[var(--color-bg-secondary)]"
      style={{ width: "100%", minWidth: tableWidth }}
      role="rowgroup"
      onContextMenu={onHeaderContextMenu}
    >
      <div className="relative" style={{ width: "100%", minWidth: tableWidth }}>
        <div
          className="grid text-left text-[length:var(--font-size-xs)] font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]"
          style={{ gridTemplateColumns }}
          role="row"
        >
          <div
            className="sticky left-0 z-40 flex items-center justify-center bg-[var(--color-bg-secondary)]"
            style={{ width: leadingColumnWidth }}
            role="columnheader"
            aria-hidden="true"
          />
          {columns.map((column) => {
            const isSorted = sortState?.key === column.key;
            const isDragging = dragState?.key === column.key && dragState.isDragging;
            return (
            <div
              key={column.key}
              ref={(node) => {
                columnRefs.current[column.key] = node;
              }}
              className={`relative bg-[var(--color-bg-secondary)] px-4 py-3 pr-8 ${
                onColumnReorder ? (isDragging ? "cursor-grabbing" : "cursor-grab") : ""
              } ${isDragging ? "z-40" : ""} ${
                isDragging ? "shadow-[var(--shadow-lg)]" : ""
              } ${isDragging ? "bg-[var(--color-bg-primary)]" : ""} ${
                isDragging ? "" : "transition-transform duration-150"
              }`}
              style={
                isDragging
                  ? { transform: `translateX(${dragState?.offsetX ?? 0}px)` }
                  : undefined
              }
              role="columnheader"
              aria-sort={
                isSorted
                  ? sortState?.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button
                className="flex w-full items-center justify-between gap-2 truncate text-left"
                onClick={() => {
                  if (suppressClickRef.current) {
                    return;
                  }
                  onSortChange?.(column.key);
                }}
                onPointerDown={(event) => {
                  if (!onColumnReorder || event.button !== 0) {
                    return;
                  }
                  const target = event.target as HTMLElement | null;
                  if (target?.closest("[data-resize-handle]")) {
                    return;
                  }
                  event.preventDefault();
                  const rect = columnRefs.current[column.key]?.getBoundingClientRect();
                  dragBaseLeftRef.current = rect ? rect.left : null;
                  lastTargetIndexRef.current = null;
                  setDragState({
                    key: column.key,
                    startX: event.clientX,
                    offsetX: 0,
                    isDragging: false,
                  });
                }}
                type="button"
              >
                <span className="truncate">{t(column.labelKey)}</span>
                {isSorted && (
                  <span className="text-[var(--color-text-muted)]">
                    {sortState?.direction === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                  </span>
                )}
              </button>
              <span className="absolute right-2 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-[var(--color-border)] opacity-40" />
              <span
                className="absolute right-0 top-0 h-full w-4 cursor-col-resize"
                data-resize-handle="true"
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onColumnAutoFit(column.key);
                }}
                onMouseDown={(event) => {
                  startResize(
                    event,
                    column.width,
                    (nextWidth) => onColumnResize(column.key, nextWidth),
                    { minSize: 80, maxSize: 360, stopPropagation: true }
                  );
                }}
                role="presentation"
              />
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
