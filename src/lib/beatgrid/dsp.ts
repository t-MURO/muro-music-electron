// Pure DSP for beat-grid analysis. No DOM or browser APIs — this module must
// stay importable from plain Node (type-stripping) so tests can exercise it.
import type { BeatGrid } from "./types.ts";

export type OnsetEnvelope = { envelope: Float32Array; frameRate: number };

const FRAME_SIZE = 1024;
const HOP_SIZE = 256;
const LOW_BAND_HZ = 160;
const MIN_ANALYSIS_SECONDS = 15;

// Spectral flux reacts as a transient enters the (Hann-weighted) analysis
// window, so envelope frames lead the true onset by a roughly constant amount.
// This offset re-anchors envelope frame indices to audio time; it was
// calibrated against synthesized click tracks with known beat positions.
const ENVELOPE_LATENCY_SEC = 0.0725;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const hannWindow: Float32Array = (() => {
  const window = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1)));
  }
  return window;
})();

// In-place iterative radix-2 Cooley-Tukey FFT. Lengths must be powers of two.
const fftInPlace = (real: Float32Array, imag: Float32Array): void => {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tempReal = real[i];
      real[i] = real[j];
      real[j] = tempReal;
      const tempImag = imag[i];
      imag[i] = imag[j];
      imag[j] = tempImag;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      for (let k = 0; k < half; k += 1) {
        const evenReal = real[i + k];
        const evenImag = imag[i + k];
        const oddReal = real[i + k + half] * curReal - imag[i + k + half] * curImag;
        const oddImag = real[i + k + half] * curImag + imag[i + k + half] * curReal;
        real[i + k] = evenReal + oddReal;
        imag[i + k] = evenImag + oddImag;
        real[i + k + half] = evenReal - oddReal;
        imag[i + k + half] = evenImag - oddImag;
        const nextReal = curReal * stepReal - curImag * stepImag;
        curImag = curReal * stepImag + curImag * stepReal;
        curReal = nextReal;
      }
    }
  }
};

// Light 3-point smoothing, then remove the global mean and floor at zero so
// only salient onsets remain.
const finalizeEnvelope = (raw: Float32Array): Float32Array => {
  const n = raw.length;
  const smoothed = new Float32Array(n);
  for (let t = 0; t < n; t += 1) {
    const prev = t > 0 ? raw[t - 1] : raw[t];
    const next = t < n - 1 ? raw[t + 1] : raw[t];
    smoothed[t] = (prev + 2 * raw[t] + next) / 4;
  }
  let mean = 0;
  for (let t = 0; t < n; t += 1) mean += smoothed[t];
  mean = n > 0 ? mean / n : 0;
  for (let t = 0; t < n; t += 1) smoothed[t] = Math.max(0, smoothed[t] - mean);
  return smoothed;
};

const interpolate = (values: Float32Array, position: number): number => {
  const index = Math.floor(position);
  if (index < 0 || index >= values.length) return 0;
  const fraction = position - index;
  const next = index + 1 < values.length ? values[index + 1] : values[index];
  return values[index] * (1 - fraction) + next * fraction;
};

export function computeOnsetEnvelopes(
  samples: Float32Array,
  sampleRate: number,
): { full: OnsetEnvelope; low: OnsetEnvelope } {
  const frameRate = sampleRate / HOP_SIZE;
  const frameCount = samples.length >= FRAME_SIZE
    ? Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1
    : 0;
  const fullFlux = new Float32Array(Math.max(0, frameCount));
  const lowFlux = new Float32Array(Math.max(0, frameCount));
  const binCount = FRAME_SIZE / 2 + 1;
  const lowBinLimit = Math.max(
    1,
    Math.min(binCount - 1, Math.floor((LOW_BAND_HZ * FRAME_SIZE) / sampleRate)),
  );
  const real = new Float32Array(FRAME_SIZE);
  const imag = new Float32Array(FRAME_SIZE);
  let previousLog = new Float32Array(binCount);
  let currentLog = new Float32Array(binCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * HOP_SIZE;
    for (let i = 0; i < FRAME_SIZE; i += 1) {
      real[i] = samples[offset + i] * hannWindow[i];
      imag[i] = 0;
    }
    fftInPlace(real, imag);
    for (let bin = 0; bin < binCount; bin += 1) {
      const magnitude = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
      currentLog[bin] = Math.log1p(100 * magnitude);
    }
    if (frame > 0) {
      let full = 0;
      let low = 0;
      for (let bin = 1; bin < binCount; bin += 1) {
        const rise = currentLog[bin] - previousLog[bin];
        if (rise > 0) {
          full += rise;
          if (bin <= lowBinLimit) low += rise;
        }
      }
      fullFlux[frame] = full;
      lowFlux[frame] = low;
    }
    const swap = previousLog;
    previousLog = currentLog;
    currentLog = swap;
  }
  return {
    full: { envelope: finalizeEnvelope(fullFlux), frameRate },
    low: { envelope: finalizeEnvelope(lowFlux), frameRate },
  };
}

