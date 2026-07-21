import { useCallback, useEffect, useRef, useState } from "react";
import { Cast, Check, Loader2, RefreshCw } from "lucide-react";
import { t } from "../../i18n";
import { notify } from "../../stores";
import {
  useRemoteOutputStore,
  selectRemoteOutputActive,
  selectRemoteScanning,
} from "../../stores/remoteOutputStore";
import {
  remoteDeviceKey,
  remoteStartDiscovery,
  remoteStopDiscovery,
} from "../../utils/remoteOutputApi";
import {
  connectToRemoteDevice,
  disconnectFromRemote,
} from "../../utils/remoteOutputController";

const PROTOCOL_BADGES = { cast: "Cast", dlna: "DLNA" } as const;

// Remote-output launcher for the player bar: a state-aware button plus an
// anchored picker listing every Google Cast and DLNA device on the network.
// All backend routing lives in useAudioPlayback and remoteOutputController;
// this component only chooses devices.
export const OutputMenu = () => {
  const devices = useRemoteOutputStore((state) => state.devices);
  const scanning = useRemoteOutputStore(selectRemoteScanning);
  const discoveryError = useRemoteOutputStore((state) => state.discoveryError);
  const sessionState = useRemoteOutputStore((state) => state.sessionState);
  const protocol = useRemoteOutputStore((state) => state.protocol);
  const deviceId = useRemoteOutputStore((state) => state.deviceId);
  const deviceName = useRemoteOutputStore((state) => state.deviceName);
  const lastError = useRemoteOutputStore((state) => state.lastError);
  const outputActive = useRemoteOutputStore(selectRemoteOutputActive);

  const [open, setOpen] = useState(false);
  const [busyDeviceKey, setBusyDeviceKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isConnecting = sessionState === "connecting" || sessionState === "loading";
  const hasSessionError = sessionState === "error" && lastError !== null;
  const connectedKey = outputActive && protocol && deviceId
    ? remoteDeviceKey(protocol, deviceId)
    : null;

  useEffect(() => {
    if (!open) return;
    void remoteStartDiscovery();
    return () => {
      if (!selectRemoteOutputActive(useRemoteOutputStore.getState())) {
        void remoteStopDiscovery();
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

  const handleConnect = useCallback(async (deviceKey: string) => {
    const device = useRemoteOutputStore.getState().devices
      .find((entry) => entry.key === deviceKey);
    if (!device) return;
    setBusyDeviceKey(deviceKey);
    try {
      await connectToRemoteDevice(device);
    } catch {
      notify.error(t("player.output.connectFailed"));
    } finally {
      setBusyDeviceKey(null);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setBusyDeviceKey(null);
    try {
      await disconnectFromRemote();
    } catch {
      notify.error(t("player.output.commandFailed"));
    }
  }, []);

  const handleRetry = useCallback(() => {
    void remoteStartDiscovery();
  }, []);

  const buttonTitle = outputActive && deviceName
    ? t("player.output.playingOn", { name: deviceName })
    : t("player.output.tooltip");
  const buttonTone = outputActive
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
        data-output-button
        data-output-state={sessionState}
      >
        {isConnecting
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <Cast className="h-4 w-4" />}
      </button>

      {open && (
        <div
          className="absolute bottom-[calc(100%+10px)] right-0 z-50 w-72 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
          role="menu"
          aria-label={t("player.output.heading")}
          data-output-menu
        >
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
              {t("player.output.heading")}
            </span>
            {scanning && (
              <span className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]" role="status">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("player.output.scanning")}
              </span>
            )}
          </div>

          {devices.length === 0 && !scanning && (
            <div className="px-2 py-3 text-[11px] text-[var(--color-text-muted)]">
              <p>{discoveryError ?? t("player.output.noDevices")}</p>
              <p className="mt-1">{t("player.output.noDevicesHint")}</p>
              <button
                className="mt-2 flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                onClick={handleRetry}
                type="button"
              >
                <RefreshCw className="h-3 w-3" />
                {t("player.output.retry")}
              </button>
            </div>
          )}

          {devices.map((device) => {
            const isConnected = device.key === connectedKey;
            const isBusy = busyDeviceKey === device.key;
            return (
              <button
                key={device.key}
                className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left text-[12px] hover:bg-[var(--color-bg-hover)] ${isConnected ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"}`}
                onClick={() => (isConnected ? void handleDisconnect() : void handleConnect(device.key))}
                disabled={isBusy || isConnecting}
                role="menuitem"
                type="button"
                data-output-device={device.key}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{device.name}</span>
                  <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
                    {PROTOCOL_BADGES[device.protocol]}
                    {device.model ? ` · ${device.model}` : ""}
                  </span>
                </span>
                {isBusy
                  ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  : isConnected
                    ? <Check className="h-3.5 w-3.5 shrink-0" />
                    : null}
              </button>
            );
          })}

          {outputActive && deviceName && (
            <div className="mt-1 border-t border-[var(--color-border)] px-2 pb-1 pt-2">
              <p className="truncate text-[10px] text-[var(--color-text-muted)]" data-output-label>
                {t("player.output.playingOn", { name: deviceName })}
              </p>
              <button
                className="mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                onClick={() => void handleDisconnect()}
                type="button"
                data-output-disconnect
              >
                {t("player.output.disconnect")}
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
                {t("player.output.retry")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
