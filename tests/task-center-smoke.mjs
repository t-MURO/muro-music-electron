import assert from "node:assert/strict";
import {
  MAX_FINISHED_TASKS,
  MAX_TASK_ERRORS,
  estimateRemainingMs,
  formatTaskDuration,
  formatTaskErrors,
  runTask,
  startTask,
  useTaskStore,
} from "../src/stores/taskStore.ts";

const store = () => useTaskStore.getState();
const taskById = (id) => store().tasks.find((task) => task.id === id);
const reset = () => useTaskStore.setState({ tasks: [], panelOpen: false, unseenFailures: 0 });

// --- Lifecycle and progress --------------------------------------------------
{
  reset();
  const task = startTask({ kind: "import", title: "Import", detail: "Scanning" });
  const started = taskById(task.id);
  assert.equal(started.status, "running");
  assert.equal(started.total, null, "progress starts indeterminate");
  assert.equal(started.unit, "items");
  assert.equal(started.detail, "Scanning");
  assert.equal(started.cancel, null, "no Cancel unless the job can stop");
  assert.equal(started.retry, null);
  assert.equal(task.finished, false);

  task.progress(3, 10, "song.mp3");
  assert.deepEqual((({ done, total, detail }) => ({ done, total, detail }))(taskById(task.id)), {
    done: 3,
    total: 10,
    detail: "song.mp3",
  });
  task.progress(4);
  assert.equal(taskById(task.id).total, 10, "leaving total out keeps the known total");
  assert.equal(taskById(task.id).detail, "song.mp3");
  const before = taskById(task.id);
  task.progress(4);
  assert.equal(taskById(task.id), before, "an unchanged report does not touch the store");

  task.succeed("4 imported");
  const finished = taskById(task.id);
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.summary, "4 imported");
  assert.equal(finished.detail, null, "finished tasks drop their in-progress detail");
  assert.ok(finished.finishedAt >= finished.startedAt);
  assert.equal(task.finished, true);

  // Reports after the end are ignored, and a task settles only once.
  task.progress(9, 10);
  task.addError("late.mp3", "too late");
  task.fail(new Error("too late"));
  assert.equal(taskById(task.id).status, "succeeded");
  assert.equal(taskById(task.id).done, 4);
  assert.equal(taskById(task.id).errorCount, 0);
}

// --- Item errors and finish() ------------------------------------------------
{
  reset();
  const clean = startTask({ kind: "export", title: "Clean" });
  clean.finish("ok");
  assert.equal(taskById(clean.id).status, "succeeded");

  const partial = startTask({ kind: "export", title: "Partial" });
  partial.addError("a.flac", "locked");
  partial.addError("b.flac", "missing");
  partial.finish("2 failed");
  const failed = taskById(partial.id);
  assert.equal(failed.status, "failed", "item errors make a finished task a failure");
  assert.deepEqual(failed.errors, [
    { item: "a.flac", message: "locked" },
    { item: "b.flac", message: "missing" },
  ]);
  assert.equal(failed.error, null, "item failures are not a whole-task error");

  const many = startTask({ kind: "import", title: "Many" });
  for (let index = 0; index < MAX_TASK_ERRORS + 25; index += 1) {
    many.addError(`file-${index}`, "unreadable");
  }
  many.finish();
  assert.equal(taskById(many.id).errors.length, MAX_TASK_ERRORS, "the error list is bounded");
  assert.equal(taskById(many.id).errorCount, MAX_TASK_ERRORS + 25, "but every error is counted");
  const report = formatTaskErrors(taskById(many.id), (count) => `+${count}`);
  assert.ok(report.startsWith("Many\nfile-0: unreadable\n"));
  assert.ok(report.endsWith("\n+25"));

  const broken = startTask({ kind: "backup", title: "Broken" });
  broken.fail(new Error("disk full"), "nothing written");
  assert.equal(taskById(broken.id).status, "failed");
  assert.equal(taskById(broken.id).error, "disk full");
  assert.equal(taskById(broken.id).summary, "nothing written");
  const plain = startTask({ kind: "backup", title: "Plain" });
  plain.fail("offline");
  assert.equal(taskById(plain.id).error, "offline");
  const bare = startTask({ kind: "backup", title: "Bare" });
  bare.fail();
  assert.equal(taskById(bare.id).error, null);
}