export function estimateTempo(
  envelope: OnsetEnvelope,
  opts?: { minBpm?: number; maxBpm?: number; bpmHint?: number | null },
): { bpm: number; strength: number } {
  const values = envelope.envelope;
  const frameRate = envelope.frameRate;
  const n = values.length;
  const minBpm = opts?.minBpm ?? 60;
  const maxBpm = opts?.maxBpm ?? 190;
  const bpmHint = opts?.bpmHint ?? null;
  const lagMin = Math.max(2, Math.floor((frameRate * 60) / maxBpm));
  const lagMax = Math.min(Math.floor(n / 2) - 1, Math.ceil((frameRate * 60) / minBpm));
  if (lagMax <= lagMin + 1) return { bpm: Math.min(Math.max(120, minBpm), maxBpm), strength: 0 };

  // Autocorrelation, count-normalized, out to several beat periods so the
  // winning lag can be refined against a long multiple for precision.
  const maxLag = Math.min(Math.floor(n / 2), lagMax * 8 + 4);
  const acf = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let sum = 0;
    const limit = n - lag;
    for (let t = 0; t < limit; t += 1) sum += values[t] * values[t + lag];
    acf[lag] = sum / limit;
  }
  const zeroLag = acf[0] > 0 ? acf[0] : 1;
  const normAt = (lag: number): number => {
    if (lag < 1 || lag > maxLag) return 0;
    const index = Math.floor(lag);
    const fraction = lag - index;
    const a = acf[index] / zeroLag;
    const b = index + 1 <= maxLag ? acf[index + 1] / zeroLag : a;
    return a + (b - a) * fraction;
  };

  // Mild log-normal preference for the 90-180 BPM range (centered ~127).
  const rangePrior = (bpm: number): number =>
    Math.exp(-0.5 * (Math.log2(bpm / 127) / 0.9) ** 2);
  const gaussian = (bpm: number, center: number): number =>
    Math.exp(-0.5 * (Math.log2(bpm / center) / 0.08) ** 2);
  const hintBias = (bpm: number): number => {
    if (bpmHint === null || !(bpmHint > 0)) return 1;
    return (
      1 +
      1.0 * gaussian(bpm, bpmHint) +
      0.15 * gaussian(bpm, bpmHint / 2) +
      0.15 * gaussian(bpm, bpmHint * 2)
    );
  };

  let bestLag = lagMin;
  let bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag += 1) {
    const bpm = (frameRate * 60) / lag;
    const octaveScore = normAt(lag) + 0.35 * normAt(lag * 2) + 0.35 * normAt(lag / 2);
    const score = octaveScore * rangePrior(bpm) * hintBias(bpm);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // Parabolic interpolation around the winning integer lag.
  const refineParabolic = (center: number): number => {
    const a = normAt(center - 1);
    const b = normAt(center);
    const c = normAt(center + 1);
    const denominator = a - 2 * b + c;
    if (denominator >= 0) return center;
    const delta = (0.5 * (a - c)) / denominator;
    return center + Math.min(0.5, Math.max(-0.5, delta));
  };
  let refinedLag = refineParabolic(bestLag);

  // Re-estimate against the largest usable multiple of the beat lag: the same
  // fractional-frame error divided by k gives k-times finer tempo precision.
  const multiple = Math.min(8, Math.floor((maxLag - 1) / refinedLag));
  if (multiple >= 2) {
    const target = refinedLag * multiple;
    let peak = Math.max(2, Math.round(target));
    let peakValue = -Infinity;
    const from = Math.max(2, Math.round(target) - 3);
    const to = Math.min(maxLag - 1, Math.round(target) + 3);
    for (let lag = from; lag <= to; lag += 1) {
      const value = normAt(lag);
      if (value > peakValue) {
        peakValue = value;
        peak = lag;
      }
    }
    refinedLag = refineParabolic(peak) / multiple;
  }

  const bpm = (frameRate * 60) / refinedLag;
  const strength = clamp01(normAt(refinedLag));
  return { bpm, strength };
}

