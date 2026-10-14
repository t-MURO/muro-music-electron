import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Ban,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Copy,
  ListChecks,
  RotateCcw,
  X,
} from "lucide-react";
import { copyTextToClipboard } from "../../desktop/clipboard";
import { t } from "../../i18n";
import {
  estimateRemainingMs,
  formatTaskDuration,
  formatTaskErrors,
  useTaskStore,
  type Task,
} from "../../stores/taskStore";
import { Popover } from "../ui/Popover";

const RING_RADIUS = 6.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const fractionOf = (task: Task) =>
  task.total !== null && task.total > 0 ? Math.min(1, task.done / task.total) : null;

/** Whole-run progress of the running tasks, or null while any of them is indeterminate. */
const aggregateFraction = (running: Task[]) => {
  let done = 0;
  let total = 0;
  for (const task of running) {
    if (task.total === null || task.total <= 0) return null;
    done += Math.min(task.done, task.total);
    total += task.total;
  }
  return total > 0 ? done / total : null;
};

const ProgressRing = ({ fraction }: { fraction: number | null }) => (
  <svg
    viewBox="0 0 16 16"
    className={`h-4 w-4 -rotate-90 ${fraction === null ? "motion-safe:animate-spin" : ""}`}
    aria-hidden="true"
  >
    <circle
      cx="8"
      cy="8"
      r={RING_RADIUS}
      fill="none"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth="2"
    />
    <circle
      cx="8"
      cy="8"
      r={RING_RADIUS}
      fill="none"
      stroke="var(--color-accent)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeDasharray={RING_LENGTH}
      strokeDashoffset={RING_LENGTH * (1 - (fraction ?? 0.25))}
      className="transition-[stroke-dashoffset] duration-300"
    />
  </svg>
);

/** Re-render once a second while something is running, for elapsed time and ETA. */
const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active]);
  return now;
};

const statusLabel = (task: Task) => {
  switch (task.status) {
    case "running":
      return t("tasks.status.running");
    case "succeeded":
      return t("tasks.status.succeeded");
    case "failed":
      return t("tasks.status.failed");
    default:
      return t("tasks.status.cancelled");
  }
};

const StatusIcon = ({ task }: { task: Task }) => {
  if (task.status === "succeeded") {
    return <CircleCheck className="h-4 w-4 shrink-0 text-green-500" aria-hidden="true" />;
  }
  if (task.status === "failed") {
    return <CircleAlert className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />;
  }
  if (task.status === "cancelled") {
    return <Ban className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />;
  }
  return <ProgressRing fraction={fractionOf(task)} />;
};

const smallButtonClass =
  "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50";

