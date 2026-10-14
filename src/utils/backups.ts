import { emitLocal } from "@muro/desktop/events";
import { invoke } from "@muro/desktop/runtime";
import { bridge, type BackupFrequency, type BackupStatus } from "../desktop/bridge";
import { t } from "../i18n";
import type { LibraryBackupResult } from "./database";

export type { BackupFrequency, BackupStatus };

/**
 * Settings and Smart Crates live in renderer storage, so every backup, manual
 * or automatic, reads them here. The main process strips API keys and
 * machine-specific paths before anything is written.
 */
export type BackupState = { settingsJson: string; smartCratesJson: string };

export const readBackupState = (): BackupState => ({
  settingsJson: window.localStorage.getItem("muro-settings") ?? "",
  smartCratesJson: window.localStorage.getItem("muro-smart-crates") ?? "",
});

const SAFETY_BACKUP_FAILED = "SAFETY_BACKUP_FAILED:";

/** Raised when risky maintenance was refused because its safety backup failed. */
export class SafetyBackupError extends Error {}

export const isSafetyBackupError = (error: unknown): error is SafetyBackupError =>
  error instanceof SafetyBackupError;

/**
 * Run a command that the main process protects with a safety backup, passing
 * the renderer-held state the backup needs and translating its failure.
 */
export const withSafetyBackup = <T>(run: (backupState: BackupState) => Promise<T>): Promise<T> =>
  run(readBackupState()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const index = message.indexOf(SAFETY_BACKUP_FAILED);
    if (index === -1) throw error;
    const reason = message.slice(index + SAFETY_BACKUP_FAILED.length).trim();
    throw Object.assign(new SafetyBackupError(t("backup.safety.failed", { reason })), {
      cause: error,
    });
  });

export type ScheduledBackupResult = {
  created: boolean;
  backup: (LibraryBackupResult & { fileName: string }) | null;
  pruned: string[];
  status: BackupStatus;
};

/** Renderer-local event: a scheduled backup was written and the status changed. */
export const BACKUP_STATUS_EVENT = "muro://backup-status";

export const emitBackupStatus = (status: BackupStatus) => emitLocal(BACKUP_STATUS_EVENT, status);

export const getBackupStatus = () => invoke<BackupStatus>("get_backup_status");

export const setBackupSchedule = (schedule: { frequency?: BackupFrequency; retention?: number }) =>
  invoke<BackupStatus>("set_backup_schedule", schedule);

/** Writes an automatic backup if one is due, or always with `force`. */
export const runScheduledBackup = (force = false) =>
  invoke<ScheduledBackupResult>("run_scheduled_backup", { ...readBackupState(), force });

export const chooseBackupFolder = (): Promise<BackupStatus | null> => bridge().chooseBackupFolder();

export const resetBackupFolder = (): Promise<BackupStatus> => bridge().resetBackupFolder();

export const openBackupFolder = (): Promise<void> => bridge().openBackupFolder();
