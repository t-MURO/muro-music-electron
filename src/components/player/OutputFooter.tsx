import { useRef } from "react";
import { ChevronUp, Loader2, Speaker } from "lucide-react";
import { t } from "../../i18n";
import { useSettingsStore } from "../../stores";
import {
  useRemoteOutputStore,
  selectRemoteOutputActive,
} from "../../stores/remoteOutputStore";
import { OutputPickerPopover, useOutputPickerToggle } from "./OutputPicker";

// Queue-panel footer: shows the current output (local device or network
// renderer) and opens the shared picker listing all available devices.
export const OutputFooter = () => {
  const localDeviceLabel = useSettingsStore((state) => state.audioOutputDeviceLabel);
  const sessionState = useRemoteOutputStore((state) => state.sessionState);
  const deviceName = useRemoteOutputStore((state) => state.deviceName);
  const outputActive = useRemoteOutputStore(selectRemoteOutputActive);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const { open, setOpen } = useOutputPickerToggle(containerRef);

  const isConnecting = sessionState === "connecting" || sessionState === "loading";
  const currentLabel = outputActive && deviceName
    ? deviceName
    : localDeviceLabel || t("output.systemDefault");

  return (
    <div ref={containerRef} className="relative flex h-14 shrink-0 items-center border-t border-[var(--color-border)]">
      <button
        className="group flex h-full w-full items-center px-4 text-left hover:bg-[var(--color-bg-hover)]"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        type="button"
        data-output-footer
      >
        {isConnecting
          ? <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-muted)]" />
          : <Speaker className={`h-4 w-4 ${outputActive ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"}`} />}
        <div className="ml-2 min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{t("panel.output")}</div>
          <div className={`mt-0.5 truncate text-[11px] ${outputActive ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"}`} data-output-footer-label>
            {currentLabel}
          </div>
        </div>
        <ChevronUp className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && <OutputPickerPopover className="bottom-[calc(100%+6px)] left-2 right-2 w-auto" />}
    </div>
  );
};
