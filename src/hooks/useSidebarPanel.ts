import { useCallback } from "react";
import { useResizable } from "./useResizable";
import { useStickyState } from "./useStickyState";
import { parseNumber } from "../utils";

export const useSidebarPanel = () => {
  const [sidebarWidth, setSidebarWidth] = useStickyState(
    "muro-sidebar-width",
    220,
    {
      parse: parseNumber(220),
      serialize: (value) => String(value),
    }
  );
  const { startResize } = useResizable();

  const startSidebarResize = useCallback(
    (event: React.MouseEvent) => {
      startResize(
        event,
        sidebarWidth,
        (nextWidth) => {
          setSidebarWidth(Math.min(360, nextWidth));
        },
        { minSize: 200, maxSize: 360 }
      );
    },
    [sidebarWidth, setSidebarWidth, startResize]
  );

  return { sidebarWidth, startSidebarResize };
};