// --- Failure badge -----------------------------------------------------------
{
  reset();
  startTask({ kind: "verify", title: "One" }).fail("x");
  startTask({ kind: "verify", title: "Two" }).fail("y");
  startTask({ kind: "verify", title: "Fine" }).succeed();
  assert.equal(store().unseenFailures, 2, "failures while the panel is closed are counted");
  store().openPanel();
  assert.equal(store().panelOpen, true);
  assert.equal(store().unseenFailures, 0, "opening the panel marks them seen");
  startTask({ kind: "verify", title: "Seen" }).fail("z");
  assert.equal(store().unseenFailures, 0, "failures shown in the open panel are already seen");
  store().togglePanel();
  assert.equal(store().panelOpen, false);
  startTask({ kind: "verify", title: "Later" }).fail("z");
  assert.equal(store().unseenFailures, 1);
  store().clearFinished();
  assert.equal(store().unseenFailures, 0, "clearing the failures clears the badge");
}

// --- Cancel ------------------------------------------------------------------
{
  reset();
  let cancels = 0;
  const job = startTask({ kind: "import", title: "Job", cancel: () => (cancels += 1) });
  assert.equal(typeof taskById(job.id).cancel, "function");
  store().cancelTask(job.id);
  store().cancelTask(job.id);
  assert.equal(cancels, 1, "a cancel request reaches the job once");
  assert.equal(job.cancelRequested, true);
  assert.equal(taskById(job.id).status, "running", "the job decides when it has stopped");
  job.finish("2 of 5 imported");
  assert.equal(taskById(job.id).status, "cancelled", "finishing after a cancel request");
  assert.equal(taskById(job.id).cancel, null, "finished tasks offer no Cancel");
  assert.equal(taskById(job.id).cancelRequested, false);

  const loop = startTask({ kind: "playlist", title: "Loop", cancel: true });
  assert.equal(typeof taskById(loop.id).cancel, "function", "cancel: true offers Cancel");
  const processed = [];
  for (const item of ["a", "b", "c"]) {
    if (loop.cancelRequested) break;
    processed.push(item);
    if (item === "a") store().cancelTask(loop.id);
  }
  assert.deepEqual(processed, ["a"], "a loop sees the request before its next item");
  loop.cancelled();
  assert.equal(taskById(loop.id).status, "cancelled");

  const fixed = startTask({ kind: "export", title: "Fixed" });
  store().cancelTask(fixed.id);
  assert.equal(fixed.cancelRequested, false, "jobs without cancel cannot be cancelled");
  fixed.succeed();

  // A job can gain or lose Cancel while it runs, but not after it ends.
  const phased = startTask({ kind: "import", title: "Phased" });
  phased.update({ cancel: () => undefined });
  assert.equal(typeof taskById(phased.id).cancel, "function");
  phased.succeed();
  phased.update({ cancel: () => undefined });
  assert.equal(taskById(phased.id).cancel, null);
}

// --- Retry and keys ----------------------------------------------------------
{
  reset();
  let retries = 0;
  const first = startTask({ kind: "tags", title: "Tags", key: "tags" });
  first.update({ retry: () => (retries += 1) });
  store().retryTask(first.id);
  assert.equal(retries, 0, "running tasks are not retried");
  first.addError("a.mp3", "locked");
  first.finish();
  store().retryTask(first.id);
  assert.equal(retries, 1);
  assert.equal(taskById(first.id), undefined, "the retried task makes way for the new run");

  const failedRun = startTask({ kind: "tags", title: "Tags", key: "tags" });
  failedRun.fail("locked");
  const replacement = startTask({ kind: "tags", title: "Tags", key: "tags" });
  assert.equal(taskById(failedRun.id), undefined, "a new run replaces the finished one");
  const sibling = startTask({ kind: "tags", title: "Tags", key: "tags" });
  assert.ok(taskById(replacement.id), "a running task with the same key is kept");
  replacement.succeed();
  sibling.succeed();

  // Retry can be withdrawn after the end, e.g. when nothing is left to retry.
  const done = startTask({ kind: "playlist", title: "Done", retry: () => undefined });
  done.fail("x");
  done.update({ retry: null });
  assert.equal(taskById(done.id).retry, null);
  store().retryTask(done.id);
  assert.ok(taskById(done.id), "without retry the task stays");
}

