import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Eye, EyeOff } from "lucide-react";
import { getLocale, t, type MessageKey } from "../../i18n";
import { openExternal } from "../../desktop/shell";
import { SCROBBLE_SERVICE_LABELS } from "../../hooks/useScrobbling";
import { notify, useScrobbleStore, useSettingsStore } from "../../stores";
import {
  beginLastFmAuth,
  cancelLastFmAuth,
  completeLastFmAuth,
  configureScrobbling,
  connectListenBrainz,
  disconnectScrobbleService,
  flushScrobbles,
  getScrobbleStatus,
  setScrobbleServiceEnabled,
  type ScrobbleActionError,
  type ScrobbleActionResult,
  type ScrobbleServiceId,
  type ScrobbleServiceStatus,
} from "../../utils/scrobblingApi";

const inputClass =
  "h-[var(--input-height)] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]";

const primaryButtonClass =
  "flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-white transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClass =
  "flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60";

const linkButtonClass =
  "inline-flex items-center gap-1.5 text-[var(--font-size-xs)] font-medium text-[var(--color-accent)] hover:underline";

const helpTextClass =
  "max-w-2xl text-[var(--font-size-xs)] leading-relaxed text-[var(--color-text-secondary)]";

const warningTextClass =
  "max-w-2xl text-[var(--font-size-xs)] leading-relaxed text-amber-600 dark:text-amber-400";

const ERROR_MESSAGES: Record<ScrobbleActionError, MessageKey> = {
  "missing-api-credentials": "scrobble.error.missingApiCredentials",
  "browser-unavailable": "scrobble.error.browserUnavailable",
  network: "scrobble.error.network",
  "request-failed": "scrobble.error.requestFailed",
  "not-authorized": "scrobble.error.notAuthorized",
  "token-expired": "scrobble.error.tokenExpired",
  "missing-token": "scrobble.error.missingToken",
  "invalid-token": "scrobble.error.invalidToken",
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const pendingLabel = (pending: number) =>
  pending === 0
    ? t("scrobble.pending.none")
    : pending === 1
      ? t("scrobble.pending.one")
      : t("scrobble.pending.many", { count: String(pending) });

const SecretInput = ({
  id,
  value,
  onChange,
  placeholder,
  dataKey,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  dataKey: string;
}) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative max-w-md">
      <input
        {...{ [`data-${dataKey}`]: "" }}
        autoComplete="off"
        className={`${inputClass} pr-20`}
        id={id}
        onChange={(event) => onChange(event.target.value.trim())}
        placeholder={placeholder}
        spellCheck={false}
        type={visible ? "text" : "password"}
        value={value}
      />
      <button
        className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        {visible ? t("scrobble.hide") : t("scrobble.show")}
      </button>
    </div>
  );
};

type ServiceCardProps = {
  service: ScrobbleServiceId;
  status: ScrobbleServiceStatus | undefined;
  description: string;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onDisconnect: () => void;
  onRetry: () => void;
  /** Connect controls, shown while not connected or when a reconnect is needed. */
  children: ReactNode;
};

const ServiceCard = ({
  service,
  status,
  description,
  busy,
  onToggle,
  onDisconnect,
  onRetry,
  children,
}: ServiceCardProps) => {
  const label = SCROBBLE_SERVICE_LABELS[service];
  const connected = Boolean(status?.connected);
  const needsReconnect = Boolean(status?.needsReconnect);
  const badge = needsReconnect
    ? {
        text: t("scrobble.status.reconnect"),
        className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      }
    : connected
      ? {
          text: status?.userName
            ? t("scrobble.status.connected", { user: status.userName })
            : t("scrobble.status.connectedNoName"),
          className: "bg-emerald-500/10 text-emerald-500",
        }
      : {
          text: t("scrobble.status.disconnected"),
          className: "bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]",
        };
  const pending = status?.pending ?? 0;

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]"
      data-scrobble-service={service}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
            {label}
          </span>
          <span className="mt-0.5 block text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {description}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
          data-scrobble-connection
        >
          {badge.text}
        </span>
      </div>
      <div className="space-y-3 border-t border-[var(--color-border-light)] px-4 py-4">
        <label className="flex items-center gap-3">
          <input
            checked={Boolean(status?.enabled)}
            className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            data-scrobble-enabled
            disabled={!connected && !needsReconnect}
            onChange={(event) => onToggle(event.target.checked)}
            type="checkbox"
          />
          <span className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
            {t("scrobble.enable", { service: label })}
          </span>
        </label>

        {needsReconnect && (
          <p className={warningTextClass}>
            {t("scrobble.reconnect.description", { service: label })}
            {status?.reconnectReason ? ` (${status.reconnectReason})` : ""}
          </p>
        )}

        {(!connected || needsReconnect) && children}

        {(connected || status?.userName) && (
          <button
            className={secondaryButtonClass}
            data-scrobble-disconnect
            disabled={busy}
            onClick={onDisconnect}
            type="button"
          >
            {t("scrobble.disconnect")}
          </button>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border-light)] pt-3">
          <span
            className="text-[var(--font-size-xs)] tabular-nums text-[var(--color-text-secondary)]"
            data-scrobble-pending={pending}
          >
            {pendingLabel(pending)}
            {status?.retryAt
              ? ` · ${t("scrobble.retryAt", {
                  time: new Date(status.retryAt).toLocaleTimeString(getLocale()),
                })}`
              : ""}
          </span>
          {pending > 0 && (
            <button
              className={secondaryButtonClass}
              data-scrobble-retry
              disabled={busy || !connected || needsReconnect}
              onClick={onRetry}
              type="button"
            >
              {t("scrobble.retryNow")}
            </button>
          )}
        </div>
        {status?.lastError && pending > 0 && (
          <p className={warningTextClass}>
            {t("scrobble.lastError", { message: status.lastError })}
          </p>
        )}
        {status?.lastDropped && status.dropped > 0 && (
          <p className={helpTextClass}>
            {t("scrobble.dropped", {
              count: String(status.dropped),
              track: `${status.lastDropped.artist} – ${status.lastDropped.title}`,
              reason: status.lastDropped.reason,
            })}
          </p>
        )}
      </div>
    </div>
  );
};

