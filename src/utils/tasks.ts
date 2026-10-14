import { t } from "../i18n";
import type { NotificationAction } from "../stores/notificationStore";
import { useTaskStore } from "../stores/taskStore";

export const openTaskCenter = () => useTaskStore.getState().openPanel();

/** Toast action that opens the task center, for failures whose details live there. */
export const taskDetailsAction = (): NotificationAction => ({
  label: t("tasks.details"),
  onClick: openTaskCenter,
});

/** The file name of a path, for compact per-item error lines. */
export const taskItemName = (filePath: string) =>
  filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;

export const taskErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
