import { create } from "zustand";

/**
 * Background task center: one record per long-running job (import, analysis,
 * export, backups, …) so progress, cancellation, retries and per-item errors
 * live in one place instead of each job's own modal or toast.
 *
 * This module has no app imports so the store logic can be tested in plain
 * Node; callers translate titles and messages before handing them over.
 */

export type TaskKind =
  | "import"
  | "analysis"
  | "loudness"
  | "metadata"
  | "export"
  | "organize"
  | "tags"
  | "playlist"
  | "backup"
  | "artists"
  | "update"
  | "verify";

export type TaskStatus = "running" | "succeeded" | "failed" | "cancelled";

export type TaskItemError = { item: string; message: string };

export type Task = {
  id: string;
  /** Starting a task with the same key replaces the finished one it supersedes. */
  key: string | null;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  /** Items finished so far; progress is indeterminate while `total` is null. */
  done: number;
  total: number | null;
  /** Whether progress reads as "3 of 10" items or as a percentage (e.g. bytes). */
  unit: "items" | "percent";
  /** What the task is working on right now, e.g. the current file. */
  detail: string | null;
  /** Outcome line shown once the task has finished. */
  summary: string | null;
  /** Why the whole task failed, as opposed to individual items. */
  error: string | null;
  errors: TaskItemError[];
  /** Every item error reported, including those beyond the kept list. */
  errorCount: number;
  startedAt: number;
  finishedAt: number | null;
  cancelRequested: boolean;
  /** Only set for jobs that can really stop; the panel offers Cancel when present. */
  cancel: (() => void) | null;
  /** Runs the job again (or only its failed items); offered once the task has finished. */
  retry: (() => void) | null;
};

/** Finished tasks kept in memory; running tasks are never dropped. */
export const MAX_FINISHED_TASKS = 50;
/** Per-task item errors kept for the details list. */
export const MAX_TASK_ERRORS = 200;

type TaskState = {
  tasks: Task[];
  panelOpen: boolean;
  /** Tasks that failed while the panel was closed; cleared when it opens. */
  unseenFailures: number;
};

type TaskActions = {
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  cancelTask: (id: string) => void;
  retryTask: (id: string) => void;
  dismissTask: (id: string) => void;
  clearFinished: () => void;
};

export type TaskStore = TaskState & TaskActions;

const isFinished = (task: Task) => task.status !== "running";

/** Drop the oldest finished tasks beyond the history limit. */
const boundHistory = (tasks: Task[]) => {
  let finished = 0;
  return tasks.filter((task) => !isFinished(task) || ++finished <= MAX_FINISHED_TASKS);
};

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  panelOpen: false,
  unseenFailures: 0,

  openPanel: () => set({ panelOpen: true, unseenFailures: 0 }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),

  cancelTask: (id) => {
    const task = get().tasks.find((entry) => entry.id === id);
    if (!task || task.status !== "running" || !task.cancel || task.cancelRequested) return;
    patchTask(id, { cancelRequested: true });
    task.cancel();
  },

  retryTask: (id) => {
    const task = get().tasks.find((entry) => entry.id === id);
    if (!task || !isFinished(task) || !task.retry) return;
    // The retry reports as a new task; keeping the old one would list the job twice.
    set((state) => ({ tasks: state.tasks.filter((entry) => entry.id !== id) }));
    task.retry();
  },

  dismissTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id || !isFinished(task)),
    })),

  clearFinished: () =>
    set((state) => ({ tasks: state.tasks.filter((task) => !isFinished(task)), unseenFailures: 0 })),
}));

const patchTask = (id: string, changes: Partial<Task>) =>
  useTaskStore.setState((state) => ({
    tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...changes } : task)),
  }));

const getTask = (id: string) => useTaskStore.getState().tasks.find((task) => task.id === id);

const errorText = (error: unknown) => {
  if (error === undefined || error === null) return null;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : (JSON.stringify(error) ?? null);
};

export type StartTaskOptions = {
  kind: TaskKind;
  title: string;
  key?: string;
  total?: number | null;
  unit?: "items" | "percent";
  detail?: string | null;
  /**
   * Makes the task cancellable. `true` only records the request, for loops
   * that check `task.cancelRequested` between items; a function also runs
   * when the user cancels. Leave it out for jobs that cannot stop.
   */
  cancel?: boolean | (() => void);
  retry?: () => void;
  /** For work reported after the fact, e.g. a scheduled backup. */
  startedAt?: number;
};

export type TaskHandle = {
  readonly id: string;
  /** True once the user asked the task to stop. */
  readonly cancelRequested: boolean;
  /** True once the task reached a final status. */
  readonly finished: boolean;
  progress: (done: number, total?: number | null, detail?: string | null) => void;
  setDetail: (detail: string | null) => void;
  addError: (item: string, message: string) => void;
  update: (changes: {
    title?: string;
    cancel?: (() => void) | null;
    retry?: (() => void) | null;
  }) => void;
  succeed: (summary?: string) => void;
  fail: (error?: unknown, summary?: string) => void;
  cancelled: (summary?: string) => void;
  /** Cancelled if cancel was requested, failed if any item failed, otherwise succeeded. */
  finish: (summary?: string) => void;
};

