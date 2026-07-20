import { useCallback, useEffect, useRef, useState } from "react";
import { Cast, Check, Loader2, RefreshCw } from "lucide-react";
import { t } from "../../i18n";
import { notify, useCastStore } from "../../stores";
import { selectCastOutputActive } from "../../stores/castStore";
import {
  castStartDiscovery,
  castStopDiscovery,
  connectToCastDevice,
  disconnectFromCast,
} from "../../utils";

// Cast launcher for the player bar: a state-aware button plus an anchored
// device picker. All backend routing lives in useAudioPlayback and
// castController; this component only chooses devices.
export const CastMenu = () => {
  const devices = useCastStore((state) => state.devices);
  const scanning = useCastStore((state) => state.scanning);
  const discoveryError = useCastStore((state) => state.discoveryError);
  const sessionState = useCastStore((state) => state.sessionState);
  const deviceId = useCastStore((state) => state.deviceId);
  const deviceName = useCastStore((state) => state.deviceName);
  const lastError = useCastStore((state) => state.lastError);
  const castActive = useCastStore(selectCastOutputActive);

  const [open, setOpen] = useState(false);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isConnecting = sessionState === "connecting" || sessionState === "loading";
  const hasSessionError = sessionState === "error" && lastError !== null;

  useEffect(() => {
    if (!open) return;
    castStartDiscovery().catch(() => {
      // Discovery failures surface through the muro://cast-devices snapshot.
    });
    return () => {
      if (!selectCastOutputActive(useCastStore.getState())) {
        castStopDiscovery().catch(() => undefined);
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleConnect = useCallback(async (targetDeviceId: string) => {
    setBusyDeviceId(targetDeviceId);
    try {
      await connectToCastDevice(targetDeviceId);
    } catch {
      notify.error(t("player.cast.connectFailed"));
    } finally {
      setBusyDeviceId(null);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setBusyDeviceId(null);
    try {
      await disconnectFromCast();
    } catch {
      notify.error(t("player.cast.commandFailed"));
    }
  }, []);

  const handleRetry = useCallback(() => {
    castStartDiscovery().catch(() => undefined);
  }, []);

  const buttonTitle = castActive && deviceName
    ? t("player.cast.castingTo", { name: deviceName })
    : t("player.cast.tooltip");
  const buttonTone = castActive
    ? "text-[var(--color-accent)]"
    : hasSessionError
      ? "text-red-500"
      : "text-[var(--color-text-secondary)]";

  return (
    <div ref={containerRef} className="relative">
      <button
        className={`player-bar-button flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] ${buttonTone}`}
        onClick={() => setOpen((current) => !current)}
        title={buttonTitle}
        aria-label={buttonTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        type="button"
        data-cast-button
        data-cast-state={sessionState}
      >
        {isConnecting
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <Cast className="h-4 w-4" />}
      </button>

      {open && (
        <div
          className="absolute bottom-[calc(100%+10px)] right-0 z-50 w-72 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
          role="menu"
          aria-label={t("player.cast.heading")}
          data-cast-menu
        >
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
              {t("player.cast.heading")}
            </span>
            {scanning && (
              <span className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]" role="status">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("player.cast.scanning")}
              </span>
            )}
          </div>

          {devices.length === 0 && !scanning && (
            <div className="px-2 py-3 text-[11px] text-[var(--color-text-muted)]">
              <p>{discoveryError ?? t("player.cast.noDevices")}</p>
              <p className="mt-1">{t("player.cast.noDevicesHint")}</p>
              <button
                className="mt-2 flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                onClick={handleRetry}
                type="button"
              >
                <RefreshCw className="h-3 w-3" />
                {t("player.cast.retry")}
              </button>
            </div>
          )}

          {devices.map((device) => {
            const isConnected = castActive && device.id === deviceId;
            const isBusy = busyDeviceId === device.id;
            return (
              <button
                key={device.id}
                className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left text-[12px] hover:bg-[var(--color-bg-hover)] ${isConnected ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"}`}
                onClick={() => (isConnected ? void handleDisconnect() : void handleConnect(device.id))}
                disabled={isBusy || isConnecting}
                role="menuitem"
                type="button"
                data-cast-device={device.id}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{device.name}</span>
                  {device.model && (
                    <span className="block truncate text-[10px] text-[var(--color-text-muted)]">{device.model}</span>
                  )}
                </span>
                {isBusy || (isConnecting && device.id === busyDeviceId)
                  ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  : isConnected
                    ? <Check className="h-3.5 w-3.5 shrink-0" />
                    : null}
              </button>
            );
          })}

          {castActive && deviceName && (
            <div className="mt-1 border-t border-[var(--color-border)] px-2 pb-1 pt-2">
              <p className="truncate text-[10px] text-[var(--color-text-muted)]" data-cast-output-label>
                {t("player.cast.castingTo", { name: deviceName })}
              </p>
              <button
                className="mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                onClick={() => void handleDisconnect()}
                type="button"
                data-cast-disconnect
              >
                {t("player.cast.disconnect")}
              </button>
            </div>
          )}

          {hasSessionError && (
            <div className="mt-1 border-t border-[var(--color-border)] px-2 pb-1 pt-2">
              <p className="text-[10px] text-red-500">{lastError.message}</p>
              <button
                className="mt-1.5 flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                onClick={handleRetry}
                type="button"
              >
                <RefreshCw className="h-3 w-3" />
                {t("player.cast.retry")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
