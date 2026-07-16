import type { TransitionPlan } from "../lib/mix/plan";

export type DeckHandle = {
  el: HTMLAudioElement;
};

export type TransitionRequest = {
  plan: TransitionPlan;
  incoming: { el: HTMLAudioElement; srcUrl: string };  // el NOT yet loaded; engine sets src, seeks, rates
  outgoing: { el: HTMLAudioElement };
  preservePitch: boolean;
  callbacks: {
    onStateChange: (status: "armed" | "active" | "completed" | "cancelled", progress: number) => void;
    onHandoff: () => void;   // runtime swaps active element/current track here, synchronously
  };
};

type ElementChain = {
  source: MediaElementAudioSourceNode;
  lowShelf: BiquadFilterNode;
  gain: GainNode;
};

type PitchCapableElement = HTMLAudioElement & {
  preservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

type HoldableParam = AudioParam & {
  cancelAndHoldAtTime?: (cancelTime: number) => AudioParam;
};

type AutomationPoint = { at: number; value: number };

type ActiveTransition = {
  plan: TransitionPlan;
  incomingEl: HTMLAudioElement;
  outgoingEl: HTMLAudioElement;
  callbacks: TransitionRequest["callbacks"];
  started: boolean;   // audio from both decks flowing
  starting: boolean;  // incoming.play() in flight
  frozen: boolean;    // user paused mid-transition
  watcherId: number | null;
  lastProgressEmitMs: number;
};

const BASS_KILL_DB = -28;
const LOW_SHELF_FREQ_HZ = 200;
const WATCH_INTERVAL_MS = 100;
const PROGRESS_EMIT_MS = 250;
const METADATA_TIMEOUT_MS = 5_000;
const CANCEL_RAMP_SEC = 0.25;
const RATE_EASE_STEP = 0.0015;
const RATE_EASE_EPSILON = 0.002;

let audioContext: AudioContext | null = null;
const elementChains = new Map<HTMLAudioElement, ElementChain>();
let transition: ActiveTransition | null = null;
let rateEaseTimerId: number | null = null;
let cancelCleanupTimerId: number | null = null;
let pendingCancelPark: (() => void) | null = null;

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function routeElement(el: HTMLAudioElement): void {
  // The graph is created lazily on the first armTransition; until then
  // elements keep playing through the default output path.
  if (!audioContext || elementChains.has(el)) return;
  const source = audioContext.createMediaElementSource(el);
  const lowShelf = audioContext.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = LOW_SHELF_FREQ_HZ;
  lowShelf.gain.value = 0;
  const gain = audioContext.createGain();
  gain.gain.value = 1;
  source.connect(lowShelf);
  lowShelf.connect(gain);
  gain.connect(audioContext.destination);
  elementChains.set(el, { source, lowShelf, gain });
}

const getChain = (el: HTMLAudioElement): ElementChain | null =>
  elementChains.get(el) ?? null;

const holdParam = (param: AudioParam): void => {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const holdable = param as HoldableParam;
  if (typeof holdable.cancelAndHoldAtTime === "function") {
    holdable.cancelAndHoldAtTime(now);
    return;
  }
  const value = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
};

const setChainNeutral = (chain: ElementChain): void => {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  chain.gain.gain.cancelScheduledValues(now);
  chain.gain.gain.setValueAtTime(1, now);
  chain.lowShelf.gain.cancelScheduledValues(now);
  chain.lowShelf.gain.setValueAtTime(0, now);
};

const waitForLoadedMetadata = (player: HTMLAudioElement, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      player.removeEventListener("loadedmetadata", handleSuccess);
      player.removeEventListener("error", handleError);
    };
    const handleSuccess = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(player.error?.message ?? "Media operation failed"));
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("loadedmetadata timed out"));
    }, timeoutMs);

    player.addEventListener("loadedmetadata", handleSuccess, { once: true });
    player.addEventListener("error", handleError, { once: true });
  });

