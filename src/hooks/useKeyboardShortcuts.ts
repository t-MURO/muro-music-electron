import { useEffect, useRef } from "react";

const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.05;

export type KeyboardShortcutHandlers = {
  onTogglePlay: () => void;
  onSkipPrevious: () => void;
  onSkipNext: () => void;
  onSeek: (position: number) => void;
  currentPosition: number;
  volume: number;
  onSetVolume: (volume: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onRateSelection: (rating: number) => void;
  onQueueSelection: () => void;
  onPlaySelectionNext: () => void;
  onDeleteSelection: () => void;
  onToggleShortcutHelp: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

const isTextEntry = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
};

/**
 * The track table owns Space and the arrow keys while it holds focus: Space
 * plays the active row and the arrows move the selection. Global playback
 * shortcuts step aside rather than firing twice.
 */
const isTrackTableFocused = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.("[data-track-table-scroll]"));
};

/** Every blocking modal renders the shared `modal-overlay-animate` overlay. */
const isBlockingModalOpen = () =>
  document.querySelector(".modal-overlay-animate") !== null;

/**
 * Global keyboard shortcuts.
 *
 * Playback     Space toggle · ArrowLeft/Right previous/next ·
 *              Cmd+ArrowLeft/Right seek 5s · ArrowUp/Down volume · M mute
 * Modes        S shuffle · R repeat
 * Selection    0-5 rating · Q queue · N play next · Delete remove
 * History      Cmd+Z undo · Cmd+Shift+Z or Cmd+Y redo
 * Help         ? shortcut sheet
 *
 * Search focus (Cmd+F / Cmd+K) lives in LibraryHeader next to the input, and
 * Cmd+A / Escape / Enter belong to the track table.
 */
export const useKeyboardShortcuts = (handlers: KeyboardShortcutHandlers) => {
  // Handlers change identity on nearly every render; a ref keeps the listener
  // registered once instead of tearing down and rebinding continuously.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const current = handlersRef.current;
      const isMeta = event.metaKey || event.ctrlKey;
      const typing = isTextEntry(event.target);

      // Undo/redo must reach text fields untouched so the browser's own text
      // history keeps working inside the edit dialog and the search box.
      if (isMeta && !typing) {
        const key = event.key.toLowerCase();
        if (key === "z" || key === "y") {
          event.preventDefault();
          if (key === "y" || event.shiftKey) current.onRedo();
          else current.onUndo();
          return;
        }
      }

      if (typing || isBlockingModalOpen()) return;

      const tableFocused = isTrackTableFocused(event.target);

      switch (event.code) {
        case "Space":
          if (tableFocused) return;
          event.preventDefault();
          current.onTogglePlay();
          return;
        case "ArrowLeft":
          event.preventDefault();
          if (isMeta) {
            current.onSeek(Math.max(0, current.currentPosition - SEEK_STEP_SECONDS));
          } else {
            current.onSkipPrevious();
          }
          return;
        case "ArrowRight":
          event.preventDefault();
          if (isMeta) {
            current.onSeek(current.currentPosition + SEEK_STEP_SECONDS);
          } else {
            current.onSkipNext();
          }
          return;
        case "ArrowUp":
          if (tableFocused) return;
          event.preventDefault();
          current.onSetVolume(Math.min(1, current.volume + VOLUME_STEP));
          return;
        case "ArrowDown":
          if (tableFocused) return;
          event.preventDefault();
          current.onSetVolume(Math.max(0, current.volume - VOLUME_STEP));
          return;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          current.onDeleteSelection();
          return;
      }

      if (isMeta || event.altKey) return;

      // Rating uses event.key so the number row and the numpad both work.
      if (/^[0-5]$/.test(event.key)) {
        event.preventDefault();
        current.onRateSelection(Number(event.key));
        return;
      }

      switch (event.key.toLowerCase()) {
        case "m":
          event.preventDefault();
          current.onToggleMute();
          return;
        case "s":
          event.preventDefault();
          current.onToggleShuffle();
          return;
        case "r":
          event.preventDefault();
          current.onCycleRepeat();
          return;
        case "q":
          event.preventDefault();
          current.onQueueSelection();
          return;
        case "n":
          event.preventDefault();
          current.onPlaySelectionNext();
          return;
        case "?":
          event.preventDefault();
          current.onToggleShortcutHelp();
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
};