export function estimateBeatPhase(
  envelope: OnsetEnvelope,
  bpm: number,
): { firstBeatSec: number; confidence: number } {
  const values = envelope.envelope;
  const frameRate = envelope.frameRate;
  const n = values.length;
  const period = (frameRate * 60) / bpm;
  if (!(period > 1) || n < period * 2) return { firstBeatSec: 0, confidence: 0 };

  // Comb sum over sub-frame phase offsets; averaging across every beat in the
  // track gives well-below-frame phase resolution.
  const steps = 192;
  const combAt = (phase: number): number => {
    let sum = 0;
    let count = 0;
    for (let position = phase; position < n; position += period) {
      sum += interpolate(values, position);
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  };
  const combValues = new Float32Array(steps);
  let bestStep = 0;
  let bestValue = -Infinity;
  let total = 0;
  for (let step = 0; step < steps; step += 1) {
    const value = combAt((step / steps) * period);
    combValues[step] = value;
    total += value;
    if (value > bestValue) {
      bestValue = value;
      bestStep = step;
    }
  }
  const before = combValues[(bestStep + steps - 1) % steps];
  const after = combValues[(bestStep + 1) % steps];
  let delta = 0;
  const denominator = before - 2 * bestValue + after;
  if (denominator < 0) {
    delta = Math.min(0.5, Math.max(-0.5, (0.5 * (before - after)) / denominator));
  }
  const phaseFrames = (((bestStep + delta + steps) % steps) / steps) * period;

  const beatSec = 60 / bpm;
  let firstBeatSec = phaseFrames / frameRate + ENVELOPE_LATENCY_SEC;
  while (firstBeatSec < 0) firstBeatSec += beatSec;
  while (firstBeatSec >= beatSec) firstBeatSec -= beatSec;

  const mean = total / steps;
  const contrast = bestValue > 0 ? (bestValue - mean) / (bestValue + mean) : 0;
  return { firstBeatSec, confidence: clamp01(contrast) };
}

export function estimateDownbeat(
  lowEnvelope: OnsetEnvelope,
  bpm: number,
  firstBeatSec: number,
): { firstDownbeatSec: number } {
  const values = lowEnvelope.envelope;
  const frameRate = lowEnvelope.frameRate;
  const n = values.length;
  const beatSec = 60 / bpm;
  const barPeriodFrames = 4 * beatSec * frameRate;
  let bestIndex = 0;
  let bestValue = -Infinity;
  for (let beat = 0; beat < 4; beat += 1) {
    const startFrames = (firstBeatSec + beat * beatSec - ENVELOPE_LATENCY_SEC) * frameRate;
    let sum = 0;
    let count = 0;
    for (let position = startFrames; position < n; position += barPeriodFrames) {
      if (position >= 0) {
        sum += interpolate(values, position);
        count += 1;
      }
    }
    const value = count > 0 ? sum / count : 0;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = beat;
    }
  }
  return { firstDownbeatSec: firstBeatSec + bestIndex * beatSec };
}

export function analyzeBeatGrid(
  samples: Float32Array,
  sampleRate: number,
  opts?: { bpmHint?: number | null },
): BeatGrid {
  if (!(sampleRate > 0) || samples.length / sampleRate < MIN_ANALYSIS_SECONDS) {
    throw new Error("Audio too short or silent for beat analysis");
  }
  const { full, low } = computeOnsetEnvelopes(samples, sampleRate);
  let peak = 0;
  for (let t = 0; t < full.envelope.length; t += 1) {
    if (full.envelope[t] > peak) peak = full.envelope[t];
  }
  if (!(peak > 0)) {
    throw new Error("Audio too short or silent for beat analysis");
  }
  const tempo = estimateTempo(full, { bpmHint: opts?.bpmHint ?? null });
  const phase = estimateBeatPhase(full, tempo.bpm);
  const downbeat = estimateDownbeat(low, tempo.bpm, phase.firstBeatSec);
  const confidence = clamp01(0.45 * tempo.strength + 0.55 * phase.confidence);
  return {
    version: 1,
    bpm: tempo.bpm,
    firstBeatSec: phase.firstBeatSec,
    firstDownbeatSec: downbeat.firstDownbeatSec,
    confidence,
    analyzedAt: Math.floor(Date.now() / 1000),
  };
}