const TaskErrors = ({ task }: { task: Task }) => {
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const listId = useId();
  if (task.errorCount === 0) return null;

  const copy = () => {
    const text = formatTaskErrors(task, (count) =>
      t("tasks.errors.more", { count: String(count) }),
    );
    copyTextToClipboard(text)
      .then(() => setCopyState("copied"))
      .catch(() => setCopyState("failed"));
  };

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={smallButtonClass}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
          data-task-errors-toggle
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          {expanded
            ? t("tasks.errors.hide")
            : t(task.errorCount === 1 ? "tasks.errors.show.one" : "tasks.errors.show.many", {
                count: String(task.errorCount),
              })}
        </button>
        <button type="button" className={smallButtonClass} onClick={copy}>
          <Copy className="h-3 w-3" aria-hidden="true" />
          {copyState === "copied"
            ? t("tasks.errors.copied")
            : copyState === "failed"
              ? t("tasks.errors.copyFailed")
              : t("tasks.errors.copy")}
        </button>
      </div>
      {expanded && (
        <ul
          id={listId}
          className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-[var(--radius-sm)] bg-[var(--color-bg-secondary)] p-2 text-[11px]"
          data-task-errors
        >
          {task.errors.map((error, index) => (
            <li key={index} className="break-words">
              <span className="font-medium text-[var(--color-text-primary)]">{error.item}</span>
              <span className="text-[var(--color-text-muted)]">: {error.message}</span>
            </li>
          ))}
          {task.errorCount > task.errors.length && (
            <li className="text-[var(--color-text-muted)]">
              {t("tasks.errors.more", { count: String(task.errorCount - task.errors.length) })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

const TaskRow = ({ task, now }: { task: Task; now: number }) => {
  const cancelTask = useTaskStore((state) => state.cancelTask);
  const retryTask = useTaskStore((state) => state.retryTask);
  const dismissTask = useTaskStore((state) => state.dismissTask);
  const running = task.status === "running";
  const fraction = fractionOf(task);
  const etaMs = running ? estimateRemainingMs(task, now) : null;

  const meta: string[] = [];
  if (running) {
    if (task.total !== null && task.unit === "percent") {
      meta.push(`${Math.floor((fraction ?? 0) * 100)}%`);
    } else if (task.total !== null) {
      meta.push(
        t("tasks.progress.count", {
          done: task.done.toLocaleString(),
          total: task.total.toLocaleString(),
        }),
      );
    }
    meta.push(
      etaMs !== null
        ? t("tasks.eta", { time: formatTaskDuration(etaMs) })
        : t("tasks.elapsed", { time: formatTaskDuration(now - task.startedAt) }),
    );
  } else if (task.finishedAt !== null) {
    meta.push(t("tasks.duration", { time: formatTaskDuration(task.finishedAt - task.startedAt) }));
  }

  return (
    <li
      className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-bg-primary)] p-2.5"
      data-task-id={task.id}
      data-task-kind={task.kind}
      data-task-status={task.status}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          <StatusIcon task={task} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
              {task.title}
            </span>
            <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
              {statusLabel(task)}
            </span>
          </div>
          {running && task.detail && (
            <p className="truncate text-[11px] text-[var(--color-text-secondary)]">{task.detail}</p>
          )}
          {running && (
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-secondary)]"
              role="progressbar"
              aria-label={task.title}
              aria-valuemin={0}
              aria-valuemax={task.total ?? undefined}
              aria-valuenow={task.total !== null ? task.done : undefined}
              aria-valuetext={meta.join(", ")}
            >
              {fraction !== null ? (
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
                  style={{ width: `${fraction * 100}%` }}
                />
              ) : (
                <div className="h-full w-full rounded-full bg-[var(--color-accent)] opacity-40 motion-safe:animate-pulse" />
              )}
            </div>
          )}
          {!running && task.summary && (
            <p className="mt-0.5 break-words text-[11px] text-[var(--color-text-secondary)]">
              {task.summary}
            </p>
          )}
          {task.error && (
            <p className="mt-0.5 break-words text-[11px] text-red-500">{task.error}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
            <span className="text-[11px] text-[var(--color-text-muted)]">{meta.join(" · ")}</span>
            <span className="flex items-center gap-1">
              {running && task.cancel && (
                <button
                  type="button"
                  className={smallButtonClass}
                  disabled={task.cancelRequested}
                  onClick={() => cancelTask(task.id)}
                  data-task-cancel
                >
                  {task.cancelRequested ? t("tasks.cancelling") : t("tasks.cancel")}
                </button>
              )}
              {!running && task.retry && (
                <button
                  type="button"
                  className={smallButtonClass}
                  onClick={() => retryTask(task.id)}
                  data-task-retry
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  {t("tasks.retry")}
                </button>
              )}
              {!running && (
                <button
                  type="button"
                  className={smallButtonClass}
                  onClick={() => dismissTask(task.id)}
                  aria-label={t("tasks.dismiss")}
                  title={t("tasks.dismiss")}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
          <TaskErrors task={task} />
        </div>
      </div>
    </li>
  );
};

/**
 * Title-bar indicator for background work, with the task center popover it
 * opens. The open state lives in the task store so toasts and the command
 * palette can open the panel too.
 */
export const TaskCenter = () => {
  const tasks = useTaskStore((state) => state.tasks);
  const panelOpen = useTaskStore((state) => state.panelOpen);
  const unseenFailures = useTaskStore((state) => state.unseenFailures);
  const togglePanel = useTaskStore((state) => state.togglePanel);
  const closePanel = useTaskStore((state) => state.closePanel);
  const clearFinished = useTaskStore((state) => state.clearFinished);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const titleId = useId();
  const panelId = useId();

  const { running, finished } = useMemo(
    () => ({
      running: tasks.filter((task) => task.status === "running"),
      finished: tasks
        .filter((task) => task.status !== "running")
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    }),
    [tasks],
  );
  const now = useNow(panelOpen && running.length > 0);

  // Anchor below the button, right-aligned, however the panel was opened.
  useEffect(
    () =>
      useTaskStore.subscribe((state, previous) => {
        if (!state.panelOpen || previous.panelOpen) return;
        const rect = buttonRef.current?.getBoundingClientRect();
        if (rect) setPosition({ x: rect.right, y: rect.bottom + 6 });
      }),
    [],
  );

  // Focus moves into the panel as it mounts (see its ref) and back to the
  // button when it closes, unless the user has already moved on elsewhere.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!panelOpen && wasOpenRef.current) {
      const active = document.activeElement;
      if (!active || active === document.body || panelRef.current?.contains(active)) {
        buttonRef.current?.focus();
      }
    }
    wasOpenRef.current = panelOpen;
  }, [panelOpen]);

  const fraction = aggregateFraction(running);
  const label =
    running.length > 0
      ? t(running.length === 1 ? "tasks.indicator.running.one" : "tasks.indicator.running.many", {
          count: String(running.length),
        })
      : unseenFailures > 0
        ? t("tasks.indicator.failed")
        : t("tasks.title");

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`window-no-drag relative mr-2 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-2 text-[11px] font-semibold transition-colors ${
          panelOpen
            ? "border-transparent bg-[var(--color-bg-active)] text-[var(--color-text-primary)]"
            : "border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        }`}
        onClick={togglePanel}
        onDoubleClick={(event) => event.stopPropagation()}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        aria-controls={panelOpen ? panelId : undefined}
        data-task-center-toggle
        data-task-running={running.length}
      >
        {running.length > 0 ? (
          <>
            <ProgressRing fraction={fraction} />
            <span aria-hidden="true">{running.length}</span>
          </>
        ) : (
          <ListChecks className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        )}
        {unseenFailures > 0 && !panelOpen && (
          <span
            className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-[var(--color-bg-secondary)]"
            aria-hidden="true"
            data-task-failure-badge
          />
        )}
      </button>
      <Popover
        isOpen={panelOpen}
        position={position}
        onClose={closePanel}
        anchorRef={buttonRef}
        className="w-[380px]"
      >
        <div
          ref={(node) => {
            if (node && !panelRef.current) node.focus({ preventScroll: true });
            panelRef.current = node;
          }}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="p-3 outline-none"
          data-task-center
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id={titleId} className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              {t("tasks.title")}
            </h2>
            <button
              type="button"
              className={smallButtonClass}
              disabled={finished.length === 0}
              onClick={clearFinished}
              data-task-clear-finished
            >
              {t("tasks.clearFinished")}
            </button>
          </div>
          {tasks.length === 0 && (
            <p className="py-6 text-center text-[12px] text-[var(--color-text-muted)]">
              {t("tasks.empty")}
            </p>
          )}
          {running.length > 0 && (
            <section aria-label={t("tasks.section.running")} className="mb-3">
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t("tasks.section.running")}
              </h3>
              <ul className="space-y-1.5">
                {running.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} />
                ))}
              </ul>
            </section>
          )}
          {finished.length > 0 && (
            <section aria-label={t("tasks.section.finished")}>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t("tasks.section.finished")}
              </h3>
              <ul className="space-y-1.5">
                {finished.map((task) => (
                  <TaskRow key={task.id} task={task} now={now} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </Popover>
    </>
  );
};