const buildAutomation = (plan: TransitionPlan) => {
  const swapStart = plan.bassSwapAtSec;
  const swapEnd = Math.min(plan.durationSec, plan.bassSwapAtSec + plan.bassSwapDurSec);
  // Equal-power crossfade approximated with piecewise-linear ramps.
  const incomingGain: AutomationPoint[] = [
    { at: 0, value: 0 },
    { at: swapStart * 0.5, value: 0.85 * Math.sin(Math.PI / 4) },
    { at: swapStart, value: 0.85 },
    { at: swapEnd, value: 1 },
  ];
  const outgoingGain: AutomationPoint[] = [
    { at: 0, value: 1 },
    { at: swapStart, value: 1 },
    { at: swapStart + (plan.durationSec - swapStart) * 0.5, value: Math.cos(Math.PI / 4) },
    { at: plan.durationSec, value: 0 },
  ];
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

const valueAt = (points: AutomationPoint[], offsetSec: number): number => {
  if (points.length === 0) return 0;
  if (offsetSec <= points[0].at) return points[0].value;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    if (offsetSec <= next.at) {
      const span = next.at - prev.at;
      if (span <= 0) return next.value;
      const frac = (offsetSec - prev.at) / span;
      return prev.value + (next.value - prev.value) * frac;
    }
  }
  return points[points.length - 1].value;
};

const scheduleParam = (
  param: AudioParam,
  points: AutomationPoint[],
  offsetSec: number
): void => {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(valueAt(points, offsetSec), now);
  for (const point of points) {
    if (point.at <= offsetSec) continue;
    param.linearRampToValueAtTime(point.value, now + (point.at - offsetSec));
  }
};

// Schedules (or reschedules, on resume) all remaining automation. The offset
// is how far into the transition we are on the outgoing element's clock.
const scheduleAutomation = (t: ActiveTransition, fromAClockOffset: number): void => {
  const inChain = getChain(t.incomingEl);
  const outChain = getChain(t.outgoingEl);
  if (!inChain || !outChain) return;
  const automation = buildAutomation(t.plan);
  scheduleParam(inChain.gain.gain, automation.incomingGain, fromAClockOffset);
  scheduleParam(inChain.lowShelf.gain, automation.incomingShelf, fromAClockOffset);
  scheduleParam(outChain.gain.gain, automation.outgoingGain, fromAClockOffset);
  scheduleParam(outChain.lowShelf.gain, automation.outgoingShelf, fromAClockOffset);
};

const stopWatcher = (t: ActiveTransition): void => {
  if (t.watcherId !== null) {
    window.clearInterval(t.watcherId);
    t.watcherId = null;
  }
};

const stopRateEase = (): void => {
  if (rateEaseTimerId !== null) {
    window.clearInterval(rateEaseTimerId);
    rateEaseTimerId = null;
  }
};

const startRateEase = (el: HTMLAudioElement): void => {
  stopRateEase();
  if (Math.abs(el.playbackRate - 1) < RATE_EASE_EPSILON) {
    el.playbackRate = 1;
    return;
  }
  rateEaseTimerId = window.setInterval(() => {
    try {
      const diff = 1 - el.playbackRate;
      if (Math.abs(diff) < RATE_EASE_EPSILON) {
        el.playbackRate = 1;
        stopRateEase();
        return;
      }
      el.playbackRate += clampNumber(diff, -RATE_EASE_STEP, RATE_EASE_STEP);
    } catch {
      stopRateEase();
    }
  }, 100);
};

const flushPendingCancelPark = (): void => {
  if (cancelCleanupTimerId !== null) {
    window.clearTimeout(cancelCleanupTimerId);
    cancelCleanupTimerId = null;
  }
  if (pendingCancelPark) {
    const park = pendingCancelPark;
    pendingCancelPark = null;
    park();
  }
};

const parkElement = (el: HTMLAudioElement): void => {
  el.pause();
  el.removeAttribute("src");
  el.load();
  el.playbackRate = 1;
};

const completeTransition = (t: ActiveTransition): void => {
  if (transition !== t) return;
  stopWatcher(t);
  transition = null;

  t.outgoingEl.pause();
  const outChain = getChain(t.outgoingEl);
  if (outChain) setChainNeutral(outChain);
  t.outgoingEl.removeAttribute("src");
  t.outgoingEl.load();

  const inChain = getChain(t.incomingEl);
  if (inChain) setChainNeutral(inChain);

  t.callbacks.onHandoff();
  startRateEase(t.incomingEl);
  t.callbacks.onStateChange("completed", 1);
};

