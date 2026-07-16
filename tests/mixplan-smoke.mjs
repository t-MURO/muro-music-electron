import assert from "node:assert/strict";
import { transitionAutomationAt } from "../src/lib/mix/automation.ts";
import { MIX_BAR_OPTIONS, isDjMixFeatureAvailable } from "../src/lib/mix/config.ts";
import { planTransition } from "../src/lib/mix/plan.ts";

assert.deepEqual(MIX_BAR_OPTIONS, [4, 8, 16, 32]);
assert.equal(isDjMixFeatureAvailable(true), true);
assert.equal(isDjMixFeatureAvailable(false), false);

const grid = (bpm, firstDownbeatSec = 0.5, confidence = 0.8) => ({
  version: 1,
  bpm,
  firstBeatSec: firstDownbeatSec,
  firstDownbeatSec,
  confidence,
  analyzedAt: 1_752_000_000,
});

const approx = (actual, expected, epsilon, label) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${label}: expected ${expected} ±${epsilon}, got ${actual}`
  );
};

// 1. Matched tempos → beatmatch at rate 1, 8 bars, downbeat-aligned start.
{
  const plan = planTransition({
    gridA: grid(128),
    gridB: grid(128),
    durationASec: 300,
    durationBSec: 300,
  });
  const barSec = 4 * (60 / 128);
  assert.equal(plan.mode, "beatmatch");
  approx(plan.rate, 1, 1e-9, "rate 128->128");
  approx(plan.durationSec, 15, 1e-9, "8 bars at 128 BPM = 15 s");
  approx(plan.beatSecA, 60 / 128, 1e-9, "beatSecA");
  assert.ok(plan.startAtSec >= 0, "startAtSec >= 0");
  const barsFromDownbeat = (plan.startAtSec - 0.5) / barSec;
  approx(barsFromDownbeat, Math.round(barsFromDownbeat), 1e-6, "start lands on a downbeat");
  assert.ok(
    plan.startAtSec <= 300 - plan.durationSec - 1.5,
    "start leaves tail margin"
  );
  assert.ok(
    plan.startAtSec + barSec > 300 - plan.durationSec - 1.5,
    "start is the LATEST fitting downbeat"
  );
  approx(plan.cueInSec, 0.5, 1e-9, "cue at B's first downbeat");
}

// 2. Tempos too far apart (128 vs 172) → fade.
{
  const plan = planTransition({
    gridA: grid(128),
    gridB: grid(172),
    durationASec: 300,
    durationBSec: 300,
  });
  assert.equal(plan.mode, "fade");
  assert.equal(plan.rate, 1);
  assert.equal(plan.beatSecA, null);
  approx(plan.durationSec, 8, 1e-9, "fade duration for a 300 s track");
  approx(plan.startAtSec, 291, 1e-9, "fade startAt");
  approx(plan.bassSwapAtSec, 4, 1e-9, "fade bass swap at midpoint");
  approx(plan.bassSwapDurSec, 2, 1e-9, "fade bass swap length");
}

// 3. Octave match (128 vs 65) → beatmatch with doubled B tempo.
{
  const plan = planTransition({
    gridA: grid(128),
    gridB: grid(65),
    durationASec: 300,
    durationBSec: 300,
  });
  assert.equal(plan.mode, "beatmatch");
  approx(plan.rate, 128 / 130, 1e-9, "rate = 128 / (65 * 2)");
  approx(65 * 2 * plan.rate, 128, 1e-6, "65 * 2 * rate matches A's tempo");
}

// 4. Missing grid → fade.
{
  const plan = planTransition({
    gridA: null,
    gridB: grid(128),
    durationASec: 300,
    durationBSec: 300,
  });
  assert.equal(plan.mode, "fade");
  assert.equal(plan.beatSecA, null);
}

// 5. Short outgoing track (50 s) → fade with scaled duration.
{
  const plan = planTransition({
    gridA: grid(128),
    gridB: grid(128),
    durationASec: 50,
    durationBSec: 300,
  });
  assert.equal(plan.mode, "fade");
  approx(plan.durationSec, 5, 1e-9, "fade duration = durationA * 0.1");
  approx(plan.startAtSec, 44, 1e-9, "fade startAt for 50 s track");
}

// 6. Bars fallback: room for 4 bars but not 8 → degrade, still beatmatch.
{
  const plan = planTransition({
    gridA: grid(60, 30),
    gridB: grid(60, 0.5),
    durationASec: 60,
    durationBSec: 100,
  });
  const barSec = 4; // 60 BPM
  assert.equal(plan.mode, "beatmatch");
  approx(plan.durationSec, 4 * barSec, 1e-9, "degraded to 4 bars");
  assert.ok(plan.startAtSec >= 30, "start not before A's first downbeat");
  const barsFromDownbeat = (plan.startAtSec - 30) / barSec;
  approx(barsFromDownbeat, Math.round(barsFromDownbeat), 1e-6, "fallback start on a downbeat");
  assert.ok(plan.startAtSec <= 60 - plan.durationSec - 1.5, "fallback tail margin");
}

// 7. Bass swap sits on a whole bar inside the transition.
{
  const plans = [
    planTransition({
      gridA: grid(128),
      gridB: grid(128),
      durationASec: 300,
      durationBSec: 300,
    }),
    planTransition({
      gridA: grid(128),
      gridB: grid(128),
      durationASec: 300,
      durationBSec: 300,
      bars: 16,
    }),
    planTransition({
      gridA: grid(60, 30),
      gridB: grid(60, 0.5),
      durationASec: 60,
      durationBSec: 100,
    }),
  ];
  for (const plan of plans) {
    assert.equal(plan.mode, "beatmatch");
    const barSec = 4 * plan.beatSecA;
    const barsToSwap = plan.bassSwapAtSec / barSec;
    approx(barsToSwap, Math.round(barsToSwap), 1e-6, "bass swap on a whole bar");
    assert.ok(plan.bassSwapAtSec >= barSec, "bass swap at least one bar in");
    assert.ok(plan.bassSwapAtSec < plan.durationSec, "bass swap before transition end");
    approx(plan.bassSwapDurSec, barSec, 1e-9, "bass swap lasts one bar");
  }
}

// 8. Incoming track too short past the cue point → fade.
{
  const plan = planTransition({
    gridA: grid(128),
    gridB: grid(128, 10),
    durationASec: 300,
    durationBSec: 45,
    bars: 16,
  });
  assert.equal(plan.mode, "fade");
}

// 9. A 32-bar transition is honored when both tracks have enough room.
{
  const plan = planTransition({
    gridA: grid(128),
    gridB: grid(128),
    durationASec: 300,
    durationBSec: 300,
    bars: 32,
  });
  assert.equal(plan.mode, "beatmatch");
  approx(plan.durationSec, 60, 1e-9, "32 bars at 128 BPM = 60 s");
  approx(plan.bassSwapAtSec, 30, 1e-9, "32-bar bass swap starts halfway");
}

// 10. A requested 32-bar transition degrades to 16 bars before shorter fallbacks.
{
  const plan = planTransition({
    gridA: grid(128, 30),
    gridB: grid(128),
    durationASec: 70,
    durationBSec: 300,
    bars: 32,
  });
  assert.equal(plan.mode, "beatmatch");
  approx(plan.durationSec, 30, 1e-9, "32-bar request falls back to 16 bars");
}

// 11. Transition gains remain complementary so two mastered tracks cannot
// exceed unity merely because the crossfade overlaps them.
for (const plan of [
  planTransition({
    gridA: grid(128),
    gridB: grid(128),
    durationASec: 300,
    durationBSec: 300,
    bars: 32,
  }),
  planTransition({
    gridA: grid(128),
    gridB: grid(172),
    durationASec: 300,
    durationBSec: 300,
  }),
  planTransition({
    gridA: grid(60, 46),
    gridB: grid(60),
    durationASec: 60,
    durationBSec: 100,
    bars: 4,
  }),
]) {
  for (let sample = 0; sample <= 200; sample += 1) {
    const offset = plan.durationSec * sample / 200;
    const automation = transitionAutomationAt(plan, offset);
    assert.ok(automation.incomingGain >= 0 && automation.incomingGain <= 1);
    assert.ok(automation.outgoingGain >= 0 && automation.outgoingGain <= 1);
    approx(
      automation.incomingGain + automation.outgoingGain,
      1,
      1e-9,
      `complementary gain at ${offset.toFixed(3)} s`,
    );
  }
  const start = transitionAutomationAt(plan, 0);
  const end = transitionAutomationAt(plan, plan.durationSec);
  assert.deepEqual(
    [start.incomingGain, start.outgoingGain, end.incomingGain, end.outgoingGain],
    [0, 1, 1, 0],
  );
}

console.log("Mix plan smoke test passed.");
