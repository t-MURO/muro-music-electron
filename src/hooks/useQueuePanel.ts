import { useCallback, useEffect, useRef } from "react";
import { useStickyState } from "./useStickyState";
import { parseDetailWidth } from "../utils";
import { useResizable } from "./useResizable";

export const useQueuePanel = () => {
  const [queuePanelWidth, setQueuePanelWidth] = useStickyState(
    "muro-queue-panel-width",
    320,
    {
      parse: parseDetailWidth,
      serialize: (value) => String(value),
    }
  );
  const [queuePanelCollapsed, setQueuePanelCollapsed] = useStickyState(
    "muro-queue-panel-collapsed",
    false,
    {
      parse: (raw) => raw === "true",
      serialize: (value) => String(value),
    }
  );
  const widthRef = useRef(queuePanelWidth);
  const { startResize } = useResizable();

  useEffect(() => {
    if (queuePanelCollapsed) {
      return;
    }

    widthRef.current = queuePanelWidth;
  }, [queuePanelCollapsed, queuePanelWidth]);

  const toggleQueuePanelCollapsed = useCallback(() => {
    if (!queuePanelCollapsed) {
      widthRef.current = queuePanelWidth;
      setQueuePanelWidth(80);
      setQueuePanelCollapsed(true);
    } else {
      setQueuePanelWidth(widthRef.current || 320);
      setQueuePanelCollapsed(false);
    }
  }, [queuePanelCollapsed, queuePanelWidth, setQueuePanelCollapsed, setQueuePanelWidth]);

  const startQueuePanelResize = useCallback(
    (event: React.MouseEvent) => {
      startResize(
        event,
        queuePanelWidth,
        (nextWidth) => {
          setQueuePanelWidth(Math.min(420, nextWidth));
        },
        { minSize: 200, maxSize: 420, direction: -1 }
      );
    },
    [queuePanelWidth, setQueuePanelWidth, startResize]
  );

  return {
    queuePanelCollapsed,
    queuePanelWidth,
    setQueuePanelWidth,
    startQueuePanelResize,
    toggleQueuePanelCollapsed,
  };
};
