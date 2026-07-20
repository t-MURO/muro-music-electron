import assert from "node:assert/strict";
import { playWithTimeout } from "../src/desktop/mediaPlayback.ts";

{
  let paused = 0;
  await playWithTimeout({
    play: async () => undefined,
    pause: () => { paused += 1; },
  }, 50);
  assert.equal(paused, 0);
}

{
  let paused = 0;
  await assert.rejects(
    playWithTimeout({
      play: () => new Promise(() => undefined),
      pause: () => { paused += 1; },
    }, 20, "Smoke playback"),
    /Smoke playback timed out/,
  );
  assert.equal(paused, 1);
}

{
  let paused = 0;
  await assert.rejects(
    playWithTimeout({
      play: async () => { throw new Error("decode failed"); },
      pause: () => { paused += 1; },
    }, 50),
    /decode failed/,
  );
  assert.equal(paused, 1);
}

console.log("Playback guard smoke test passed.");