/** Last.fm and ListenBrainz accounts, shown with the other online services. */
export const ScrobblingSettings = () => {
  const status = useScrobbleStore((s) => s.status);
  const setStatus = useScrobbleStore((s) => s.setStatus);
  const lastFmApiKey = useSettingsStore((s) => s.lastFmApiKey);
  const lastFmSharedSecret = useSettingsStore((s) => s.lastFmSharedSecret);
  const setLastFmSharedSecret = useSettingsStore((s) => s.setLastFmSharedSecret);
  const [busy, setBusy] = useState<ScrobbleServiceId | null>(null);
  const [listenBrainzToken, setListenBrainzToken] = useState("");

  // Queue counts change in the background; refresh them when the page opens.
  useEffect(() => {
    getScrobbleStatus()
      .then(setStatus)
      .catch((error) => console.error("Failed to load scrobbling status:", error));
  }, [setStatus]);

  const run = async (service: ScrobbleServiceId, action: () => Promise<void>) => {
    setBusy(service);
    try {
      await action();
    } catch (error) {
      notify.error(
        t("scrobble.error.requestFailed", {
          service: SCROBBLE_SERVICE_LABELS[service],
          message: errorMessage(error),
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  /** Applies the returned status and reports a failed connect step. */
  const handleResult = (service: ScrobbleServiceId, result: ScrobbleActionResult) => {
    setStatus(result.status);
    if (result.ok) return true;
    notify.error(
      t(ERROR_MESSAGES[result.error] ?? "scrobble.error.requestFailed", {
        service: SCROBBLE_SERVICE_LABELS[service],
        message: result.message ?? result.error,
      }),
      { key: `scrobble-error-${service}` },
    );
    return false;
  };

  const notifyConnected = (service: ScrobbleServiceId, result: ScrobbleActionResult) => {
    const userName = result.status[service].userName;
    notify.success(
      userName
        ? t("scrobble.toast.connected", {
            service: SCROBBLE_SERVICE_LABELS[service],
            user: userName,
          })
        : t("scrobble.status.connectedNoName"),
    );
  };

  const toggle = (service: ScrobbleServiceId, enabled: boolean) =>
    run(service, async () => setStatus(await setScrobbleServiceEnabled(service, enabled)));

  const disconnect = (service: ScrobbleServiceId) =>
    run(service, async () => {
      setStatus(await disconnectScrobbleService(service));
      notify.info(t("scrobble.toast.disconnected", { service: SCROBBLE_SERVICE_LABELS[service] }));
    });

  const retry = (service: ScrobbleServiceId) =>
    run(service, async () => {
      const next = await flushScrobbles(true);
      setStatus(next);
      const serviceStatus = next[service];
      if (serviceStatus.pending > 0 && serviceStatus.lastError) {
        notify.error(t("scrobble.toast.retryFailed"), {
          key: `scrobble-retry-${service}`,
          details: [serviceStatus.lastError],
        });
      }
    });

  const startLastFm = () =>
    run("lastfm", async () => {
      // The settings sync is debounced; make sure the main process has the
      // key and secret the user just typed.
      await configureScrobbling(lastFmApiKey, lastFmSharedSecret);
      handleResult("lastfm", await beginLastFmAuth());
    });

  const finishLastFm = () =>
    run("lastfm", async () => {
      const result = await completeLastFmAuth();
      if (handleResult("lastfm", result)) notifyConnected("lastfm", result);
    });

  const cancelLastFm = () => run("lastfm", async () => setStatus(await cancelLastFmAuth()));

  const connectListenBrainzAccount = () =>
    run("listenbrainz", async () => {
      const result = await connectListenBrainz(listenBrainzToken);
      if (handleResult("listenbrainz", result)) {
        setListenBrainzToken("");
        notifyConnected("listenbrainz", result);
      }
    });

  const lastFm = status?.lastfm;
  const listenBrainz = status?.listenbrainz;
  const lastFmReady = Boolean(lastFmApiKey && lastFmSharedSecret);

  return (
    <div className="space-y-3" data-scrobbling-settings>
      <p className={helpTextClass}>{t("scrobble.rules")}</p>
      {status?.credentialStorage === "session" && (
        <p className={warningTextClass} data-scrobble-session-storage>
          {t("scrobble.storage.session")}
        </p>
      )}

      <ServiceCard
        busy={busy === "lastfm"}
        description={t("scrobble.lastfm.description")}
        onDisconnect={() => void disconnect("lastfm")}
        onRetry={() => void retry("lastfm")}
        onToggle={(enabled) => void toggle("lastfm", enabled)}
        service="lastfm"
        status={lastFm}
      >
        <div className="space-y-3">
          <label
            className="block text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]"
            htmlFor="lastfm-shared-secret"
          >
            {t("scrobble.lastfm.sharedSecret")}
          </label>
          <SecretInput
            dataKey="lastfm-shared-secret"
            id="lastfm-shared-secret"
            onChange={setLastFmSharedSecret}
            placeholder={t("scrobble.lastfm.sharedSecret.placeholder")}
            value={lastFmSharedSecret}
          />
          {!lastFmApiKey && (
            <p className={warningTextClass}>{t("scrobble.lastfm.apiKeyMissing")}</p>
          )}
          <button
            className={linkButtonClass}
            onClick={() => {
              void openExternal("https://www.last.fm/api/accounts");
            }}
            type="button"
          >
            {t("scrobble.lastfm.getSecret")} <ExternalLink className="h-3 w-3" />
          </button>
          {lastFm?.awaitingAuthorization ? (
            <div className="space-y-3">
              <p className={helpTextClass}>{t("scrobble.lastfm.awaiting")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={primaryButtonClass}
                  data-lastfm-finish-connect
                  disabled={busy === "lastfm"}
                  onClick={() => void finishLastFm()}
                  type="button"
                >
                  {busy === "lastfm" ? t("scrobble.connecting") : t("scrobble.lastfm.finish")}
                </button>
                <button
                  className={secondaryButtonClass}
                  disabled={busy === "lastfm"}
                  onClick={() => void cancelLastFm()}
                  type="button"
                >
                  {t("scrobble.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              className={primaryButtonClass}
              data-lastfm-connect
              disabled={!lastFmReady || busy === "lastfm"}
              onClick={() => void startLastFm()}
              type="button"
            >
              {busy === "lastfm"
                ? t("scrobble.connecting")
                : lastFm?.needsReconnect
                  ? t("scrobble.reconnect")
                  : t("scrobble.connect")}
            </button>
          )}
        </div>
      </ServiceCard>

      <ServiceCard
        busy={busy === "listenbrainz"}
        description={t("scrobble.listenbrainz.description")}
        onDisconnect={() => void disconnect("listenbrainz")}
        onRetry={() => void retry("listenbrainz")}
        onToggle={(enabled) => void toggle("listenbrainz", enabled)}
        service="listenbrainz"
        status={listenBrainz}
      >
        <div className="space-y-3">
          <label
            className="block text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]"
            htmlFor="listenbrainz-token"
          >
            {t("scrobble.listenbrainz.token")}
          </label>
          <SecretInput
            dataKey="listenbrainz-token"
            id="listenbrainz-token"
            onChange={setListenBrainzToken}
            placeholder={t("scrobble.listenbrainz.token.placeholder")}
            value={listenBrainzToken}
          />
          <button
            className={linkButtonClass}
            onClick={() => {
              void openExternal("https://listenbrainz.org/settings/");
            }}
            type="button"
          >
            {t("scrobble.listenbrainz.getToken")} <ExternalLink className="h-3 w-3" />
          </button>
          <button
            className={primaryButtonClass}
            data-listenbrainz-connect
            disabled={!listenBrainzToken || busy === "listenbrainz"}
            onClick={() => void connectListenBrainzAccount()}
            type="button"
          >
            {busy === "listenbrainz"
              ? t("scrobble.connecting")
              : listenBrainz?.needsReconnect
                ? t("scrobble.reconnect")
                : t("scrobble.connect")}
          </button>
        </div>
      </ServiceCard>
    </div>
  );
};
