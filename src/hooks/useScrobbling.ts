import { useEffect, useRef } from "react";
import { listen } from "@muro/desktop/events";
import { notify, useNotificationStore, useScrobbleStore, useSettingsStore } from "../stores";
import { t } from "../i18n";
import {
  configureScrobbling,
  flushScrobbles,
  type ScrobbleServiceId,
  type ScrobbleStatus,
} from "../utils/scrobblingApi";

// The shared secret is typed into a settings field; wait for a pause so a
// half-typed secret is not tried against Last.fm.
const CONFIGURE_DELAY_MS = 600;

export const SCROBBLE_SERVICE_LABELS: Record<ScrobbleServiceId, string> = {
  lastfm: "Last.fm",
  listenbrainz: "ListenBrainz",
};

const SERVICES: ScrobbleServiceId[] = ["lastfm", "listenbrainz"];

/**
 * Keeps the main-process scrobbler configured and its status in the store,
 * flushes the offline queue when connectivity returns, and tells the user when
 * an account needs to be connected again.
 */
export const useScrobblingSync = ({ onOpenSettings }: { onOpenSettings: () => void }) => {
  const lastFmApiKey = useSettingsStore((s) => s.lastFmApiKey);
  const lastFmSharedSecret = useSettingsStore((s) => s.lastFmSharedSecret);
  const setStatus = useScrobbleStore((s) => s.setStatus);
  const openSettingsRef = useRef(onOpenSettings);
  const reconnectNotified = useRef<Record<ScrobbleServiceId, boolean>>({
    lastfm: false,
    listenbrainz: false,
  });

  useEffect(() => {
    openSettingsRef.current = onOpenSettings;
  }, [onOpenSettings]);

  useEffect(() => {
    const applyStatus = (status: ScrobbleStatus) => {
      setStatus(status);
      for (const service of SERVICES) {
        const needsReconnect = status[service].enabled && status[service].needsReconnect;
        if (needsReconnect && !reconnectNotified.current[service]) {
          notify.error(
            t("scrobble.toast.reconnect", { service: SCROBBLE_SERVICE_LABELS[service] }),
            {
              key: `scrobble-reconnect-${service}`,
              sticky: true,
              action: {
                label: t("scrobble.toast.openSettings"),
                onClick: () => openSettingsRef.current(),
              },
            },
          );
        } else if (!needsReconnect && reconnectNotified.current[service]) {
          useNotificationStore.getState().removeNotification(`scrobble-reconnect-${service}`);
        }
        reconnectNotified.current[service] = needsReconnect;
      }
    };
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen<ScrobbleStatus>("muro://scrobble-status", (event) => {
      if (event.payload) applyStatus(event.payload);
    }).then((remove) => {
      if (cancelled) remove();
      else unlisten = remove;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setStatus]);

  // Configuring also sends whatever was queued in an earlier session.
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        configureScrobbling(lastFmApiKey, lastFmSharedSecret)
          .then(setStatus)
          .catch((error) => console.error("Failed to configure scrobbling:", error));
      },
      useScrobbleStore.getState().status ? CONFIGURE_DELAY_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [lastFmApiKey, lastFmSharedSecret, setStatus]);

  useEffect(() => {
    const handleOnline = () => {
      flushScrobbles().catch((error) => console.error("Failed to send queued scrobbles:", error));
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);
};
