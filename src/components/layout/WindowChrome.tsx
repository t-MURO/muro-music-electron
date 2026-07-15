import { Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import appLogo from "../../assets/app-logo.png";
import type { WindowControlAction } from "../../desktop/bridge";

type WindowMaximizedPayload = {
  maximized?: unknown;
};

export const WindowChrome = () => {
  const isMac = window.muro?.platform === "darwin";
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const desktop = window.muro;
    if (!desktop) return;

    let active = true;
    void desktop.isWindowMaximized().then((maximized) => {
      if (active) setIsMaximized(maximized);
    });
    const unsubscribe = desktop.on("muro://window-maximized", (payload) => {
      const maximized = (payload as WindowMaximizedPayload | null)?.maximized;
      if (typeof maximized === "boolean") setIsMaximized(maximized);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const controlWindow = async (action: WindowControlAction) => {
    const maximized = await window.muro?.windowControl(action);
    if (action === "toggleMaximize" && typeof maximized === "boolean") {
      setIsMaximized(maximized);
    }
  };

  const toggleMaximize = () => void controlWindow("toggleMaximize");

  return (
    <header
      className="window-drag-region relative flex h-[38px] shrink-0 select-none items-center border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
      data-window-chrome
      onDoubleClick={toggleMaximize}
    >
      {isMac ? (
        <div className="window-no-drag group ml-3 flex items-center gap-2" data-window-controls="mac">
          <button
            className="mac-window-control bg-[#ff5f57]"
            onClick={() => void controlWindow("close")}
            aria-label="Close window"
            title="Close"
            type="button"
          >
            <X className="h-2 w-2 opacity-0 transition-opacity group-hover:opacity-70" strokeWidth={3} />
          </button>
          <button
            className="mac-window-control bg-[#febc2e]"
            onClick={() => void controlWindow("minimize")}
            aria-label="Minimize window"
            title="Minimize"
            type="button"
          >
            <Minus className="h-2 w-2 opacity-0 transition-opacity group-hover:opacity-70" strokeWidth={3} />
          </button>
          <button
            className="mac-window-control bg-[#28c840]"
            onClick={toggleMaximize}
            aria-label={isMaximized ? "Restore window" : "Maximize window"}
            title={isMaximized ? "Restore" : "Maximize"}
            type="button"
          >
            <Square className="h-1.5 w-1.5 opacity-0 transition-opacity group-hover:opacity-70" strokeWidth={3} />
          </button>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-3" data-window-brand>
          <img className="h-4 w-4 rounded-[4px]" src={appLogo} alt="" />
          <span className="truncate text-[12px] font-medium tracking-[0.01em] text-[var(--color-text-secondary)]">
            Muro Music
          </span>
        </div>
      )}

      {isMac && (
        <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2" data-window-brand>
          <img className="h-4 w-4 rounded-[4px]" src={appLogo} alt="" />
          <span className="text-[12px] font-medium tracking-[0.01em] text-[var(--color-text-secondary)]">
            Muro Music
          </span>
        </div>
      )}

      <div className="min-w-4 flex-1" />

      {!isMac && (
        <div className="window-no-drag flex h-full items-stretch" data-window-controls="desktop">
          <button
            className="window-control-button"
            onClick={() => void controlWindow("minimize")}
            aria-label="Minimize window"
            title="Minimize"
            type="button"
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={1.6} />
          </button>
          <button
            className="window-control-button"
            onClick={toggleMaximize}
            aria-label={isMaximized ? "Restore window" : "Maximize window"}
            title={isMaximized ? "Restore" : "Maximize"}
            type="button"
          >
            {isMaximized ? (
              <span className="window-restore-icon" aria-hidden="true" />
            ) : (
              <Square className="h-3 w-3" strokeWidth={1.6} />
            )}
          </button>
          <button
            className="window-control-button window-control-button--close"
            onClick={() => void controlWindow("close")}
            aria-label="Close window"
            title="Close"
            type="button"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.6} />
          </button>
        </div>
      )}
    </header>
  );
};
