import { useEffect } from "react";

const SEEK_STEP_SECONDS = 5;

type UseKeyboardShortcutsArgs = {
  onTogglePlay: () => void;
  onSkipPrevious: () => void;
  onSkipNext: () => void;
  onSeek: (position: number) => void;
  currentPosition: number;
};

/**
 * Global keyboard shortcuts for media playback.
 * - Space: Toggle play/pause
 * - ArrowLeft: Previous track
 * - ArrowRight: Next track
 * - Cmd+ArrowLeft: Seek backward 5s
 * - Cmd+ArrowRight: Seek forward 5s
 */
export const useKeyboardShortcuts = ({
  onTogglePlay,
  onSkipPrevious,
  onSkipNext,
  onSeek,
  currentPosition,
}: UseKeyboardShortcutsArgs) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      const isInputField =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInputField) {
        return;
      }

      const isMeta = event.metaKey || event.ctrlKey;

      switch (event.code) {
        case "Space":
          event.preventDefault();
          onTogglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (isMeta) {
            onSeek(Math.max(0, currentPosition - SEEK_STEP_SECONDS));
          } else {
            onSkipPrevious();
          }
          break;
        case "ArrowRight":
          event.preventDefault();
          if (isMeta) {
            onSeek(currentPosition + SEEK_STEP_SECONDS);
          } else {
            onSkipNext();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onTogglePlay, onSkipPrevious, onSkipNext, onSeek, currentPosition]);
};
