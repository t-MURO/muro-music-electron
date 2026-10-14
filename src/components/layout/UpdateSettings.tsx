import { useState } from "react";
import { t } from "../../i18n";
import { startUpdateDownload } from "../../hooks/useUpdateCheck";
import { notify, useSettingsStore, useUpdateStore } from "../../stores";
import {
  CHECK_ERROR_MESSAGES,
  DOWNLOAD_ERROR_MESSAGES,
  cancelUpdateDownload,
  checkForUpdates,
  downloadPercent,
  formatMegabytes,
  openUpdateInstaller,
  openUpdateReleasePage,
  showUpdateInstaller,
  type UpdateStatus,
} from "../../utils/updates";

const primaryButtonClass =
  "flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-white transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClass =
  "flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60";

const helpTextClass =
  "max-w-2xl text-[var(--font-size-xs)] leading-relaxed text-[var(--color-text-secondary)]";

const statusText = (status: UpdateStatus | null) => {
  if (!status) return t("common.loading");
  if (status.checking) return t("update.status.checking");
  if (status.error) {
    return t("update.status.error", { reason: t(CHECK_ERROR_MESSAGES[status.error]) });
  }
  if (status.updateAvailable && status.latest) {
    return t("update.available", { version: status.latest.version });
  }
  return status.lastCheckedAt ? t("update.status.upToDate") : t("update.status.never");
};

/**
 * Current version, automatic checks, and the update the last check found.
 * Downloading saves the installer to the Downloads folder; installing it is
 * always left to the user.
 */
export const UpdateSettings = () => {
  const status = useUpdateStore((s) => s.status);
  const setStatus = useUpdateStore((s) => s.setStatus);
  const checkAutomatically = useSettingsStore((s) => s.checkForUpdates);
  const setCheckAutomatically = useSettingsStore((s) => s.setCheckForUpdates);
  const skippedVersion = useSettingsStore((s) => s.skippedUpdateVersion);
  const setSkippedVersion = useSettingsStore((s) => s.setSkippedUpdateVersion);
  const [checking, setChecking] = useState(false);

  const run = (operation: () => Promise<unknown>) => {
    void operation().catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      notify.error(t("update.actionFailed", { reason }));
    });
  };

  const handleCheckNow = async () => {
    if (checking) return;
    setChecking(true);
    try {
      setStatus(await checkForUpdates(true));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notify.error(t("update.actionFailed", { reason }));
    } finally {
      setChecking(false);
    }
  };

  const latest = status?.updateAvailable ? status.latest : null;
  const download =
    status && latest && status.download.version === latest.version ? status.download : null;
  const downloading = download?.state === "downloading";
  const directDownload = Boolean(latest?.hasInstaller) && download?.state !== "failed";
  const percent = download ? downloadPercent(download) : null;
  const skipped = Boolean(latest && latest.version === skippedVersion);
  const idleError =
    status?.download.state === "idle" && status.download.error
      ? t(DOWNLOAD_ERROR_MESSAGES[status.download.error])
      : null;

  return (
    <div className="space-y-5" data-update-settings>
      <div>
        <p className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
          {t("update.currentVersion", { version: status?.currentVersion ?? "…" })}
        </p>
        <p className={`mt-1 ${helpTextClass}`} data-update-status>
          {statusText(status)}
        </p>
        {status?.lastCheckedAt && !status.checking && (
          <p className="mt-1 text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("update.lastChecked", { time: new Date(status.lastCheckedAt).toLocaleString() })}
          </p>
        )}
        <div className="mt-3">
          <button
            className={secondaryButtonClass}
            data-update-check-now
            disabled={checking || Boolean(status?.checking)}
            onClick={() => void handleCheckNow()}
            type="button"
          >
            {checking || status?.checking ? t("update.status.checking") : t("update.checkNow")}
          </button>
        </div>
      </div>

      {latest && (
        <div
          className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] p-4"
          data-update-available
        >
          <p className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
            {t("update.available", { version: latest.version })}
          </p>
          {skipped && <p className={`mt-1 ${helpTextClass}`}>{t("update.skipped")}</p>}
          {!latest.hasInstaller && (
            <p className={`mt-1 ${helpTextClass}`}>{t("update.noInstaller")}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={primaryButtonClass}
              data-update-download
              disabled={downloading}
              onClick={() => status && startUpdateDownload(status)}
              type="button"
            >
              {directDownload ? t("update.download") : t("update.downloadOnGitHub")}
            </button>
            <button
              className={secondaryButtonClass}
              onClick={() => run(openUpdateReleasePage)}
              type="button"
            >
              {t("update.releaseNotes")}
            </button>
            {skipped ? (
              <button
                className={secondaryButtonClass}
                onClick={() => setSkippedVersion("")}
                type="button"
              >
                {t("update.unskip")}
              </button>
            ) : (
              <button
                className={secondaryButtonClass}
                onClick={() => setSkippedVersion(latest.version)}
                type="button"
              >
                {t("update.skip")}
              </button>
            )}
          </div>

          {downloading && download && (
            <div className="mt-4" data-update-download-progress>
              <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
                <div
                  className="h-full bg-[var(--color-accent)] transition-[width]"
                  style={{ width: `${percent ?? 0}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-[var(--font-size-xs)] tabular-nums text-[var(--color-text-secondary)]">
                  {download.totalBytes > 0
                    ? t("update.download.progressDetail", {
                        received: formatMegabytes(download.receivedBytes),
                        total: formatMegabytes(download.totalBytes),
                      })
                    : t("update.download.progressUnknown", { version: latest.version })}
                </span>
                <button
                  className={secondaryButtonClass}
                  onClick={() => run(cancelUpdateDownload)}
                  type="button"
                >
                  {t("update.download.cancel")}
                </button>
              </div>
            </div>
          )}
          {download?.state === "completed" && (
            <div className="mt-4">
              <p className={helpTextClass}>
                {t("update.download.done", { name: download.fileName ?? "" })}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className={primaryButtonClass}
                  onClick={() => run(openUpdateInstaller)}
                  type="button"
                >
                  {t("update.download.openInstaller")}
                </button>
                <button
                  className={secondaryButtonClass}
                  onClick={() => run(showUpdateInstaller)}
                  type="button"
                >
                  {t("update.download.showInFolder")}
                </button>
              </div>
            </div>
          )}
          {download?.state === "failed" && (
            <p className="mt-3 max-w-2xl text-[var(--font-size-xs)] leading-relaxed text-red-500">
              {t("update.download.failed", {
                reason: t(DOWNLOAD_ERROR_MESSAGES[download.error ?? "network"]),
              })}
            </p>
          )}
          {idleError && (
            <p className="mt-3 max-w-2xl text-[var(--font-size-xs)] leading-relaxed text-red-500">
              {idleError}
            </p>
          )}
        </div>
      )}

      <label className="flex items-start gap-3">
        <input
          checked={checkAutomatically}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          data-update-auto-check
          onChange={(event) => setCheckAutomatically(event.target.checked)}
          type="checkbox"
        />
        <span className="min-w-0">
          <span className="block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
            {t("update.automatic")}
          </span>
          <span className="mt-1 block text-[var(--font-size-xs)] leading-relaxed text-[var(--color-text-secondary)]">
            {status && !status.automaticChecks
              ? t("update.automatic.development")
              : t("update.automatic.description")}
          </span>
        </span>
      </label>
    </div>
  );
};
