import type { BeatGrid } from "../beatgrid/types";
import type { MixBars } from "./config";

export type TransitionPlan = {
  mode: "beatmatch" | "fade";
  rate: number;             // initial playbackRate for incoming deck; 1 in fade mode
  startAtSec: number;       // position in A when the incoming deck starts playing
  cueInSec: number;         // position in B (B-time) where B starts
  durationSec: number;      // total transition length measured on A's clock
  bassSwapAtSec: number;    // offset from transition start when bass swap begins
  bassSwapDurSec: number;   // bass swap ramp length
  beatSecA: number | null;  // A beat interval in seconds; null in fade mode
};

export type PlanTransitionArgs = {
  gridA: BeatGrid | null;
  gridB: BeatGrid | null;
  durationASec: number;
  durationBSec: number;
  bars?: MixBars;           // default 8
};

const MIN_CONFIDENCE = 0.25;
const MIN_BPM = 60;
const MAX_BPM = 200;
const MAX_RATE_LOG2 = Math.log2(1.08);
const TAIL_MARGIN_SEC = 1.5;
const RATE_MULTIPLIERS = [0.5, 1, 2];

const buildFadePlan = (
  gridB: BeatGrid | null,
  durationASec: number,
  durationBSec: number
): TransitionPlan => {
  const durationSec = Math.min(8, Math.max(3, durationASec * 0.1));
  const startAtSec = Math.max(0, durationASec - durationSec - 1);
  const maxCueInSec = Math.max(0, durationBSec - durationSec - 5);
  const cueInSec = Math.min(Math.max(gridB?.firstDownbeatSec ?? 0, 0), maxCueInSec);
  return {
    mode: "fade",
    rate: 1,
    startAtSec,
    cueInSec,
    durationSec,
    bassSwapAtSec: durationSec / 2,
    bassSwapDurSec: Math.min(2, durationSec / 4),
    beatSecA: null,
  };
};

export function planTransition(args: PlanTransitionArgs): TransitionPlan {
  const { gridA, gridB, durationASec, durationBSec } = args;
  const requestedBars = args.bars ?? 8;

  if (
    !gridA ||
    !gridB ||
    gridA.confidence < MIN_CONFIDENCE ||
    gridB.confidence < MIN_CONFIDENCE ||
    gridA.bpm < MIN_BPM ||
    gridA.bpm > MAX_BPM ||
    gridB.bpm < MIN_BPM ||
    gridB.bpm > MAX_BPM ||
    durationASec < 60 ||
    durationBSec < 45
  ) {
    return buildFadePlan(gridB, durationASec, durationBSec);
  }

  let rate = 1;
  let bestRateLog2 = Number.POSITIVE_INFINITY;
  for (const multiplier of RATE_MULTIPLIERS) {
    const candidate = (gridA.bpm * multiplier) / gridB.bpm;
    const absLog2 = Math.abs(Math.log2(candidate));
    if (absLog2 < bestRateLog2) {
      bestRateLog2 = absLog2;
      rate = candidate;
    }
  }
  if (bestRateLog2 > MAX_RATE_LOG2) {
    return buildFadePlan(gridB, durationASec, durationBSec);
  }

  const beatSecA = 60 / gridA.bpm;
  const barSecA = 4 * beatSecA;
  const firstDownbeatA = Math.max(0, gridA.firstDownbeatSec);

  const barsCandidates = [32, 16, 8, 4, 2]
    .filter((bars) => bars <= requestedBars);

  let chosenBars = 0;
  let durationSec = 0;
  let startAtSec = -1;
  for (const bars of barsCandidates) {
    const candidateDuration = bars * barSecA;
    const latestStart = durationASec - candidateDuration - TAIL_MARGIN_SEC;
    if (firstDownbeatA > latestStart) continue;
    const k = Math.floor((latestStart - firstDownbeatA) / barSecA);
    chosenBars = bars;
    durationSec = candidateDuration;
    startAtSec = firstDownbeatA + k * barSecA;
    break;
  }
  if (chosenBars === 0 || startAtSec < 0 || durationSec <= 0) {
    return buildFadePlan(gridB, durationASec, durationBSec);
  }

  const cueInSec = Math.max(0, gridB.firstDownbeatSec);
  if (!(durationBSec - cueInSec > durationSec * rate + 10)) {
    return buildFadePlan(gridB, durationASec, durationBSec);
  }

  const bassSwapBars = Math.max(1, Math.floor(chosenBars / 2));
  return {
    mode: "beatmatch",
    rate,
    startAtSec,
    cueInSec,
    durationSec,
    bassSwapAtSec: bassSwapBars * barSecA,
    bassSwapDurSec: barSecA,
    beatSecA,
  };
}
