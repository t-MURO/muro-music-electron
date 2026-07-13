import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, ListChecks, Music2, Play, Speaker, Trash2, X } from "lucide-react";
import { convertFileSrc } from "@muro/desktop/runtime";
import { t } from "../../i18n";
import { useDragSession } from "../../contexts/DragSessionContext";
import { NowPlayingTrack } from "../queue/NowPlayingTrack";
import type { Track } from "../../types";
import type { CurrentTrack } from "../../hooks";

type QueuePanelProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  queueTracks: Track[];
  currentTrack: CurrentTrack | null;
  onRemoveFromQueue: (index: number) => void;
  onReorderQueue: (fromIndex: number, toIndex: number) => void;
  onClearQueue: () => void;
};

export const QueuePanel = ({
  collapsed,
  onToggleCollapsed,
  queueTracks,
  currentTrack,
  onRemoveFromQueue,
  onReorderQueue,
  onClearQueue,
}: QueuePanelProps) => {
  const { startInternalDrag, endInternalDrag } = useDragSession();

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragY, setDragY] = useState<number>(0);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Refs for drag handling
  const dragStartRef = useRef<{ index: number; y: number; itemY: number } | null>(null);
  const itemRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    // Don't start drag from the X button
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-drag]')) return;

    e.preventDefault();
    const itemEl = itemRefsRef.current.get(index);
    if (!itemEl) return;

    const rect = itemEl.getBoundingClientRect();
    dragStartRef.current = {
      index,
      y: e.clientY,
      itemY: rect.top,
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const { index, y: startY, itemY } = dragStartRef.current;
      const deltaY = e.clientY - startY;

      // Start dragging after 4px movement
      if (dragIndex === null && Math.abs(deltaY) > 4) {
        setDragIndex(index);
        startInternalDrag("queue");
      }

      if (dragIndex !== null) {
        // Update drag position (vertical only)
        setDragY(itemY + deltaY);

        // Find drop target
        const containerEl = containerRef.current;
        if (containerEl) {
          let newDropIndex: number | null = null;

          for (let i = 0; i < queueTracks.length; i++) {
            const itemEl = itemRefsRef.current.get(i);
            if (!itemEl) continue;

            const rect = itemEl.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;

            if (e.clientY < midY) {
              newDropIndex = i;
              break;
            }
            newDropIndex = i + 1;
          }

          // Don't show drop indicator at current position or adjacent
          if (newDropIndex === index || newDropIndex === index + 1) {
            newDropIndex = null;
          }

          setDropIndex(newDropIndex);
        }
      }
    };

    const handleMouseUp = () => {
      if (dragIndex !== null && dropIndex !== null) {
        // Calculate actual target index
        let targetIndex = dropIndex;
        if (dropIndex > dragIndex) {
          targetIndex = dropIndex - 1;
        }
        if (targetIndex !== dragIndex) {
          onReorderQueue(dragIndex, targetIndex);
        }
      }

      // Reset drag state
      dragStartRef.current = null;
      setDragIndex(null);
      setDragY(0);
      setDropIndex(null);
      endInternalDrag();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragIndex, dropIndex, queueTracks.length, onReorderQueue, startInternalDrag, endInternalDrag]);

  // Get the dragged item for the floating preview
  const draggedTrack = dragIndex !== null ? queueTracks[dragIndex] : null;

  return (
    <aside className="flex h-full flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {/* Now Playing Section */}
      <div className={collapsed ? "" : "border-b border-[var(--color-border-light)]"}>
        {/* Header with collapse button - always visible and fixed position */}
        <div
          className="flex items-center gap-[var(--spacing-sm)] px-[var(--spacing-lg)] py-[var(--spacing-md)] pt-12"
        >
          {!collapsed && (
            <>
              <Play className="h-[14px] w-[14px] text-[var(--color-text-muted)]" />
              <h3 className="flex-1 text-[var(--font-size-xs)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t("panel.nowPlaying")}
              </h3>
            </>
          )}
          <button
            className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)] ${collapsed ? "" : "ml-auto"}`}
            onClick={onToggleCollapsed}
            title={collapsed ? "Expand panel" : "Collapse panel"}
            type="button"
          >
            <ChevronRight
              className={`h-4 w-4 text-[var(--color-text-muted)] transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        {/* Now playing track - animated */}
        <div
          className={`overflow-hidden transition-all duration-200 ease-out ${
            collapsed ? "max-h-0 opacity-0" : "max-h-24 opacity-100"
          }`}
        >
          <div className="pb-[var(--spacing-md)]">
            <NowPlayingTrack currentTrack={currentTrack} />
          </div>
        </div>
      </div>

      {/* Queue and Output Sections - animated */}
      <div
        className={`flex min-h-0 flex-1 flex-col transition-all duration-200 ease-out ${
          collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        {/* Queue Section */}
        <div className="flex-1 overflow-y-auto border-b border-[var(--color-border-light)]">
          <div className="flex items-center gap-[var(--spacing-sm)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
            <ListChecks className="h-[14px] w-[14px] text-[var(--color-text-muted)]" />
            <h3 className="flex-1 text-[var(--font-size-xs)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t("panel.queue")}
            </h3>
            {queueTracks.length > 0 && (
              <button
                onClick={onClearQueue}
                className="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                title="Clear queue"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {queueTracks.length === 0 ? (
            <p className="px-[var(--spacing-lg)] py-[var(--spacing-lg)] text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
              Queue is empty
            </p>
          ) : (
            <div ref={containerRef} className="relative pb-[var(--spacing-md)]">
              {queueTracks.map((track, index) => {
                const isDragging = dragIndex === index;
                const showDropBefore = dropIndex === index;
                const showDropAfter = dropIndex === queueTracks.length && index === queueTracks.length - 1;

                return (
                  <div key={`${track.id}-queue-${index}`} className="relative">
                    {/* Drop indicator before */}
                    {showDropBefore && (
                      <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-[var(--color-accent)]" />
                    )}

                    <div
                      ref={(el) => {
                        if (el) itemRefsRef.current.set(index, el);
                        else itemRefsRef.current.delete(index);
                      }}
                      onMouseDown={(e) => handleMouseDown(e, index)}
                      className={`group flex cursor-grab items-center gap-2.5 px-[var(--spacing-lg)] py-1.5 transition-colors active:cursor-grabbing ${
                        isDragging
                          ? "opacity-30"
                          : "hover:bg-[var(--color-bg-hover)]"
                      }`}
                    >
                      {/* Album cover thumbnail */}
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)]">
                        {track.coverArtPath ? (
                          <img
                            src={convertFileSrc(track.coverArtPath)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
                            <Music2 className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                          {track.title}
                        </div>
                        <div className="truncate text-[var(--font-size-xs)] font-light text-[var(--color-text-secondary)]">
                          {track.artist}
                        </div>
                      </div>
                      <button
                        data-no-drag
                        onClick={() => onRemoveFromQueue(index)}
                        className="flex-shrink-0 rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-all hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
                        title="Remove from queue"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Drop indicator after last item */}
                    {showDropAfter && (
                      <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-[var(--color-accent)]" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Output Section */}
        <div className="mt-auto flex items-center justify-between bg-[var(--color-bg-secondary)] p-[var(--spacing-md)] px-[var(--spacing-lg)]">
          <div className="flex items-center gap-[var(--spacing-sm)]">
            <Speaker className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
              {t("panel.output")}
            </span>
          </div>
          <span className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
            {t("panel.output.device")}
          </span>
        </div>
      </div>

      {/* Floating drag preview - vertical movement only */}
      {draggedTrack && dragIndex !== null && (
        <div
          className="pointer-events-none fixed z-50 bg-[var(--panel-bg)]/95 px-[var(--spacing-lg)] py-1.5 shadow-[var(--shadow-lg)] backdrop-blur-sm"
          style={{
            left: containerRef.current?.getBoundingClientRect().left ?? 0,
            top: dragY,
            width: containerRef.current?.getBoundingClientRect().width ?? 200,
          }}
        >
          <div className="flex items-center gap-2.5">
            {/* Album cover thumbnail */}
            <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)]">
              {draggedTrack.coverArtPath ? (
                <img
                  src={convertFileSrc(draggedTrack.coverArtPath)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
                  <Music2 className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                {draggedTrack.title}
              </div>
              <div className="truncate text-[var(--font-size-xs)] font-light text-[var(--color-text-secondary)]">
                {draggedTrack.artist}
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
