// Pure sleep-timer helpers: countdown math, display formatting and the
// expiry fade-out. Kept free of stores and runtime imports so the smoke test
// can drive them with a fake clock.

export const SLEEP_TIMER_PRESET_MINUTES = [15, 30, 45, 60, 90] as const;

/** How long the volume fades before the sleep timer pauses playback. */
export const SLEEP_FADE_DURATION_MS = 8_000;
/** Interval between volume steps; remote outputs pace themselves by awaiting each step. */
export const SLEEP_FADE_STEP_MS = 200;

export const sleepTimerEndsAt = (now: number, minutes: number): number =>
  now + Math.max(0, minutes) * 60_000;

export const sleepTimerRemainingMs = (endsAt: number, now: number): number =>
  Math.max(0, endsAt - now);

/** "m:ss" below an hour, "h:mm:ss" above. Rounds up so 0:00 only shows at expiry. */
export const formatSleepRemaining = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = seconds.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
};

/**
 * Volume `elapsedMs` into the fade. The curve is quadratic rather than linear
 * because element volume is linear amplitude: a straight ramp would sound
 * nearly unchanged at first and then drop off abruptly at the end.
 */
export const sleepFadeVolume = (
  startVolume: number,
  elapsedMs: number,
  durationMs: number = SLEEP_FADE_DURATION_MS,
): number => {
  if (durationMs <= 0) return 0;
  const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
  const remaining = 1 - progress;
  return Math.max(0, startVolume) * remaining * remaining;
};

export type SleepFadeOptions = {
  startVolume: number;
  setVolume: (volume: number) => Promise<void> | void;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  /** Checked before every step; returning true abandons the fade. */
  isCancelled: () => boolean;
  durationMs?: number;
  stepMs?: number;
};

/**
 * Steps the volume down to silence. Progress follows the clock rather than the
 * step count, so slow volume commands (remote devices) or throttled timers
 * shorten the number of steps instead of stretching the fade.
 */
export const runSleepFade = async ({
  startVolume,
  setVolume,
  wait,
  now,
  isCancelled,
  durationMs = SLEEP_FADE_DURATION_MS,
  stepMs = SLEEP_FADE_STEP_MS,
}: SleepFadeOptions): Promise<"completed" | "cancelled"> => {
  const startedAt = now();
  for (;;) {
    if (isCancelled()) return "cancelled";
    const elapsed = now() - startedAt;
    await setVolume(sleepFadeVolume(startVolume, elapsed, durationMs));
    if (elapsed >= durationMs) return isCancelled() ? "cancelled" : "completed";
    await wait(stepMs);
  }
};
