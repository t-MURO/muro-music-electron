import { useEffect, useState } from "react";
import { listen } from "@muro/desktop/events";
import { t, type MessageKey } from "../../i18n";
import { notify } from "../../stores";
import {
  BACKUP_STATUS_EVENT,
  backUpNow,
  chooseBackupFolder,
  getBackupStatus,
  openBackupFolder,
  resetBackupFolder,
  setBackupSchedule,
  type BackupFrequency,
  type BackupStatus,
} from "../../utils/backups";

const FREQUENCY_LABELS: Record<BackupFrequency, MessageKey> = {
  off: "backup.auto.frequency.off",
  daily: "backup.auto.frequency.daily",
  weekly: "backup.auto.frequency.weekly",
};
const RETENTION_OPTIONS = [1, 2, 3, 5, 10, 20, 30, 50];

const buttonClass =
  "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50";
const selectClass =
  "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] disabled:opacity-50";
const labelClass = "flex flex-col gap-1 text-[11px] font-medium text-[var(--color-text-secondary)]";

/**
 * Schedule, retention and folder of automatic backups. The main process owns
 * all three and decides when a backup is due; this only displays and edits.
 */
export const AutomaticBackupSettings = () => {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    getBackupStatus()
      .then((current) => {
        if (active && current) setStatus(current);
      })
      .catch(() => undefined);
    // Scheduled runs happen elsewhere; refresh "last backup" when one lands.
    void listen<BackupStatus>(BACKUP_STATUS_EVENT, (event) => setStatus(event.payload))
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const run = async (operation: () => Promise<BackupStatus | null | void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await operation();
      if (next) setStatus(next);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setMessage(reason);
      notify.error(reason);
    } finally {
      setBusy(false);
    }
  };

  const handleBackUpNow = () =>
    run(async () => {
      const result = await backUpNow();
      if (result.backup) setMessage(t("backup.auto.created", { name: result.backup.fileName }));
      return result.status;
    });

  const retentionOptions =
    status && !RETENTION_OPTIONS.includes(status.retention)
      ? [...RETENTION_OPTIONS, status.retention].sort((left, right) => left - right)
      : RETENTION_OPTIONS;

  return (
    <div className="mt-4 border-t border-[var(--color-border-light)] pt-4" data-automatic-backups>
      <h5 className="text-[12px] font-semibold text-[var(--color-text-primary)]">
        {t("backup.auto.title")}
      </h5>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
        {t("backup.auto.description")}{" "}
        {t("backup.auto.safetyNote", {
          count: String(status?.preMaintenanceRetention ?? 3),
        })}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <label className={labelClass}>
          {t("backup.auto.frequency")}
          <select
            className={selectClass}
            disabled={busy || !status}
            value={status?.frequency ?? "weekly"}
            onChange={(event) =>
              run(() => setBackupSchedule({ frequency: event.target.value as BackupFrequency }))
            }
            data-backup-frequency
          >
            {(Object.keys(FREQUENCY_LABELS) as BackupFrequency[]).map((frequency) => (
              <option key={frequency} value={frequency}>
                {t(FREQUENCY_LABELS[frequency])}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {t("backup.auto.retention")}
          <select
            className={selectClass}
            disabled={busy || !status}
            value={status?.retention ?? 5}
            onChange={(event) =>
              run(() => setBackupSchedule({ retention: Number(event.target.value) }))
            }
            data-backup-retention
          >
            {retentionOptions.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]" data-last-automatic-backup>
        {status?.lastAutomaticBackupAt
          ? t("backup.auto.last", {
              time: new Date(status.lastAutomaticBackupAt).toLocaleString(),
            })
          : t("backup.auto.never")}
      </p>
      {status && (
        <p className="mt-1 break-all text-[11px] text-[var(--color-text-muted)]">
          {t("backup.auto.folder", { path: status.folder })}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={primaryButtonClass}
          disabled={busy || !status}
          onClick={handleBackUpNow}
          type="button"
          data-backup-now
        >
          {busy ? t("backup.auto.working") : t("backup.auto.backUpNow")}
        </button>
        <button
          className={buttonClass}
          disabled={busy || !status}
          onClick={() => run(openBackupFolder)}
          type="button"
        >
          {t("backup.auto.openFolder")}
        </button>
        <button
          className={buttonClass}
          disabled={busy || !status}
          onClick={() => run(chooseBackupFolder)}
          type="button"
        >
          {t("backup.auto.chooseFolder")}
        </button>
        {status && !status.isDefaultFolder && (
          <button
            className={buttonClass}
            disabled={busy}
            onClick={() => run(resetBackupFolder)}
            type="button"
          >
            {t("backup.auto.resetFolder")}
          </button>
        )}
      </div>
      {message && <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">{message}</p>}
    </div>
  );
};
