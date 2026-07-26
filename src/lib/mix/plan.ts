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
  /**
   * Upper bound on the blend, not a fixed length. The pair decides how much of
   * it to use — a track with an eight-bar outro cannot give a thirty-two-bar
   * blend no matter what the setting says.
   */
  bars?: MixBars;           // default 8
};

const MIN_CONFIDENCE = 0.25;
const MIN_BPM = 60;
const MAX_BPM = 200;
const MAX_RATE_LOG2 = Math.log2(1.08);
const TAIL_MARGIN_SEC = 1.5;
const RATE_MULTIPLIERS = [0.5, 1, 2];

// Below this the novelty curve was too flat to trust a phrase period, so the
// plan stays on plain bar alignment.
const MIN_PHRASE_CONFIDENCE = 0.15;

/**
 * The musical grid a transition should start on.
 *
 * Bars alone put the blend on a downbeat, which lines the kicks up but can
 * still land three bars into a phrase — beat-matched and yet plainly wrong to
 * anyone listening. Where the phrase grid is trustworthy the anchor advances a
 * whole phrase at a time instead.
 */
/**
 * How long the blend should run, given what the two tracks actually offer.
 *
 * A DJ blends the outgoing track's outro against the incoming track's intro, so
 * those two runways bound the length — asking for thirty-two bars over an
 * eight-bar outro just means twenty-four bars of the previous track's chorus
 * fighting the new one. The setting caps the result rather than fixing it.
 *
 * The length is then pulled back when the blend is a riskier one to hold: a
 * large tempo pull exposes pitch and drift for longer, and a weak grid means
 * the alignment itself is less certain.
 */
const deriveBars = (args: {
  cap: number;
  outroBarsA: number | null;
  introBarsB: number | null;
  rateLog2: number;
  confidence: number;
}): number => {
  const { cap, outroBarsA, introBarsB, rateLog2, confidence } = args;

  let bars = cap;
  // Only constrain by a runway that was actually detected; a track with no
  // outro simply does not bound the blend.
  if (outroBarsA !== null) bars = Math.min(bars, outroBarsA);
  if (introBarsB !== null) bars = Math.min(bars, introBarsB);

  // Tempo strain: 0 when the tracks already share a tempo, 1 at the maximum
  // pull the planner allows.
  const strain = MAX_RATE_LOG2 > 0 ? Math.abs(rateLog2) / MAX_RATE_LOG2 : 0;
  if (strain > 0.6) bars /= 2;
  if (confidence < 0.45) bars /= 2;

  return bars;
};

const gridAnchor = (grid: BeatGrid, barSec: number) => {
  const usePhrase =
    grid.phraseConfidence >= MIN_PHRASE_CONFIDENCE &&
    grid.phraseBars > 0 &&
    Number.isFinite(grid.firstPhraseSec);
  return usePhrase
    ? {
        originSec: Math.max(0, grid.firstPhraseSec),
        stepSec: grid.phraseBars * barSec,
        bars: grid.phraseBars,
      }
    : { originSec: Math.max(0, grid.firstDownbeatSec), stepSec: barSec, bars: 1 };
};

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
  const anchorA = gridAnchor(gridA, barSecA);

  // How much runway each track actually offers. A runway under a bar is no
  // runway at all, and must not be read as "zero bars of blend allowed".
  const usableRunway = (bars: number) => (bars >= 1 ? bars : null);
  const outroBarsA = gridA.hasOutro
    ? usableRunway((durationASec - gridA.outroStartSec) / barSecA)
    : null;
  const introBarsB = gridB.introEndSec > 0
    ? usableRunway((gridB.introEndSec - gridB.firstDownbeatSec) / (4 * (60 / gridB.bpm)))
    : null;
  const targetBars = deriveBars({
    cap: requestedBars,
    outroBarsA,
    introBarsB,
    rateLog2: bestRateLog2,
    confidence: Math.min(gridA.confidence, gridB.confidence),
  });

  // A blend that both begins and ends on a phrase boundary is what makes the
  // change of track sound intended, so whole-phrase lengths come first. The
  // rest stay available for tracks with little runway left.
  const barsCandidates = [32, 16, 8, 4, 2]
    .filter((bars) => bars <= targetBars)
    .sort((left, right) => {
      const wholePhrase = (bars: number) => (bars % anchorA.bars === 0 ? 0 : 1);
      return wholePhrase(left) - wholePhrase(right) || right - left;
    });
  // Never drop the transition entirely just because the runway was tight.
  if (barsCandidates.length === 0) barsCandidates.push(2);

  let chosenBars = 0;
  let durationSec = 0;
  let startAtSec = -1;
  for (const bars of barsCandidates) {
    const candidateDuration = bars * barSecA;
    const latestStart = durationASec - candidateDuration - TAIL_MARGIN_SEC;
    if (anchorA.originSec > latestStart) continue;

    // Mix out where the track stops being the main event. Without this the
    // blend simply occupies A's final bars, whatever they contain — an outro,
    // a fade, applause, or silence.
    const preferredStart = gridA.hasOutro
      ? Math.min(gridA.outroStartSec, latestStart)
      : latestStart;
    const k = Math.floor((preferredStart - anchorA.originSec) / anchorA.stepSec);
    if (k < 0) continue;

    chosenBars = bars;
    durationSec = candidateDuration;
    startAtSec = anchorA.originSec + k * anchorA.stepSec;
    break;
  }
  if (chosenBars === 0 || startAtSec < 0 || durationSec <= 0) {
    return buildFadePlan(gridB, durationASec, durationBSec);
  }

  // Cue B at a phrase start too, so its intro enters the blend where a DJ
  // would drop it rather than wherever its first bar happens to fall.
  const barSecB = 4 * (60 / gridB.bpm);
  const cueInSec = Math.max(0, gridAnchor(gridB, barSecB).originSec);
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
