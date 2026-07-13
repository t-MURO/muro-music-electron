// Import Essentia core and WASM module (ES build has WASM inlined)
import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import { toCamelot } from "./camelot";
import { convertFileSrc } from "@muro/desktop/runtime";

// Default BPM range for electronic/techno
const DEFAULT_BPM_MIN = 100;
const DEFAULT_BPM_MAX = 180;

// Analysis duration in seconds (analyzing full track is slow, 60s is enough for BPM/key)
const ANALYSIS_DURATION_SECONDS = 60;
const SAMPLE_RATE = 44100;

export interface AnalysisResult {
  bpm: number;
  key: string;
  scale: string;
  camelot: string;
}

export interface AnalysisOptions {
  bpmMin?: number;
  bpmMax?: number;
  signal?: AbortSignal;
}

export interface BpmRange {
  min: number;
  max: number;
  label: string;
}

export const BPM_RANGES: BpmRange[] = [
  { min: 100, max: 180, label: "Electronic (100-180)" },
  { min: 70, max: 140, label: "Hip-Hop (70-140)" },
  { min: 60, max: 120, label: "Slow (60-120)" },
  { min: 120, max: 200, label: "Fast (120-200)" },
  { min: 60, max: 200, label: "Wide (60-200)" },
];

// Singleton instance of Essentia (promise-based to avoid race conditions)
let essentiaPromise: Promise<Essentia> | null = null;

export function initEssentia(): Promise<Essentia> {
  if (!essentiaPromise) {
    essentiaPromise = Promise.resolve().then(() => {
      // The ES build exports EssentiaWASM directly as the loaded module
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Essentia(EssentiaWASM as any);
    });
  }
  return essentiaPromise;
}

export function normalizeBpm(
  bpm: number,
  min: number = DEFAULT_BPM_MIN,
  max: number = DEFAULT_BPM_MAX
): number {
  if (bpm <= 0) return 0;
  let result = bpm;
  while (result < min && result > 0) result *= 2;
  while (result > max) result /= 2;
  return result;
}

// Check if aborted and throw if so
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Analysis cancelled", "AbortError");
  }
}

async function decodeAudioFile(
  filePath: string,
  signal?: AbortSignal
): Promise<Float32Array> {
  checkAborted(signal);

  // Convert the local file path to the desktop asset URL.
  const assetUrl = convertFileSrc(filePath);

  // Fetch the audio file (supports abort signal)
  const response = await fetch(assetUrl, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch audio file: ${response.statusText}`);
  }

  checkAborted(signal);

  const arrayBuffer = await response.arrayBuffer();

  checkAborted(signal);

  // Decode audio using Web Audio API
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    checkAborted(signal);

    // Calculate sample range - take from middle of track for better representation
    const totalSamples = audioBuffer.length;
    const maxSamples = ANALYSIS_DURATION_SECONDS * SAMPLE_RATE;
    const samplesToUse = Math.min(totalSamples, maxSamples);

    // Start from middle of track minus half the analysis duration
    const startSample = Math.max(
      0,
      Math.floor((totalSamples - samplesToUse) / 2)
    );

    // Convert to mono by averaging channels
    const numChannels = audioBuffer.numberOfChannels;
    const monoSamples = new Float32Array(samplesToUse);

    if (numChannels === 1) {
      const channelData = audioBuffer.getChannelData(0);
      monoSamples.set(channelData.subarray(startSample, startSample + samplesToUse));
    } else {
      // Average all channels
      for (let ch = 0; ch < numChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < samplesToUse; i++) {
          monoSamples[i] += channelData[startSample + i] / numChannels;
        }
      }
    }

    return monoSamples;
  } finally {
    await audioContext.close();
  }
}

export async function analyzeTrack(
  filePath: string,
  options: AnalysisOptions = {}
): Promise<AnalysisResult> {
  const { bpmMin = DEFAULT_BPM_MIN, bpmMax = DEFAULT_BPM_MAX, signal } = options;

  checkAborted(signal);

  const essentia = await initEssentia();
  const samples = await decodeAudioFile(filePath, signal);

  checkAborted(signal);

  // Convert to Essentia vector
  const audioVector = essentia.arrayToVector(samples);

  try {
    // BPM Detection
    let bpm = 0;
    try {
      const rhythm = essentia.RhythmExtractor2013(audioVector);
      bpm = normalizeBpm(rhythm.bpm, bpmMin, bpmMax);
      // Clean up result vectors to avoid memory leak
      rhythm.ticks?.delete?.();
      rhythm.estimates?.delete?.();
      rhythm.bpmIntervals?.delete?.();
    } catch (e) {
      console.debug("RhythmExtractor2013 failed, trying PercivalBpmEstimator:", e);
      try {
        const percival = essentia.PercivalBpmEstimator(audioVector);
        bpm = normalizeBpm(percival.bpm, bpmMin, bpmMax);
      } catch (e2) {
        console.debug("BPM detection failed:", e2);
      }
    }

    checkAborted(signal);

    // Key Detection
    let key = "Unknown";
    let scale = "";
    let camelot = "?";

    try {
      const keyResult = essentia.KeyExtractor(audioVector);
      key = keyResult.key;
      scale = keyResult.scale;
      camelot = toCamelot(key, scale);
    } catch (e) {
      console.debug("Key detection failed:", e);
    }

    return { bpm, key, scale, camelot };
  } finally {
    // Clean up WASM memory
    audioVector.delete();
  }
}

// Analyze multiple tracks with progress callback and cancellation support
export async function analyzeTracksWithProgress(
  filePaths: string[],
  options: AnalysisOptions = {},
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, AnalysisResult>> {
  const results = new Map<string, AnalysisResult>();

  for (let i = 0; i < filePaths.length; i++) {
    // Check for cancellation before each track
    if (options.signal?.aborted) {
      break;
    }

    const filePath = filePaths[i];
    try {
      const result = await analyzeTrack(filePath, options);
      results.set(filePath, result);
    } catch (error) {
      // Re-throw abort errors to stop the loop
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      console.error(`Failed to analyze ${filePath}:`, error);
      results.set(filePath, {
        bpm: 0,
        key: "Error",
        scale: "",
        camelot: "?",
      });
    }

    onProgress?.(i + 1, filePaths.length);
  }

  return results;
}