const applyPhaseCorrection = (t: ActiveTransition, outCur: number): void => {
  const expected = t.plan.cueInSec + (outCur - t.plan.startAtSec) * t.plan.rate;
  const err = t.incomingEl.currentTime - expected;
  const absErr = Math.abs(err);
  if (absErr > 0.25) return; // something is off; leave the rate alone
  if (absErr > 0.004) {
    t.incomingEl.playbackRate =
      t.plan.rate * (1 - clampNumber(err * 0.5, -0.02, 0.02));
  } else {
    t.incomingEl.playbackRate = t.plan.rate;
  }
};

const startTransition = (t: ActiveTransition, outCur: number): void => {
  t.starting = true;
  const lateBy = Math.max(0, outCur - t.plan.startAtSec);
  if (lateBy > 0.05) {
    try {
      t.incomingEl.currentTime = t.plan.cueInSec + lateBy * t.plan.rate;
    } catch {
      // Keep the pre-cued position; the phase corrector will converge.
    }
  }
  t.incomingEl.play().then(
    () => {
      if (transition !== t) return;
      t.starting = false;
      t.started = true;
      const offset = Math.max(0, t.outgoingEl.currentTime - t.plan.startAtSec);
      scheduleAutomation(t, offset);
      t.lastProgressEmitMs = Date.now();
      t.callbacks.onStateChange(
        "active",
        clampNumber(offset / t.plan.durationSec, 0, 1)
      );
    },
    () => {
      if (transition !== t) return;
      t.starting = false;
      cancelTransition();
    }
  );
};

const handleWatchTick = (): void => {
  const t = transition;
  if (!t || t.frozen) return;
  try {
    const outCur = t.outgoingEl.currentTime;
    if (!t.started) {
      if (!t.starting && outCur >= t.plan.startAtSec) startTransition(t, outCur);
      return;
    }
    if (t.plan.mode === "beatmatch" && t.plan.beatSecA !== null) {
      applyPhaseCorrection(t, outCur);
    }
    const progress = clampNumber(
      (outCur - t.plan.startAtSec) / t.plan.durationSec,
      0,
      1
    );
    const nowMs = Date.now();
    if (nowMs - t.lastProgressEmitMs >= PROGRESS_EMIT_MS) {
      t.lastProgressEmitMs = nowMs;
      t.callbacks.onStateChange("active", progress);
    }
    if (outCur >= t.plan.startAtSec + t.plan.durationSec) {
      completeTransition(t);
    }
  } catch {
    cancelTransition();
  }
};

export function isTransitionEngaged(): boolean {
  return transition !== null;
}

export function isTransitionActive(): boolean {
  return transition !== null && transition.started;
}

export async function armTransition(req: TransitionRequest): Promise<void> {
  cancelTransition();
  flushPendingCancelPark();

  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => undefined);
  }
  routeElement(req.outgoing.el);
  routeElement(req.incoming.el);

  const incomingEl = req.incoming.el;
  const pitchEl = incomingEl as PitchCapableElement;
  if ("preservesPitch" in pitchEl) pitchEl.preservesPitch = req.preservePitch;
  if ("webkitPreservesPitch" in pitchEl) pitchEl.webkitPreservesPitch = req.preservePitch;
  incomingEl.playbackRate = req.plan.rate;

  const now = audioContext.currentTime;
  const inChain = getChain(incomingEl);
  if (inChain) {
    inChain.gain.gain.cancelScheduledValues(now);
    inChain.gain.gain.setValueAtTime(0, now);
    inChain.lowShelf.gain.cancelScheduledValues(now);
    inChain.lowShelf.gain.setValueAtTime(
      req.plan.mode === "beatmatch" ? BASS_KILL_DB : 0,
      now
    );
  }
  const outChain = getChain(req.outgoing.el);
  if (outChain) setChainNeutral(outChain);

  const t: ActiveTransition = {
    plan: req.plan,
    incomingEl,
    outgoingEl: req.outgoing.el,
    callbacks: req.callbacks,
    started: false,
    starting: false,
    frozen: false,
    watcherId: null,
    lastProgressEmitMs: 0,
  };
  transition = t;

  try {
    const metadataLoaded = waitForLoadedMetadata(incomingEl, METADATA_TIMEOUT_MS);
    incomingEl.src = req.incoming.srcUrl;
    incomingEl.load();
    await metadataLoaded;
    incomingEl.currentTime = Math.max(0, req.plan.cueInSec);
    incomingEl.pause();
  } catch (error) {
    if (transition === t) cancelTransition();
    throw error instanceof Error ? error : new Error("Failed to arm transition");
  }
  if (transition !== t) {
    throw new Error("Transition cancelled while arming");
  }

  t.watcherId = window.setInterval(handleWatchTick, WATCH_INTERVAL_MS);
  t.callbacks.onStateChange("armed", 0);
}

