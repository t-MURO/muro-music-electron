declare module "essentia.js" {
  export interface EssentiaVector {
    size(): number;
    get(index: number): number;
    delete(): void;
  }

  export interface RhythmExtractorResult {
    bpm: number;
    ticks: EssentiaVector;
    estimates: EssentiaVector;
    bpmIntervals: EssentiaVector;
  }

  export interface PercivalBpmEstimatorResult {
    bpm: number;
  }

  export interface KeyExtractorResult {
    key: string;
    scale: string;
    strength: number;
  }

  export interface EssentiaWASMModule {
    EssentiaJS: new (isDebug?: boolean) => unknown;
  }

  export class Essentia {
    constructor(wasmModule: EssentiaWASMModule, isDebug?: boolean);

    arrayToVector(array: Float32Array): EssentiaVector;
    vectorToArray(vector: EssentiaVector): Float32Array;

    RhythmExtractor2013(signal: EssentiaVector): RhythmExtractorResult;
    PercivalBpmEstimator(signal: EssentiaVector): PercivalBpmEstimatorResult;
    KeyExtractor(signal: EssentiaVector): KeyExtractorResult;
  }

  // EssentiaWASM is already the loaded WASM module (not a function)
  export const EssentiaWASM: EssentiaWASMModule;
}

declare module "essentia.js/dist/essentia.js-core.es.js" {
  export interface EssentiaVector {
    size(): number;
    get(index: number): number;
    delete(): void;
  }

  export interface RhythmExtractorResult {
    bpm: number;
    ticks: EssentiaVector;
    estimates: EssentiaVector;
    bpmIntervals: EssentiaVector;
  }

  export interface PercivalBpmEstimatorResult {
    bpm: number;
  }

  export interface KeyExtractorResult {
    key: string;
    scale: string;
    strength: number;
  }

  export default class Essentia {
    constructor(wasmModule: unknown, isDebug?: boolean);

    arrayToVector(array: Float32Array): EssentiaVector;
    vectorToArray(vector: EssentiaVector): Float32Array;

    RhythmExtractor2013(signal: EssentiaVector): RhythmExtractorResult;
    PercivalBpmEstimator(signal: EssentiaVector): PercivalBpmEstimatorResult;
    KeyExtractor(signal: EssentiaVector): KeyExtractorResult;
  }
}

declare module "essentia.js/dist/essentia-wasm.es.js" {
  // The ES build exports the already-instantiated WASM module
  export const EssentiaWASM: unknown;
}
