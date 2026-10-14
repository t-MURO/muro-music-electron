import { useEffect } from "react";

let openCount = 0;

/**
 * Window drag regions swallow pointer events, so an outside click on the
 * title bar never reaches a popover's dismiss handler. While a popover is
 * open, drag regions are switched off (see `[data-window-drag-suspended]`
 * in index.css).
 */
export const useSuspendWindowDrag = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    openCount += 1;
    document.documentElement.dataset.windowDragSuspended = "";
    return () => {
      openCount -= 1;
      if (openCount === 0) delete document.documentElement.dataset.windowDragSuspended;
    };
  }, [active]);
};