export function cancelTransition(): void {
  stopRateEase();
  const t = transition;
  if (!t) return;
  stopWatcher(t);
  transition = null;

  const inChain = getChain(t.incomingEl);
  const outChain = getChain(t.outgoingEl);
  const parkIncoming = () => {
    parkElement(t.incomingEl);
    if (inChain) setChainNeutral(inChain);
  };

  if (!t.started || !audioContext) {
    // Armed only: the incoming deck never became audible.
    parkIncoming();
    if (outChain) setChainNeutral(outChain);
    t.callbacks.onStateChange("cancelled", 0);
    return;
  }

  // Active: quick ramp back to the outgoing deck, then park the incoming one.
  const rampEnd = audioContext.currentTime + CANCEL_RAMP_SEC;
  if (inChain) {
    holdParam(inChain.gain.gain);
    inChain.gain.gain.linearRampToValueAtTime(0, rampEnd);
    holdParam(inChain.lowShelf.gain);
  }
  if (outChain) {
    holdParam(outChain.gain.gain);
    outChain.gain.gain.linearRampToValueAtTime(1, rampEnd);
    holdParam(outChain.lowShelf.gain);
    outChain.lowShelf.gain.linearRampToValueAtTime(0, rampEnd);
  }
  flushPendingCancelPark();
  pendingCancelPark = parkIncoming;
  cancelCleanupTimerId = window.setTimeout(() => {
    cancelCleanupTimerId = null;
    pendingCancelPark = null;
    parkIncoming();
  }, CANCEL_RAMP_SEC * 1000 + 50);
  t.callbacks.onStateChange("cancelled", 0);
}

export function notifyOutgoingEnded(): void {
  const t = transition;
  if (!t) return;
  if (!t.started) {
    // The outgoing track ended before the transition window was reached;
    // start the incoming deck immediately and hand off.
    void t.incomingEl.play().catch(() => undefined);
  }
  completeTransition(t);
}

export function notifyPause(): void {
  const t = transition;
  if (!t) return;
  t.frozen = true;
  if (!t.started || !audioContext) return;
  for (const chain of [getChain(t.incomingEl), getChain(t.outgoingEl)]) {
    if (!chain) continue;
    holdParam(chain.gain.gain);
    holdParam(chain.lowShelf.gain);
  }
}

export function notifyResume(): void {
  const t = transition;
  if (!t) return;
  t.frozen = false;
  if (!t.started) return;
  if (audioContext && audioContext.state === "suspended") {
    void audioContext.resume().catch(() => undefined);
  }
  const offset = Math.max(0, t.outgoingEl.currentTime - t.plan.startAtSec);
  scheduleAutomation(t, offset);
}

export function disposeMixEngine(): void {
  stopRateEase();
  flushPendingCancelPark();
  const t = transition;
  if (t) {
    stopWatcher(t);
    transition = null;
    parkElement(t.incomingEl);
  }
  for (const chain of elementChains.values()) {
    try {
      chain.source.disconnect();
      chain.lowShelf.disconnect();
      chain.gain.disconnect();
    } catch {
      // Nodes may already be disconnected if the context is closing.
    }
  }
  elementChains.clear();
  if (audioContext) {
    void audioContext.close().catch(() => undefined);
    audioContext = null;
  }
}
