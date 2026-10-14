import assert from "node:assert/strict";
import {
  SLEEP_FADE_DURATION_MS,
  SLEEP_FADE_STEP_MS,
  SLEEP_TIMER_PRESET_MINUTES,
  formatSleepRemaining,
  runSleepFade,
  sleepFadeVolume,
  sleepTimerEndsAt,
  sleepTimerRemainingMs,
} from "../src/lib/sleepTimer.ts";

// --- Presets and countdown ---------------------------------------------------
{
  assert.deepEqual([...SLEEP_TIMER_PRESET_MINUTES], [15, 30, 45, 60, 90]);
  const start = 1_700_000_000_000;
  const endsAt = sleepTimerEndsAt(start, 15);
  assert.equal(endsAt - start, 15 * 60_000);
  assert.equal(sleepTimerRemainingMs(endsAt, start), 15 * 60_000);
  assert.equal(sleepTimerRemainingMs(endsAt, start + 60_000), 14 * 60_000);
  assert.equal(sleepTimerRemainingMs(endsAt, endsAt + 5_000), 0, "never negative");
}

// --- Remaining-time formatting -----------------------------------------------
{
  assert.equal(formatSleepRemaining(15 * 60_000), "15:00");
  assert.equal(formatSleepRemaining(90 * 60_000), "1:30:00");
  assert.equal(formatSleepRemaining(61_000), "1:01");
  assert.equal(formatSleepRemaining(9_000), "0:09");
  // Rounds up, so the display only reaches 0:00 when the timer actually fires.
  assert.equal(formatSleepRemaining(400), "0:01");
  assert.equal(formatSleepRemaining(0), "0:00");
  assert.equal(formatSleepRemaining(-1_000), "0:00");
}

// --- Fade curve --------------------------------------------------------------
{
  assert.equal(sleepFadeVolume(0.8, 0), 0.8);
  assert.equal(sleepFadeVolume(0.8, SLEEP_FADE_DURATION_MS), 0);
  assert.equal(sleepFadeVolume(0.8, SLEEP_FADE_DURATION_MS * 2), 0);
  assert.equal(sleepFadeVolume(0.8, -100), 0.8);
  assert.equal(sleepFadeVolume(0.8, 500, 0), 0, "a zero-length fade is silent at once");
  assert.equal(sleepFadeVolume(0, 1_000), 0);

  let previous = Infinity;
  for (let elapsed = 0; elapsed <= SLEEP_FADE_DURATION_MS; elapsed += 250) {
    const volume = sleepFadeVolume(1, elapsed);
    assert.ok(volume <= previous, `fade must never rise (at ${elapsed} ms)`);
    assert.ok(volume >= 0 && volume <= 1);
    previous = volume;
  }
  // Front-loaded drop: halfway through, well under half the starting level.
  assert.ok(sleepFadeVolume(1, SLEEP_FADE_DURATION_MS / 2) < 0.5);
}

// Fake clock: wait() advances time instead of sleeping.
const createClock = () => {
  let time = 0;
  return {
    now: () => time,
    wait: async (ms) => {
      time += ms;
    },
    advance: (ms) => {
      time += ms;
    },
  };
};

// --- Fade runs to silence ----------------------------------------------------
{
  const clock = createClock();
  const volumes = [];
  const outcome = await runSleepFade({
    startVolume: 0.6,
    setVolume: (volume) => {
      volumes.push(volume);
    },
    wait: clock.wait,
    now: clock.now,
    isCancelled: () => false,
  });
  assert.equal(outcome, "completed");
  assert.equal(volumes[0], 0.6, "the first step starts at the user's volume");
  assert.equal(volumes.at(-1), 0, "the last step is silent");
  assert.equal(volumes.length, SLEEP_FADE_DURATION_MS / SLEEP_FADE_STEP_MS + 1);
  assert.equal(clock.now(), SLEEP_FADE_DURATION_MS);
  for (let index = 1; index < volumes.length; index += 1) {
    assert.ok(volumes[index] <= volumes[index - 1], "volume steps only go down");
  }
}

// --- Slow volume commands shorten the step count, not the fade ----------------
{
  const clock = createClock();
  const volumes = [];
  const outcome = await runSleepFade({
    startVolume: 1,
    setVolume: async (volume) => {
      volumes.push(volume);
      clock.advance(1_800); // e.g. a remote device answering slowly
    },
    wait: clock.wait,
    now: clock.now,
    isCancelled: () => false,
  });
  assert.equal(outcome, "completed");
  assert.equal(volumes.at(-1), 0);
  assert.ok(volumes.length <= 6, `expected few steps, got ${volumes.length}`);
}

// --- Cancelling mid-fade stops the steps -------------------------------------
{
  const clock = createClock();
  const volumes = [];
  const outcome = await runSleepFade({
    startVolume: 1,
    setVolume: (volume) => {
      volumes.push(volume);
    },
    wait: clock.wait,
    now: clock.now,
    isCancelled: () => clock.now() >= 3_000,
  });
  assert.equal(outcome, "cancelled");
  assert.ok(volumes.length > 1 && volumes.length < 20, `steps before cancel: ${volumes.length}`);
  assert.ok(volumes.at(-1) > 0, "a cancelled fade never reaches silence");
}

// --- Cancelled before the first step -----------------------------------------
{
  const clock = createClock();
  let calls = 0;
  const outcome = await runSleepFade({
    startVolume: 1,
    setVolume: () => {
      calls += 1;
    },
    wait: clock.wait,
    now: clock.now,
    isCancelled: () => true,
  });
  assert.equal(outcome, "cancelled");
  assert.equal(calls, 0);
}

// --- A failing output propagates so the caller can still pause ----------------
{
  const clock = createClock();
  await assert.rejects(
    runSleepFade({
      startVolume: 1,
      setVolume: async () => {
        throw new Error("device refused volume");
      },
      wait: clock.wait,
      now: clock.now,
      isCancelled: () => false,
    }),
    /device refused volume/,
  );
}

console.log("sleep-timer-smoke: countdown, formatting and fade verified");
