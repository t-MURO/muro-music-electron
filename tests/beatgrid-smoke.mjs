import assert from "node:assert/strict";
import { analyzeBeatGrid } from "../src/lib/beatgrid/dsp.ts";

const SAMPLE_RATE = 11025;
const DURATION_SEC = 40;

// Synthesized click/kick track: a 60 Hz decaying-sine kick (80 ms) plus a
// short click transient on every beat; beat 0 of each 4-beat bar is accented
// with +6 dB and extra low-frequency content.
const synthesizeClickTrack = ({ bpm, firstBeatSec, durationSec = DURATION_SEC }) => {
  const total = Math.floor(durationSec * SAMPLE_RATE);
  const samples = new Float32Array(total);
  const beatSec = 60 / bpm;
  for (let beat = 0; ; beat += 1) {
    const beatTime = firstBeatSec + beat * beatSec;
    if (beatTime >= durationSec - 0.12) break;
    const accent = beat % 4 === 0;
    const amplitude = accent ? 1 : 0.5; // accent = +6 dB
    const start = Math.round(beatTime * SAMPLE_RATE);
    const kickLength = Math.round(0.08 * SAMPLE_RATE);
    for (let i = 0; i < kickLength && start + i < total; i += 1) {
      const t = i / SAMPLE_RATE;
      const decay = Math.exp(-t / 0.02);
      samples[start + i] += amplitude * decay * Math.sin(2 * Math.PI * 60 * t);
      if (accent) {
        samples[start + i] += 0.7 * amplitude * decay * Math.sin(2 * Math.PI * 50 * t);
      }
    }
    const clickLength = Math.round(0.005 * SAMPLE_RATE);
    for (let i = 0; i < clickLength && start + i < total; i += 1) {
      const t = i / SAMPLE_RATE;
      samples[start + i] += amplitude * Math.exp(-t / 0.0015) * Math.sin(2 * Math.PI * 3000 * t);
    }
  }
  return samples;
};

// Smallest absolute distance between a and b on a circle of the given period.
const circularErrorSec = (a, b, period) => {
  let d = (a - b) % period;
  if (d > period / 2) d -= period;
  if (d < -period / 2) d += period;
  return Math.abs(d);
};

// Test 1: 128 BPM click track, first beat (a downbeat) at 0.37 s, no hint.
{
  const truthBpm = 128;
  const truthFirstBeat = 0.37;
  const grid = analyzeBeatGrid(
    synthesizeClickTrack({ bpm: truthBpm, firstBeatSec: truthFirstBeat }),
    SAMPLE_RATE,
  );
  assert.equal(grid.version, 1);
  assert.ok(
    Math.abs(grid.bpm - truthBpm) <= 0.8,
    `128 BPM: detected ${grid.bpm}, expected within ±0.8`,
  );
  const beatSec = 60 / truthBpm;
  const beatError = circularErrorSec(grid.firstBeatSec, truthFirstBeat, beatSec);
  assert.ok(
    beatError <= 0.02,
    `128 BPM: firstBeatSec ${grid.firstBeatSec} off by ${(beatError * 1000).toFixed(1)} ms (mod beat), expected ≤ 20 ms`,
  );
  const barError = circularErrorSec(grid.firstDownbeatSec, truthFirstBeat, 4 * beatSec);
  assert.ok(
    barError <= 0.02,
    `128 BPM: firstDownbeatSec ${grid.firstDownbeatSec} off by ${(barError * 1000).toFixed(1)} ms (mod bar), expected ≤ 20 ms`,
  );
  assert.ok(grid.confidence > 0.3, `128 BPM: confidence ${grid.confidence}, expected > 0.3`);
  assert.ok(Number.isFinite(grid.analyzedAt) && grid.analyzedAt > 0);
  console.log(`test 1 ok: bpm=${grid.bpm.toFixed(3)} beatErr=${(beatError * 1000).toFixed(1)}ms barErr=${(barError * 1000).toFixed(1)}ms conf=${grid.confidence.toFixed(3)}`);
}

// Test 2: 174 BPM with bpmHint 174.
{
  const grid = analyzeBeatGrid(
    synthesizeClickTrack({ bpm: 174, firstBeatSec: 0.37 }),
    SAMPLE_RATE,
    { bpmHint: 174 },
  );
  assert.ok(
    Math.abs(grid.bpm - 174) <= 1.2,
    `174 BPM hinted: detected ${grid.bpm}, expected within ±1.2`,
  );
  console.log(`test 2 ok: bpm=${grid.bpm.toFixed(3)}`);
}

// Test 3: 87 BPM. Without a hint, octave ambiguity (87 or 174) is tolerated;
// with hint 87 the detector must settle on 87.
{
  const samples = synthesizeClickTrack({ bpm: 87, firstBeatSec: 0.37 });
  const unhinted = analyzeBeatGrid(samples.slice(), SAMPLE_RATE);
  assert.ok(
    Math.abs(unhinted.bpm - 87) <= 1 || Math.abs(unhinted.bpm - 174) <= 2,
    `87 BPM unhinted: detected ${unhinted.bpm}, expected 87±1 or 174±2`,
  );
  const hinted = analyzeBeatGrid(samples, SAMPLE_RATE, { bpmHint: 87 });
  assert.ok(
    Math.abs(hinted.bpm - 87) <= 1,
    `87 BPM hinted: detected ${hinted.bpm}, expected within ±1`,
  );
  console.log(`test 3 ok: unhinted=${unhinted.bpm.toFixed(3)} hinted=${hinted.bpm.toFixed(3)}`);
}

// Test 4: silent (and too-short) input throws.
{
  assert.throws(
    () => analyzeBeatGrid(new Float32Array(DURATION_SEC * SAMPLE_RATE), SAMPLE_RATE),
    /too short or silent/i,
    "silent input should throw",
  );
  assert.throws(
    () => analyzeBeatGrid(new Float32Array(5 * SAMPLE_RATE), SAMPLE_RATE),
    /too short or silent/i,
    "short input should throw",
  );
  console.log("test 4 ok: degenerate input throws");
}

console.log("Beat grid smoke test passed");
