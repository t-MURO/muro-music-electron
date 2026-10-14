import assert from "node:assert/strict";
import {
  PLAYBACK_SESSION_VERSION,
  parsePlaybackPosition,
  parsePlaybackSession,
  prunePlaybackSession,
  serializePlaybackPosition,
  serializePlaybackSession,
} from "../src/utils/playbackSession.ts";

const session = {
  version: PLAYBACK_SESSION_VERSION,
  currentTrackId: "b",
  queue: ["c", "gone-1", "d"],
  playingNext: ["e", "gone-2", "a"],
  shuffleEnabled: true,
  repeatMode: "all",
  volume: 0.4,
  context: { path: "/collection/albums?album=x", trackIds: ["a", "b", "gone-3", "e"] },
};

// A saved session round-trips unchanged.
assert.deepEqual(parsePlaybackSession(serializePlaybackSession(session)), session);
assert.deepEqual(
  parsePlaybackPosition(serializePlaybackPosition({ trackId: "b", positionSecs: 42.5 })),
  { trackId: "b", positionSecs: 42.5 },
);

// Missing, corrupt, foreign or future-version data is ignored rather than restored.
assert.equal(parsePlaybackSession(null), null);
assert.equal(parsePlaybackSession(""), null);
assert.equal(parsePlaybackSession("{not json"), null);
assert.equal(parsePlaybackSession("[]"), null);
assert.equal(parsePlaybackSession(JSON.stringify({ ...session, version: 99 })), null);
assert.equal(parsePlaybackPosition(null), null);
assert.equal(parsePlaybackPosition(JSON.stringify({ positionSecs: 10 })), null);

// Malformed fields are repaired to safe defaults.
{
  const repaired = parsePlaybackSession(
    JSON.stringify({
      version: PLAYBACK_SESSION_VERSION,
      currentTrackId: 7,
      queue: ["a", 3, null, "", "b"],
      playingNext: "a,b",
      shuffleEnabled: "yes",
      repeatMode: "forever",
      volume: 4,
      context: { path: "https://example.com", trackIds: ["a", {}] },
    }),
  );
  assert.deepEqual(repaired, {
    version: PLAYBACK_SESSION_VERSION,
    currentTrackId: null,
    queue: ["a", "b"],
    playingNext: [],
    shuffleEnabled: false,
    repeatMode: "off",
    volume: 1,
    context: { path: null, trackIds: ["a"] },
  });
  assert.equal(parsePlaybackSession(JSON.stringify({ ...session, volume: -1 })).volume, 0);
  assert.equal(parsePlaybackSession(JSON.stringify({ ...session, context: {} })).context, null);
  assert.equal(
    parsePlaybackPosition(JSON.stringify({ trackId: "b", positionSecs: -3 })).positionSecs,
    0,
  );
}

const library = new Map(["a", "b", "c", "d", "e"].map((id) => [id, { durationSeconds: 200 }]));
const lookup = (id) => library.get(id);

// Tracks the library no longer has are dropped from every list.
{
  const restored = prunePlaybackSession(session, { trackId: "b", positionSecs: 61 }, lookup);
  assert.deepEqual(restored, {
    currentTrackId: "b",
    positionSecs: 61,
    queue: ["c", "d"],
    playingNext: ["e", "a"],
    context: { path: "/collection/albums?album=x", trackIds: ["a", "b", "e"] },
  });
}

// A removed current track still restores the queue, without a position.
{
  const restored = prunePlaybackSession(
    { ...session, currentTrackId: "gone-1" },
    { trackId: "gone-1", positionSecs: 61 },
    lookup,
  );
  assert.equal(restored.currentTrackId, null);
  assert.equal(restored.positionSecs, 0);
  assert.deepEqual(restored.queue, ["c", "d"]);
}

// The position only applies to the track it was saved for.
assert.equal(
  prunePlaybackSession(session, { trackId: "c", positionSecs: 61 }, lookup).positionSecs,
  0,
);
assert.equal(prunePlaybackSession(session, null, lookup).positionSecs, 0);

// A track saved at its very end starts over instead of ending on play.
assert.equal(
  prunePlaybackSession(session, { trackId: "b", positionSecs: 199.5 }, lookup).positionSecs,
  0,
);
assert.equal(
  prunePlaybackSession(session, { trackId: "b", positionSecs: 198 }, lookup).positionSecs,
  198,
);

// A context whose tracks are all gone is dropped entirely.
assert.equal(
  prunePlaybackSession(
    { ...session, context: { path: "/", trackIds: ["gone-1", "gone-2"] } },
    null,
    lookup,
  ).context,
  null,
);

console.log("Playback session smoke test passed.");
