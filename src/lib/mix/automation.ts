import type { TransitionPlan } from "./plan";

export type AutomationPoint = { at: number; value: number };

export type TransitionAutomation = {
  incomingGain: AutomationPoint[];
  outgoingGain: AutomationPoint[];
  incomingShelf: AutomationPoint[];
  outgoingShelf: AutomationPoint[];
};

export type TransitionAutomationSnapshot = {
  incomingGain: number;
  outgoingGain: number;
  incomingShelf: number;
  outgoingShelf: number;
};

const BASS_KILL_DB = -28;
const SWAP_START_GAIN = 0.45;
const SWAP_END_GAIN = 0.55;

// Automation is interpolated linearly between points, so a curved law has to be
// sampled into segments. 24 is well past the point where the residual error is
// audible and still a trivial array.
const EQUAL_POWER_STEPS = 24;

/**
 * Equal-power (sin/cos) crossfade.
 *
 * Beat-matched decks play correlated audio: their amplitudes add, so gains that
 * sum to one hold the level steady. Unaligned decks are uncorrelated and their
 * *power* adds instead — gains summing to one then dip about 3 dB at the middle
 * of the blend. sin/cos keeps the summed power constant, which is what the
 * fade path needs.
 */
const equalPowerCurves = (durationSec: number) => {
  const incoming: AutomationPoint[] = [];
  const outgoing: AutomationPoint[] = [];
  for (let step = 0; step <= EQUAL_POWER_STEPS; step += 1) {
    const progress = step / EQUAL_POWER_STEPS;
    const at = progress * durationSec;
    incoming.push({ at, value: Math.sin((progress * Math.PI) / 2) });
    outgoing.push({ at, value: Math.cos((progress * Math.PI) / 2) });
  }
  return { incoming, outgoing };
};

export const valueAtAutomationPoint = (
  points: AutomationPoint[],
  offsetSec: number,
): number => {
  if (points.length === 0) return 0;
  if (offsetSec <= points[0].at) return points[0].value;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (offsetSec <= next.at) {
      const span = next.at - previous.at;
      if (span <= 0) return next.value;
      const fraction = (offsetSec - previous.at) / span;
      return previous.value + (next.value - previous.value) * fraction;
    }
  }
  return points[points.length - 1].value;
};

export const buildTransitionAutomation = (plan: TransitionPlan): TransitionAutomation => {
  const swapStart = plan.bassSwapAtSec;
  const swapEnd = Math.min(plan.durationSec, plan.bassSwapAtSec + plan.bassSwapDurSec);

  // Complementary gains keep the combined amplitude at unity or below. The
  // former additive curve could reach 1.85 before the bass swap and clip
  // already-mastered tracks badly. This only holds while the decks are
  // beat-matched; the fade path uses an equal-power law instead.
  const beatmatchedIncoming: AutomationPoint[] = [
    { at: 0, value: 0 },
    { at: swapStart, value: SWAP_START_GAIN },
    ...(swapEnd < plan.durationSec
      ? [{ at: swapEnd, value: SWAP_END_GAIN }]
      : []),
    { at: plan.durationSec, value: 1 },
  ];
  const equalPower = plan.mode === "fade" ? equalPowerCurves(plan.durationSec) : null;
  const incomingGain = equalPower ? equalPower.incoming : beatmatchedIncoming;
  const outgoingGain = equalPower
    ? equalPower.outgoing
    : beatmatchedIncoming.map(({ at, value }) => ({ at, value: 1 - value }));
  const incomingShelfStart = plan.mode === "beatmatch" ? BASS_KILL_DB : 0;
  const incomingShelf: AutomationPoint[] = [
    { at: 0, value: incomingShelfStart },
    { at: swapStart, value: incomingShelfStart },
    { at: swapEnd, value: 0 },
  ];
  const outgoingShelf: AutomationPoint[] = [
    { at: 0, value: 0 },
    { at: swapStart, value: 0 },
    { at: swapEnd, value: BASS_KILL_DB },
  ];
  return { incomingGain, outgoingGain, incomingShelf, outgoingShelf };
};

export const transitionAutomationAt = (
  plan: TransitionPlan,
  offsetSec: number,
): TransitionAutomationSnapshot => {
  const automation = buildTransitionAutomation(plan);
  return {
    incomingGain: valueAtAutomationPoint(automation.incomingGain, offsetSec),
    outgoingGain: valueAtAutomationPoint(automation.outgoingGain, offsetSec),
    incomingShelf: valueAtAutomationPoint(automation.incomingShelf, offsetSec),
    outgoingShelf: valueAtAutomationPoint(automation.outgoingShelf, offsetSec),
  };
};
