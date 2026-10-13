import { invoke } from "@muro/desktop/runtime";
import { t } from "../i18n";
import { notify, useNotificationStore } from "../stores/notificationStore";

export type TagWriteError = {
  trackId: string;
  fileName: string;
  message: string;
  reason?: "readOnly" | "locked" | "missing" | "unknown";
};

/** Result of `update_track_metadata`: the library is always updated first. */
export type MetadataWriteResult = {
  updated: number;
  filesWritten: number;
  fileWriteErrors: TagWriteError[];
};

type PendingTagWrite = Omit<TagWriteError, "trackId"> & {
  updates: Record<string, unknown>;
};

const TOAST_KEY = "tag-write-failures";

// Fields that are saved in the library but not yet in the audio file, keyed by
// track. Later edits merge over earlier ones, so a retry never writes back a
// value the user has since replaced, and a successful write clears only the
// fields it actually wrote.
const pending = new Map<string, PendingTagWrite>();
let retrying = false;

/**
 * Record the outcome of a metadata write. Returns the number of files whose
 * tags could not be written; call `showTagWriteFailures` to tell the user.
 */
export const recordMetadataWrite = (
  trackIds: string[],
  updates: Record<string, unknown>,
  result: MetadataWriteResult | undefined,
) => {
  const failures = new Map(
    (result?.fileWriteErrors ?? []).map((failure) => [String(failure.trackId), failure]),
  );
  for (const trackId of trackIds) {
    const failure = failures.get(trackId);
    const existing = pending.get(trackId);
    if (failure) {
      pending.set(trackId, {
        fileName: failure.fileName,
        message: failure.message,
        reason: failure.reason,
        updates: { ...existing?.updates, ...updates },
      });
    } else if (existing) {
      const remaining = { ...existing.updates };
      for (const key of Object.keys(updates)) delete remaining[key];
      if (Object.keys(remaining).length === 0) pending.delete(trackId);
      else pending.set(trackId, { ...existing, updates: remaining });
    }
  }
  return failures.size;
};

const failureReason = (entry: PendingTagWrite) => {
  switch (entry.reason) {
    case "readOnly":
      return t("toast.tagWrite.reason.readOnly");
    case "locked":
      return t("toast.tagWrite.reason.locked");
    case "missing":
      return t("toast.tagWrite.reason.missing");
    default:
      return entry.message;
  }
};

/**
 * Show one persistent toast listing every file whose tags are behind the
 * library, with a retry. Repeated failures update the same toast.
 */
export const showTagWriteFailures = () => {
  // A running retry reports its own outcome when it finishes.
  if (retrying) return;
  const store = useNotificationStore.getState();
  if (pending.size === 0) {
    const shown = store.notifications.find((notification) => notification.id === TOAST_KEY);
    if (shown?.type === "error") store.removeNotification(TOAST_KEY);
    return;
  }
  const entries = [...pending.values()];
  notify.error(
    entries.length === 1
      ? t("toast.tagWrite.failedOne", { file: entries[0].fileName })
      : t("toast.tagWrite.failedMany", { count: String(entries.length) }),
    {
      key: TOAST_KEY,
      sticky: true,
      details: entries.map((entry) => `${entry.fileName}: ${failureReason(entry)}`),
      action: { label: t("toast.tagWrite.retry"), onClick: () => void retryTagWrites() },
      // The library already holds the edits and the backend keeps each
      // track's last write error, so dismissing only forgets the retry.
      onDismiss: () => pending.clear(),
    },
  );
};

export const retryTagWrites = async () => {
  if (retrying || pending.size === 0) return;
  retrying = true;
  const attempted = pending.size;
  notify.info(t("toast.tagWrite.retrying", { count: String(attempted) }), {
    key: TOAST_KEY,
    sticky: true,
  });

  // Bulk edits fail with identical updates, so retry them in one call.
  const groups = new Map<string, { trackIds: string[]; updates: Record<string, unknown> }>();
  for (const [trackId, entry] of pending) {
    const groupKey = JSON.stringify(entry.updates);
    const group = groups.get(groupKey);
    if (group) group.trackIds.push(trackId);
    else groups.set(groupKey, { trackIds: [trackId], updates: entry.updates });
  }

  try {
    for (const group of groups.values()) {
      try {
        const result = await invoke<MetadataWriteResult>("update_track_metadata", group);
        recordMetadataWrite(group.trackIds, group.updates, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const trackId of group.trackIds) {
          const entry = pending.get(trackId);
          if (entry) pending.set(trackId, { ...entry, message, reason: "unknown" });
        }
      }
    }
  } finally {
    retrying = false;
  }

  if (pending.size === 0) {
    notify.success(t("toast.tagWrite.retrySucceeded", { count: String(attempted) }), {
      key: TOAST_KEY,
    });
  } else {
    showTagWriteFailures();
  }
};