let taskSequence = 0;

export const startTask = (options: StartTaskOptions): TaskHandle => {
  const id = `task-${++taskSequence}`;
  const cancel =
    options.cancel === true
      ? () => undefined
      : typeof options.cancel === "function"
        ? options.cancel
        : null;
  const task: Task = {
    id,
    key: options.key ?? null,
    kind: options.kind,
    title: options.title,
    status: "running",
    done: 0,
    total: options.total ?? null,
    unit: options.unit ?? "items",
    detail: options.detail ?? null,
    summary: null,
    error: null,
    errors: [],
    errorCount: 0,
    startedAt: options.startedAt ?? Date.now(),
    finishedAt: null,
    cancelRequested: false,
    cancel,
    retry: options.retry ?? null,
  };
  useTaskStore.setState((state) => ({
    tasks: [
      task,
      ...state.tasks.filter((entry) => !(task.key && entry.key === task.key && isFinished(entry))),
    ],
  }));

  const running = () => getTask(id)?.status === "running";

  const settle = (status: Exclude<TaskStatus, "running">, changes: Partial<Task> = {}) => {
    if (!running()) return;
    useTaskStore.setState((state) => ({
      tasks: boundHistory(
        state.tasks.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                ...changes,
                status,
                detail: null,
                finishedAt: Date.now(),
                // Finished tasks keep only what the panel can still use.
                cancel: null,
                cancelRequested: false,
              }
            : entry,
        ),
      ),
      unseenFailures:
        status === "failed" && !state.panelOpen ? state.unseenFailures + 1 : state.unseenFailures,
    }));
  };

  return {
    id,
    get cancelRequested() {
      return getTask(id)?.cancelRequested ?? false;
    },
    get finished() {
      return !running();
    },
    progress: (done, total, detail) => {
      const current = getTask(id);
      if (!current || current.status !== "running") return;
      const nextTotal = total === undefined ? current.total : total;
      const nextDetail = detail === undefined ? current.detail : detail;
      if (current.done === done && current.total === nextTotal && current.detail === nextDetail) {
        return;
      }
      patchTask(id, { done, total: nextTotal, detail: nextDetail });
    },
    setDetail: (detail) => {
      if (running()) patchTask(id, { detail });
    },
    addError: (item, message) => {
      const current = getTask(id);
      if (!current || current.status !== "running") return;
      patchTask(id, {
        errors:
          current.errors.length < MAX_TASK_ERRORS
            ? [...current.errors, { item, message }]
            : current.errors,
        errorCount: current.errorCount + 1,
      });
    },
    update: (changes) => {
      const current = getTask(id);
      if (!current) return;
      patchTask(id, {
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.cancel !== undefined && current.status === "running"
          ? { cancel: changes.cancel }
          : {}),
        ...(changes.retry !== undefined ? { retry: changes.retry } : {}),
      });
    },
    succeed: (summary) => settle("succeeded", { summary: summary ?? null }),
    fail: (error, summary) =>
      settle("failed", { error: errorText(error), summary: summary ?? null }),
    cancelled: (summary) => settle("cancelled", { summary: summary ?? null }),
    finish: (summary) => {
      const current = getTask(id);
      if (!current || current.status !== "running") return;
      if (current.cancelRequested) settle("cancelled", { summary: summary ?? null });
      else if (current.errorCount > 0) settle("failed", { summary: summary ?? null });
      else settle("succeeded", { summary: summary ?? null });
    },
  };
};

/**
 * Run `operation` as a task. The task finishes with the operation unless the
 * operation settled it itself; a thrown error fails it (or marks it cancelled
 * when the user asked to stop) and is rethrown for the caller's own handling.
 */
export const runTask = async <T>(
  options: StartTaskOptions,
  operation: (task: TaskHandle) => Promise<T>,
): Promise<T> => {
  const task = startTask(options);
  try {
    const result = await operation(task);
    task.finish();
    return result;
  } catch (error) {
    if (task.cancelRequested) task.cancelled();
    else task.fail(error);
    throw error;
  }
};

/** Remaining time from the average pace so far, or null while it cannot be estimated. */
export const estimateRemainingMs = (task: Task, now: number) => {
  if (task.status !== "running" || task.total === null || task.done <= 0) return null;
  if (task.done >= task.total) return null;
  const elapsed = now - task.startedAt;
  // The first moments are dominated by setup and would give a wild estimate.
  if (elapsed < 3_000) return null;
  return ((task.total - task.done) * elapsed) / task.done;
};

/** Compact duration such as "45s", "2m 05s" or "1h 03m". */
export const formatTaskDuration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
};

/** Plain-text error report for the clipboard; `more` labels errors beyond the kept list. */
export const formatTaskErrors = (task: Task, more: (count: number) => string) => {
  const lines = [task.title];
  if (task.error) lines.push(task.error);
  for (const { item, message } of task.errors) lines.push(`${item}: ${message}`);
  const hidden = task.errorCount - task.errors.length;
  if (hidden > 0) lines.push(more(hidden));
  return lines.join("\n");
};
