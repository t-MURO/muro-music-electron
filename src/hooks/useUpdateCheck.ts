import { useEffect, useRef } from "react";
import { listen } from "@muro/desktop/events";
import { t } from "../i18n";
import { notify, useNotificationStore, useSettingsStore, useUpdateStore } from "../stores";
import {
  DOWNLOAD_ERROR_MESSAGES,
  UPDATE_STATUS_EVENT,
  cancelUpdateDownload,
  checkForUpdates,
  downloadPercent,
  downloadUpdate,
  getUpdateStatus,
  openUpdateInstaller,
  openUpdateReleasePage,
  showUpdateInstaller,
  type UpdateStatus,
} from "../utils/updates";

// Let startup work settle before the first request goes out.
const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AVAILABLE_TOAST = "update-available";
const DOWNLOAD_TOAST = "update-download";

const reportFailure = (error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  notify.error(t("update.actionFailed", { reason }));
};

const dismiss = (key: string) => useNotificationStore.getState().removeNotification(key);

/** Download the update, or open its release page when that is not possible. */
export const startUpdateDownload = (status: UpdateStatus) => {
  const version = status.latest?.version;
  if (!version) return;
  const failed = status.download.state === "failed" && status.download.version === version;
  void (failed ? openUpdateReleasePage() : downloadUpdate(version)).catch(reportFailure);
};

const notifyUpdateAvailable = (status: UpdateStatus) => {
  const version = status.latest?.version;
  if (!version) return;
  notify.info(t("update.available", { version }), {
    key: AVAILABLE_TOAST,
    sticky: true,
    actions: [
      {
        label: status.latest?.hasInstaller ? t("update.download") : t("update.downloadOnGitHub"),
        onClick: () => {
          dismiss(AVAILABLE_TOAST);
          startUpdateDownload(status);
        },
      },
      {
        label: t("update.releaseNotes"),
        onClick: () => void openUpdateReleasePage().catch(reportFailure),
      },
      {
        label: t("update.skip"),
        onClick: () => {
          useSettingsStore.getState().setSkippedUpdateVersion(version);
          dismiss(AVAILABLE_TOAST);
        },
      },
    ],
  });
};

/** Mirror the installer download in a toast so it can be followed from anywhere. */
const reflectDownload = (previous: UpdateStatus["download"] | null, status: UpdateStatus) => {
  const { download } = status;
  const version = download.version ?? "";
  if (download.state === "downloading") {
    const percent = downloadPercent(download);
    const previousPercent =
      previous?.state === "downloading" ? downloadPercent(previous) : Number.NaN;
    if (previous?.state === "downloading" && percent === previousPercent) return;
    notify.info(
      percent === null
        ? t("update.download.progressUnknown", { version })
        : t("update.download.progress", { version, percent: String(percent) }),
      {
        key: DOWNLOAD_TOAST,
        sticky: true,
        actions: [
          {
            label: t("update.download.cancel"),
            onClick: () => void cancelUpdateDownload().catch(reportFailure),
          },
        ],
      },
    );
    return;
  }
  if (previous?.state !== "downloading") return;
  if (download.state === "completed") {
    notify.success(t("update.download.done", { name: download.fileName ?? "" }), {
      key: DOWNLOAD_TOAST,
      sticky: true,
      actions: [
        {
          label: t("update.download.openInstaller"),
          onClick: () => {
            dismiss(DOWNLOAD_TOAST);
            void openUpdateInstaller().catch(reportFailure);
          },
        },
        {
          label: t("update.download.showInFolder"),
          onClick: () => void showUpdateInstaller().catch(reportFailure),
        },
      ],
    });
  } else if (download.state === "failed") {
    const reason = t(DOWNLOAD_ERROR_MESSAGES[download.error ?? "network"]);
    notify.error(t("update.download.failed", { reason }), {
      key: DOWNLOAD_TOAST,
      sticky: true,
      actions: [
        {
          label: t("update.downloadOnGitHub"),
          onClick: () => {
            dismiss(DOWNLOAD_TOAST);
            void openUpdateReleasePage().catch(reportFailure);
          },
        },
      ],
    });
  } else {
    // Cancelled.
    dismiss(DOWNLOAD_TOAST);
  }
};

/**
 * Keeps the update status in the store, checks GitHub shortly after startup
 * and then daily while automatic checks are on, and offers a found update in
 * a toast. Automatic checks stay quiet when they fail; the settings show why.
 * Nothing is ever installed automatically.
 */
export const useUpdateCheck = () => {
  const automatic = useSettingsStore((s) => s.checkForUpdates);
  const setStatus = useUpdateStore((s) => s.setStatus);
  const automaticChecksAvailable = useUpdateStore((s) => s.status?.automaticChecks ?? false);
  const previousDownload = useRef<UpdateStatus["download"] | null>(null);
  const notifiedVersion = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const apply = (status: UpdateStatus) => {
      if (!active) return;
      setStatus(status);
      reflectDownload(previousDownload.current, status);
      previousDownload.current = status.download;
    };
    void listen<UpdateStatus>(UPDATE_STATUS_EVENT, (event) => {
      if (event.payload) apply(event.payload);
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => undefined);
    getUpdateStatus()
      .then((status) => {
        if (status && !useUpdateStore.getState().status) apply(status);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [setStatus]);

  useEffect(() => {
    if (!automatic || !automaticChecksAvailable) return;
    let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const status = await checkForUpdates(false);
        const version = status.latest?.version;
        if (
          status.updateAvailable &&
          version &&
          version !== useSettingsStore.getState().skippedUpdateVersion &&
          version !== notifiedVersion.current &&
          status.download.version !== version
        ) {
          notifiedVersion.current = version;
          notifyUpdateAvailable(status);
        }
      } catch (error) {
        // Automatic checks are quiet; the main process has logged the failure.
        console.warn("Update check failed:", error);
      } finally {
        running = false;
      }
    };
    const firstCheck = window.setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(interval);
    };
  }, [automatic, automaticChecksAvailable]);
};
