import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  GripVertical,
  ListMusic,
  Music2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Speaker,
  X,
} from "lucide-react";
import { t } from "../../i18n";
import { useDragSession } from "../../contexts/DragSessionContext";
import { NowPlayingTrack } from "../queue/NowPlayingTrack";
import { MixSuggestions } from "../queue/MixSuggestions";
import type { Track } from "../../types";
import type { CurrentTrack } from "../../hooks";

type QueuePanelProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  queueTracks: Track[];
  allTracks: Track[];
  currentTrack: CurrentTrack | null;
  currentTrackDetails?: Track | null;
  onRemoveFromQueue: (index: number) => void;
  onReorderQueue: (fromIndex: number, toIndex: number) => void;
  onClearQueue: () => void;
  onPlayTrack: (trackId: string) => void;
  onPlayNext: (trackId: string) => void;
};

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

export const QueuePanel = ({
  collapsed,
  onToggleCollapsed,
  queueTracks,
  allTracks,
  currentTrack,
  currentTrackDetails,
  onRemoveFromQueue,
  onReorderQueue,
  onClearQueue,
  onPlayTrack,
  onPlayNext,
}: QueuePanelProps) => {
  const { startInternalDrag, endInternalDrag } = useDragSession();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [panelView, setPanelView] = useState<"queue" | "mix">("queue");
  const dragStartRef = useRef<{ index: number; y: number; itemY: number } | null>(null);
  const itemRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const totalDuration = useMemo(
    () => queueTracks.reduce((total, track) => total + (track.durationSeconds || 0), 0),
    [queueTracks],
  );

  const handleMouseDown = useCallback((event: React.MouseEvent, index: number) => {
    if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
    event.preventDefault();
    const item = itemRefsRef.current.get(index);
    if (!item) return;
    dragStartRef.current = { index, y: event.clientY, itemY: item.getBoundingClientRect().top };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragStartRef.current) return;
      const { index, y: startY, itemY } = dragStartRef.current;
      const deltaY = event.clientY - startY;
      if (dragIndex === null && Math.abs(deltaY) > 4) {
        setDragIndex(index);
        startInternalDrag("queue");
      }
      if (dragIndex === null) return;
      setDragY(itemY + deltaY);
      let nextDropIndex: number | null = null;
      for (let itemIndex = 0; itemIndex < queueTracks.length; itemIndex += 1) {
        const item = itemRefsRef.current.get(itemIndex);
        if (!item) continue;
        const rect = item.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          nextDropIndex = itemIndex;
          break;
        }
        nextDropIndex = itemIndex + 1;
      }
      if (nextDropIndex === index || nextDropIndex === index + 1) nextDropIndex = null;
      setDropIndex(nextDropIndex);
    };

    const handleMouseUp = () => {
      if (dragIndex !== null && dropIndex !== null) {
        const targetIndex = dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
        if (targetIndex !== dragIndex) onReorderQueue(dragIndex, targetIndex);
      }
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
  }, [dragIndex, dropIndex, endInternalDrag, onReorderQueue, queueTracks.length, startInternalDrag]);

  const draggedTrack = dragIndex !== null ? queueTracks[dragIndex] : null;

  if (collapsed) {
    return (
      <aside className="flex h-full flex-col items-center border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-5">
        <button className="toolbar-icon-button" onClick={onToggleCollapsed} title="Expand queue" aria-label="Expand queue" type="button"><PanelRightOpen className="h-4 w-4" /></button>
        <ListMusic className="mt-6 h-4 w-4 text-[var(--color-text-muted)]" />
        {queueTracks.length > 0 && <span className="mt-2 text-[10px] tabular-nums text-[var(--color-accent)]">{queueTracks.length}</span>}
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div className="flex h-[68px] shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <div className="flex min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-0.5" role="tablist" aria-label="Right sidebar view">
          <button
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-2 py-1.5 text-[10px] font-medium transition-colors ${panelView === "queue" ? "bg-[var(--color-bg-active)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
            onClick={() => setPanelView("queue")}
            role="tab"
            aria-selected={panelView === "queue"}
            data-panel-view="queue"
            type="button"
          >
            <ListMusic className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Queue</span>
          </button>
          <button
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-2 py-1.5 text-[10px] font-medium transition-colors ${panelView === "mix" ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] shadow-sm" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
            onClick={() => setPanelView("mix")}
            role="tab"
            aria-selected={panelView === "mix"}
            data-panel-view="mix"
            type="button"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Mix Next</span>
          </button>
        </div>
        <button className="toolbar-icon-button ml-auto" onClick={onToggleCollapsed} title="Collapse queue" aria-label="Collapse queue" type="button"><PanelRightClose className="h-4 w-4" /></button>
      </div>

      {panelView === "queue" ? (
        <>
      <div className="min-h-[198px] border-b border-[var(--color-border)] pt-5">
        <NowPlayingTrack currentTrack={currentTrack} trackDetails={currentTrackDetails} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center border-b border-[var(--color-border-light)] px-4">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-primary)]">{t("panel.queue")}</h3>
            <p className="mt-1 text-[10px] tabular-nums text-[var(--color-text-muted)]">{queueTracks.length} tracks · {formatDuration(totalDuration)}</p>
          </div>
          {queueTracks.length > 0 && <button className="ml-auto text-[11px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]" onClick={onClearQueue} title="Clear queue" aria-label="Clear queue" type="button">Clear</button>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" ref={containerRef}>
          {queueTracks.length === 0 ? (
            <div className="flex h-full min-h-28 flex-col items-center justify-center px-6 text-center text-[var(--color-text-muted)]"><Music2 className="mb-3 h-5 w-5" /><p className="text-xs">Queue is empty</p><p className="mt-1 text-[10px]">Right-click tracks to add them here.</p></div>
          ) : (
            <div className="relative py-1">
              {queueTracks.map((track, index) => {
                const isDragging = dragIndex === index;
                const isCurrentQueueTrack = currentTrack?.id === track.id;
                const showDropBefore = dropIndex === index;
                const showDropAfter = dropIndex === queueTracks.length && index === queueTracks.length - 1;
                return (
                  <div key={`${track.id}-queue-${index}`} className="relative">
                    {showDropBefore && <div className="absolute -top-px left-3 right-3 z-10 h-px bg-[var(--color-accent)]" />}
                    <div
                      ref={(element) => { if (element) itemRefsRef.current.set(index, element); else itemRefsRef.current.delete(index); }}
                      onMouseDown={(event) => handleMouseDown(event, index)}
                      className={`group grid min-h-[49px] cursor-grab grid-cols-[16px_20px_minmax(0,1fr)_44px_38px_24px] items-center gap-1.5 border-b border-[var(--color-border-light)] px-3 text-[10px] active:cursor-grabbing ${isDragging ? "opacity-25" : "hover:bg-[var(--color-bg-hover)]"}`}
                      data-queue-track
                    >
                      {isCurrentQueueTrack
                        ? <AudioLines className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                        : <GripVertical className="h-3.5 w-3.5 text-[var(--color-text-muted)] opacity-60" />}
                      <span className="text-center tabular-nums text-[var(--color-text-muted)]">{index + 1}</span>
                      <div className="min-w-0"><div className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">{track.title}</div><div className="mt-0.5 truncate text-[10px] text-[var(--color-text-muted)]">{track.artist}</div></div>
                      <div className="text-right tabular-nums"><div className="font-semibold text-[var(--color-accent)]">{track.key || "—"}</div><div className="mt-0.5 text-[var(--color-text-muted)]">{track.bpm ? track.bpm.toFixed(1) : "—"}</div></div>
                      <span className="text-right tabular-nums text-[var(--color-text-secondary)]">{track.duration}</span>
                      <button data-no-drag onClick={() => onRemoveFromQueue(index)} className="toolbar-icon-button h-6 w-6 opacity-0 group-hover:opacity-100" title="Remove from queue" aria-label={`Remove ${track.title} from queue`} type="button"><X className="h-3.5 w-3.5" /></button>
                    </div>
                    {showDropAfter && <div className="absolute -bottom-px left-3 right-3 z-10 h-px bg-[var(--color-accent)]" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex h-14 shrink-0 items-center border-t border-[var(--color-border)] px-4">
        <Speaker className="h-4 w-4 text-[var(--color-text-muted)]" />
        <div className="ml-2"><div className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{t("panel.output")}</div><div className="mt-0.5 text-[11px] text-[var(--color-text-primary)]">{t("panel.output.device")}</div></div>
      </div>

      {draggedTrack && dragIndex !== null && (
        <div className="pointer-events-none fixed z-50 border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2 shadow-[var(--shadow-lg)]" style={{ left: containerRef.current?.getBoundingClientRect().left ?? 0, top: dragY, width: containerRef.current?.getBoundingClientRect().width ?? 240 }}>
          <div className="truncate text-xs font-medium text-[var(--color-text-primary)]">{draggedTrack.title}</div>
          <div className="truncate text-[10px] text-[var(--color-text-muted)]">{draggedTrack.artist}</div>
        </div>
      )}
        </>
      ) : (
        <MixSuggestions
          tracks={allTracks}
          currentTrack={currentTrackDetails}
          queuedTrackIds={queueTracks.map((track) => track.id)}
          onPlayTrack={onPlayTrack}
          onPlayNext={onPlayNext}
        />
      )}
    </aside>
  );
};