// --- History ------------------------------------------------------------------
{
  reset();
  const running = startTask({ kind: "analysis", title: "Long" });
  const finishedIds = [];
  for (let index = 0; index < MAX_FINISHED_TASKS + 10; index += 1) {
    const task = startTask({ kind: "verify", title: `Check ${index}` });
    task.succeed();
    finishedIds.push(task.id);
  }
  const tasks = store().tasks;
  assert.equal(tasks.filter((task) => task.status !== "running").length, MAX_FINISHED_TASKS);
  assert.ok(taskById(running.id), "running tasks are never dropped");
  assert.equal(taskById(finishedIds[0]), undefined, "the oldest finished tasks go first");
  assert.ok(taskById(finishedIds.at(-1)));

  store().dismissTask(running.id);
  assert.ok(taskById(running.id), "running tasks cannot be dismissed");
  store().dismissTask(finishedIds.at(-1));
  assert.equal(taskById(finishedIds.at(-1)), undefined);
  store().clearFinished();
  assert.deepEqual(
    store().tasks.map((task) => task.id),
    [running.id],
    "clearing keeps running tasks",
  );
  running.cancelled();
}

// --- runTask -------------------------------------------------------------------
{
  reset();
  const value = await runTask({ kind: "export", title: "Ok" }, async (task) => {
    task.progress(1, 1);
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(store().tasks[0].status, "succeeded");

  const summarized = await runTask({ kind: "export", title: "Own" }, async (task) => {
    task.succeed("custom");
  });
  assert.equal(summarized, undefined);
  assert.equal(store().tasks[0].summary, "custom", "an operation may settle its own task");

  await assert.rejects(
    runTask({ kind: "export", title: "Throws" }, async () => {
      throw new Error("denied");
    }),
    /denied/,
  );
  assert.equal(store().tasks[0].status, "failed");
  assert.equal(store().tasks[0].error, "denied");

  await assert.rejects(
    runTask({ kind: "import", title: "Stopped", cancel: true }, async (task) => {
      store().cancelTask(task.id);
      throw new Error("aborted");
    }),
  );
  assert.equal(store().tasks[0].status, "cancelled", "an error after a cancel counts as cancelled");
}

// --- Reported-after-the-fact tasks keep their start time -------------------------
{
  reset();
  const startedAt = Date.now() - 5_000;
  const task = startTask({ kind: "backup", title: "Automatic", startedAt });
  task.succeed();
  assert.equal(taskById(task.id).startedAt, startedAt);
  assert.ok(taskById(task.id).finishedAt - startedAt >= 5_000);
}

// --- Estimates and formatting ----------------------------------------------------
{
  const base = { status: "running", startedAt: 0, done: 25, total: 100 };
  assert.equal(estimateRemainingMs({ ...base }, 2_000), null, "no estimate in the first seconds");
  assert.equal(estimateRemainingMs({ ...base }, 10_000), 30_000, "linear from the pace so far");
  assert.equal(estimateRemainingMs({ ...base, done: 0 }, 10_000), null);
  assert.equal(estimateRemainingMs({ ...base, total: null }, 10_000), null);
  assert.equal(estimateRemainingMs({ ...base, done: 100 }, 10_000), null);
  assert.equal(estimateRemainingMs({ ...base, status: "succeeded" }, 10_000), null);

  assert.equal(formatTaskDuration(0), "0s");
  assert.equal(formatTaskDuration(45_000), "45s");
  assert.equal(formatTaskDuration(125_000), "2m 05s");
  assert.equal(formatTaskDuration(3_780_000), "1h 03m");
  assert.equal(formatTaskDuration(-500), "0s");
}

reset();
console.log("task-center-smoke: ok");
