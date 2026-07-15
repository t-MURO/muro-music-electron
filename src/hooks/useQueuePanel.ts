import { useCallback, useEffect, useRef } from "react";
import { useStickyState } from "./useStickyState";
import { parseDetailWidth } from "../utils";
import { useResizable } from "./useResizable";

export const useQueuePanel = () => {
  const [queuePanelWidth, setQueuePanelWidth] = useStickyState(
    "muro-queue-panel-width",
    328,
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
  const [queuePanelExpanded, setQueuePanelExpanded] = useStickyState(
    "muro-queue-panel-expanded",
    false,
    {
      parse: (raw) => raw === "true",
      serialize: (value) => String(value),
    }
  );
  const widthRef = useRef(queuePanelWidth);
  const { startResize } = useResizable();

  useEffect(() => {
    if (queuePanelCollapsed || queuePanelExpanded) {
      return;
    }

    widthRef.current = queuePanelWidth;
  }, [queuePanelCollapsed, queuePanelExpanded, queuePanelWidth]);

  const toggleQueuePanelCollapsed = useCallback(() => {
    if (!queuePanelCollapsed) {
      widthRef.current = queuePanelWidth;
      setQueuePanelWidth(56);
      setQueuePanelCollapsed(true);
      setQueuePanelExpanded(false);
    } else {
      setQueuePanelWidth(widthRef.current || 328);
      setQueuePanelCollapsed(false);
    }
  }, [queuePanelCollapsed, queuePanelWidth, setQueuePanelCollapsed, setQueuePanelExpanded, setQueuePanelWidth]);

  const toggleQueuePanelExpanded = useCallback(() => {
    if (queuePanelExpanded) {
      setQueuePanelWidth(Math.max(260, Math.min(420, widthRef.current || 328)));
      setQueuePanelExpanded(false);
      return;
    }
    widthRef.current = Math.max(260, Math.min(420, queuePanelWidth));
    const expandedWidth = Math.min(640, Math.max(480, Math.round(window.innerWidth * 0.4)));
    setQueuePanelWidth(expandedWidth);
    setQueuePanelExpanded(true);
  }, [queuePanelExpanded, queuePanelWidth, setQueuePanelExpanded, setQueuePanelWidth]);

  const startQueuePanelResize = useCallback(
    (event: React.MouseEvent) => {
      startResize(
        event,
        queuePanelWidth,
        (nextWidth) => {
          setQueuePanelWidth(Math.min(720, nextWidth));
        },
        { minSize: 240, maxSize: 720, direction: -1 }
      );
    },
    [queuePanelWidth, setQueuePanelWidth, startResize]
  );

  return {
    queuePanelCollapsed,
    queuePanelExpanded,
    queuePanelWidth,
    setQueuePanelWidth,
    startQueuePanelResize,
    toggleQueuePanelCollapsed,
    toggleQueuePanelExpanded,
  };
};
