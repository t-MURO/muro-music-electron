type DragIndicator = {
  x: number;
  y: number;
  count: number;
};

type DragOverlayProps = {
  isDragging: boolean;
  nativeDropStatus: string | null;
  dragIndicator: DragIndicator | null;
  isInternalDrag: boolean;
};

export const DragOverlay = ({
  isDragging,
  nativeDropStatus,
  dragIndicator,
  isInternalDrag,
}: DragOverlayProps) => {
  return (
    <>
      {isDragging && (
        <div className="drag-overlay pointer-events-none fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="drag-overlay-card rounded-[var(--radius-lg)] border border-[var(--accent)] px-6 py-4 text-sm font-semibold text-[var(--accent)] shadow-[var(--shadow-lg)]">
            Drop folders or audio files to import.
          </div>
        </div>
      )}
      {nativeDropStatus && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50">
          <div className="rounded-[var(--radius-md)] border border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] shadow-[var(--shadow-md)]">
            {nativeDropStatus}
          </div>
        </div>
      )}
      {dragIndicator && isInternalDrag && (
        <div
          className="pointer-events-none fixed z-40"
          style={{ left: dragIndicator.x + 16, top: dragIndicator.y + 12 }}
        >
          <div className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white shadow-[var(--shadow-md)]">
            {dragIndicator.count} track{dragIndicator.count === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </>
  );
};
