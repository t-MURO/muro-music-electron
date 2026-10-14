import assert from "node:assert/strict";
import {
  RECORD_PLAY_RETRY_DELAYS_MS,
  hasReachedScrobbleThreshold,
  isPlayRestart,
  retryWithBackoff,
  revertRecentlyPlayed,
  revertRecordedPlay,
  scrobbleThresholdSeconds,
} from "../src/utils/playTracking.ts";
import { scrobbleThresholdSeconds as mainProcessScrobbleThreshold } from "../electron/scrobbling/scrobbleService.mjs";

// Restarting, replaying or repeat-one jumps back to the start of the track.
assert.equal(isPlayRestart(240, 0), true);
assert.equal(isPlayRestart(31, 0.3), true);
// Ordinary progress, small corrections and seeks within the track are not.
assert.equal(isPlayRestart(30, 30.25), false);
assert.equal(isPlayRestart(30.5, 30), false);
assert.equal(isPlayRestart(120, 45), false);
assert.equal(isPlayRestart(1.5, 0), false);

// A failing record is retried a bounded number of times, then gives up.
{
  let attempts = 0;
  const waits = [];
  await assert.rejects(
    retryWithBackoff(
      async () => {
        attempts += 1;
        throw new Error(`record failed ${attempts}`);
      },
      RECORD_PLAY_RETRY_DELAYS_MS,
      async (delayMs) => {
        waits.push(delayMs);
      },
    ),
    new RegExp(`record failed ${RECORD_PLAY_RETRY_DELAYS_MS.length + 1}`),
  );
  assert.equal(attempts, RECORD_PLAY_RETRY_DELAYS_MS.length + 1);
  assert.deepEqual(waits, [...RECORD_PLAY_RETRY_DELAYS_MS]);
  assert.ok(waits.every((delay, index) => index === 0 || delay > waits[index - 1]));
}

// A transient failure is recovered by a retry.
{
  let attempts = 0;
  const result = await retryWithBackoff(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("database busy");
      return { historyId: 7 };
    },
    RECORD_PLAY_RETRY_DELAYS_MS,
    async () => undefined,
  );
  assert.deepEqual(result, { historyId: 7 });
  assert.equal(attempts, 3);
}

const track = (overrides) => ({
  id: "track-1",
  title: "Track",
  artist: "Artist",
  album: "Album",
  sourcePath: "C:/music/track.flac",
  durationSeconds: 200,
  playCount: 4,
  lastPlayedAt: "2026-10-01T10:00:00.000Z",
  ...overrides,
});

const play = {
  trackId: "track-1",
  playedAt: "2026-10-13T12:00:00.000Z",
  previousLastPlayedAt: "2026-10-01T10:00:00.000Z",
};

// Rolling back restores the count and last-played time this play changed.
{
  const reverted = revertRecordedPlay(track({ playCount: 5, lastPlayedAt: play.playedAt }), play);
  assert.equal(reverted.playCount, 4);
  assert.equal(reverted.lastPlayedAt, "2026-10-01T10:00:00.000Z");

  const other = track({ id: "track-2", playCount: 9 });
  assert.equal(revertRecordedPlay(other, play), other);

  // A later play's timestamp is kept; only this play's increment is undone.
  const laterPlay = revertRecordedPlay(
    track({ playCount: 6, lastPlayedAt: "2026-10-13T12:05:00.000Z" }),
    play,
  );
  assert.equal(laterPlay.playCount, 5);
  assert.equal(laterPlay.lastPlayedAt, "2026-10-13T12:05:00.000Z");

  assert.equal(revertRecordedPlay(track({ playCount: 0 }), play).playCount, 0);
}

// Recently played drops a never-recorded first play and reverts a replay.
{
  const others = [track({ id: "track-2" }), track({ id: "track-3" })];
  const firstPlay = { ...play, previousLastPlayedAt: undefined };
  const afterFirst = revertRecentlyPlayed(
    [track({ playCount: 1, lastPlayedAt: play.playedAt }), ...others],
    firstPlay,
  );
  assert.deepEqual(
    afterFirst.map((item) => item.id),
    ["track-2", "track-3"],
  );

  const afterReplay = revertRecentlyPlayed(
    [track({ playCount: 5, lastPlayedAt: play.playedAt }), ...others],
    play,
  );
  assert.deepEqual(
    afterReplay.map((item) => item.id),
    ["track-1", "track-2", "track-3"],
  );
  assert.equal(afterReplay[0].playCount, 4);
  assert.equal(afterReplay[0].lastPlayedAt, "2026-10-01T10:00:00.000Z");
}

// Scrobbling: longer than 30 s, then half the track or four minutes.
{
  assert.equal(scrobbleThresholdSeconds(30), null);
  assert.equal(scrobbleThresholdSeconds(0), null);
  assert.equal(scrobbleThresholdSeconds(undefined), null);
  assert.equal(scrobbleThresholdSeconds(45), 22.5);
  assert.equal(scrobbleThresholdSeconds(200), 100);
  assert.equal(scrobbleThresholdSeconds(1200), 240);
  assert.equal(hasReachedScrobbleThreshold(99.9, 200), false);
  assert.equal(hasReachedScrobbleThreshold(100, 200), true);
  assert.equal(hasReachedScrobbleThreshold(240, 3600), true);
  assert.equal(hasReachedScrobbleThreshold(600, 30), false);
  // The renderer and the main process apply the same rule.
  for (const duration of [0, 29, 30, 30.5, 31, 61, 200, 479, 480, 481, 7200]) {
    assert.equal(scrobbleThresholdSeconds(duration), mainProcessScrobbleThreshold(duration));
  }
}

console.log("Play tracking smoke test passed");
