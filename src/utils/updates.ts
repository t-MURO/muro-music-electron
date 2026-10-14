import {
  bridge,
  type UpdateCheckError,
  type UpdateDownloadError,
  type UpdateStatus,
} from "../desktop/bridge";
import type { MessageKey } from "../i18n";

export type { UpdateCheckError, UpdateDownloadError, UpdateStatus };

/** Sent by the main process whenever the check or download status changes. */
export const UPDATE_STATUS_EVENT = "muro://update-status";

export const CHECK_ERROR_MESSAGES: Record<UpdateCheckError, MessageKey> = {
  network: "update.error.network",
  timeout: "update.error.timeout",
  "rate-limited": "update.error.rateLimited",
  http: "update.error.http",
  "invalid-response": "update.error.invalidResponse",
};

export const DOWNLOAD_ERROR_MESSAGES: Record<UpdateDownloadError, MessageKey> = {
  "not-available": "update.download.error.notAvailable",
  network: "update.error.network",
  timeout: "update.download.error.timeout",
  http: "update.error.http",
  "size-mismatch": "update.download.error.sizeMismatch",
  "digest-mismatch": "update.download.error.digestMismatch",
  "write-failed": "update.download.error.writeFailed",
  "invalid-response": "update.error.invalidResponse",
  "missing-file": "update.download.error.missingFile",
};

export const getUpdateStatus = (): Promise<UpdateStatus> => bridge().getUpdateStatus();

export const checkForUpdates = (manual: boolean): Promise<UpdateStatus> =>
  bridge().checkForUpdates({ manual });

/** Downloads the installer of the release the main process found, or opens its page. */
export const downloadUpdate = (version: string): Promise<UpdateStatus> =>
  bridge().downloadUpdate(version);

export const cancelUpdateDownload = (): Promise<UpdateStatus> => bridge().cancelUpdateDownload();

export const openUpdateInstaller = (): Promise<void> => bridge().openUpdateInstaller();

export const showUpdateInstaller = (): Promise<void> => bridge().showUpdateInstaller();

export const openUpdateReleasePage = (): Promise<void> => bridge().openUpdateReleasePage();

/** Whole-percent progress of the download, or null while the size is unknown. */
export const downloadPercent = (download: UpdateStatus["download"]): number | null =>
  download.totalBytes > 0
    ? Math.min(100, Math.floor((download.receivedBytes / download.totalBytes) * 100))
    : null;

export const formatMegabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
