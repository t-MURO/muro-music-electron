// Version 2 added the phrase grid. Grids written by version 1 are rejected on
// read so they get recomputed, rather than being planned against a missing
// phrase and silently falling back to bar alignment forever.
export const BEAT_GRID_VERSION = 2;

export type BeatGrid = {
  version: 2;
  bpm: number;              // raw detected tempo (NOT octave-normalized), 60..200
  firstBeatSec: number;     // seconds, time of first detected beat
  firstDownbeatSec: number; // seconds, time of first downbeat (start of a 4-beat bar)
  phraseBars: number;       // bars per phrase (4/8/16/32), the section period
  firstPhraseSec: number;   // seconds, start of the first full phrase
  phraseConfidence: number; // 0..1; 0 when no phrase grid stood out
  confidence: number;       // 0..1
  analyzedAt: number;       // epoch seconds
};
