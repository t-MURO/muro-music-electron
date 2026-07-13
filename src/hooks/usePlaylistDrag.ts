import { useCallback, useEffect, useRef, useState } from "react";
import { useDragSession } from "../contexts/DragSessionContext";

/**
 * Hook for dragging tracks to playlists.
 *
 * Uses mouse events (not HTML5 drag) for full control.
 * Registers with the DragSession to prevent conflicts with native file drops.
 *
 * Usage:
 * 1. Attach onRowMouseDown to track rows
 * 2. When user drags 4+ pixels, drag starts
 * 3. Drag indicator follows cursor
 * 4. Drop on playlist targets (data-playlist-target attribute)
 */

type DragIndicator = {
  x: number;
  y: number;
  count: number;
};

type UsePlaylistDragArgs = {
  selectedIds: Set<string>;
  onDropToPlaylist: (playlistId: string, payload?: string[]) => void;
};

export const usePlaylistDrag = ({
  selectedIds,
  onDropToPlaylist,
}: UsePlaylistDragArgs) => {
  const { startInternalDrag, endInternalDrag, isInternalDrag } = useDragSession();

  const [draggingPlaylistId, setDraggingPlaylistId] = useState<string | null>(null);
  const [dragIndicator, setDragIndicator] = useState<DragIndicator | null>(null);

  // Refs for values that need to be accessed in event handlers
  const dragPayloadRef = useRef<string[]>([]);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragCandidateRef = useRef<string[]>([]);
  const isDraggingRef = useRef(false);
  const selectedIdsRef = useRef(selectedIds);
  const onDropToPlaylistRef = useRef(onDropToPlaylist);

  // Keep refs in sync
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    onDropToPlaylistRef.current = onDropToPlaylist;
  }, [onDropToPlaylist]);

  const resetDragState = useCallback(() => {
    dragStartRef.current = null;
    dragCandidateRef.current = [];
    dragPayloadRef.current = [];
    isDraggingRef.current = false;
    setDragIndicator(null);
    setDraggingPlaylistId(null);
    endInternalDrag();
  }, [endInternalDrag]);

  /**
   * Attach to track rows to start drag on mousedown.
   */
  const onRowMouseDown = useCallback(
    (event: React.MouseEvent, trackId: string) => {
      event.preventDefault();
      const currentSelectedIds = selectedIdsRef.current;

      // If clicking on a selected track, drag all selected
      // Otherwise, drag just this track
      dragCandidateRef.current = currentSelectedIds.has(trackId)
        ? Array.from(currentSelectedIds)
        : [trackId];

      dragStartRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    },
    []
  );

  // Keep playlist hover state synchronized across native drag events.
  const onPlaylistDragEnter = useCallback((id: string) => {
    setDraggingPlaylistId(id);
  }, []);

  const onPlaylistDragLeave = useCallback((id: string) => {
    setDraggingPlaylistId((current) => (current === id ? null : current));
  }, []);

  const onPlaylistDragOver = useCallback((id: string) => {
    setDraggingPlaylistId(id);
  }, []);

  const onPlaylistDropEvent = useCallback(
    (event: React.DragEvent<HTMLButtonElement>, playlistId: string) => {
      const data = event.dataTransfer.getData("text/plain");
      const payload = data ? data.split(",").map((item) => item.trim()) : [];
      onDropToPlaylistRef.current(playlistId, payload);
      resetDragState();
    },
    [resetDragState]
  );

  // Mouse move/up handlers for drag
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragStartRef.current) return;

      const distance = Math.hypot(
        event.clientX - dragStartRef.current.x,
        event.clientY - dragStartRef.current.y
      );

      // Start drag after 4px movement
      if (!isDraggingRef.current && distance > 4) {
        isDraggingRef.current = true;
        dragPayloadRef.current = dragCandidateRef.current;
        startInternalDrag("playlist");
        setDragIndicator({
          x: event.clientX,
          y: event.clientY,
          count: dragCandidateRef.current.length,
        });
      }

      // Update drag indicator position
      if (isDraggingRef.current) {
        setDragIndicator((current) =>
          current
            ? { ...current, x: event.clientX, y: event.clientY }
            : {
                x: event.clientX,
                y: event.clientY,
                count: dragPayloadRef.current.length,
              }
        );

        // Find playlist drop target under cursor
        const target = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest?.("[data-playlist-target]") as HTMLElement | null;
        setDraggingPlaylistId(
          target ? target.getAttribute("data-playlist-target") : null
        );
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (isDraggingRef.current) {
        // Find playlist drop target under cursor
        const target = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest?.("[data-playlist-target]") as HTMLElement | null;
        const playlistId = target?.getAttribute("data-playlist-target") ?? "";

        if (playlistId) {
          onDropToPlaylistRef.current(playlistId, dragPayloadRef.current);
        }
      }

      resetDragState();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resetDragState, startInternalDrag]);

  return {
    dragIndicator,
    draggingPlaylistId,
    isInternalDrag,
    onPlaylistDragEnter,
    onPlaylistDragLeave,
    onPlaylistDragOver,
    onPlaylistDropEvent,
    onRowMouseDown,
  };
};
