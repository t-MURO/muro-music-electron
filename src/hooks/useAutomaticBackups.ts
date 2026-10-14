import { useEffect } from "react";
import { t } from "../i18n";
import { notify } from "../stores";
import { emitBackupStatus, runScheduledBackup } from "../utils/backups";

// Let startup work (library load, migrations) settle before the first check.
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Ask the main process on startup and then hourly whether an automatic backup
 * is due. The main process owns the schedule and decides; the renderer only
 * supplies the settings and Smart Crates it keeps in local storage. Success
 * stays quiet, failures are reported.
 */
export const useAutomaticBackups = () => {
  useEffect(() => {
    let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const result = await runScheduledBackup();
        if (result.created) emitBackupStatus(result.status);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        notify.error(t("backup.auto.failed", { reason }), { key: "automatic-backup-failed" });
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
  }, []);
};
