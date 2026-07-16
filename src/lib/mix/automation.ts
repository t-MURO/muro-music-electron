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
  // already-mastered tracks badly.
  const incomingGain: AutomationPoint[] = [
    { at: 0, value: 0 },
    { at: swapStart, value: SWAP_START_GAIN },
    ...(swapEnd < plan.durationSec
      ? [{ at: swapEnd, value: SWAP_END_GAIN }]
      : []),
    { at: plan.durationSec, value: 1 },
  ];
  const outgoingGain = incomingGain.map(({ at, value }) => ({ at, value: 1 - value }));
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
