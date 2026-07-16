export const BEAT_GRID_VERSION = 1;

export type BeatGrid = {
  version: 1;
  bpm: number;              // raw detected tempo (NOT octave-normalized), 60..200
  firstBeatSec: number;     // seconds, time of first detected beat
  firstDownbeatSec: number; // seconds, time of first downbeat (start of a 4-beat bar)
  confidence: number;       // 0..1
  analyzedAt: number;       // epoch seconds
};
