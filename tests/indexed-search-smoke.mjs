import assert from "node:assert/strict";
import {
  QUERY_DEBOUNCE_MS,
  REVISION_DEBOUNCE_MS,
  acceptIndexedSearchResult,
  indexedSearchDelayMs,
  indexedSearchMatches,
  normalizeIndexedQuery,
  touchesSearchableFields,
} from "../src/utils/indexedSearch.ts";

const answer = (query, sequence, ids) => ({
  query,
  sequence,
  ids: ids === null ? null : new Set(ids),
});

// Surrounding whitespace does not make a new query.
assert.equal(normalizeIndexedQuery("  moon "), "moon");
assert.equal(normalizeIndexedQuery("   "), "");

// An answer is only shown for the query it belongs to. While the user types
// "moo" -> "moon", the "moo" answer is hidden so callers fall back to their
// own matcher instead of showing the previous query's results.
{
  const moo = answer("moo", 1, ["a", "b"]);
  assert.deepEqual([...indexedSearchMatches(moo, "moo")], ["a", "b"]);
  assert.equal(indexedSearchMatches(moo, "moon"), null);
  assert.equal(indexedSearchMatches(moo, ""), null, "no query means no filter");
  assert.equal(indexedSearchMatches(null, "moo"), null);
  assert.equal(
    indexedSearchMatches(answer("moo", 1, null), "moo"),
    null,
    "an index with no opinion leaves filtering to the caller",
  );
}

// A response for a query the user has already moved past is ignored.
{
  const current = answer("moon", 2, ["a"]);
  const late = answer("moo", 1, ["a", "b"]);
  assert.equal(acceptIndexedSearchResult(current, late, "moon"), current);
  assert.equal(acceptIndexedSearchResult(null, late, "moon"), null);
}

// Out-of-order responses for the same query cannot overwrite a newer one: a
// library change re-runs the query, and the older request may resolve last.
{
  const refreshed = answer("moon", 5, ["a", "new"]);
  const stale = answer("moon", 4, ["a"]);
  assert.equal(acceptIndexedSearchResult(refreshed, stale, "moon"), refreshed);
  const accepted = acceptIndexedSearchResult(stale, refreshed, "moon");
  assert.equal(accepted, refreshed, "a newer answer replaces an older one");
}

// The first answer for a new query replaces the previous query's answer, even
// if that answer came from a later request (typing back to an earlier query).
{
  const ab = answer("ab", 2, ["x"]);
  const a = answer("a", 1, ["x", "y"]);
  assert.equal(acceptIndexedSearchResult(ab, a, "a"), a);
}

// A refresh that finds the same tracks keeps the existing set, so views
// memoized on it do not refilter, but still records the newer sequence so an
// older response cannot slip in afterwards.
{
  const held = answer("moon", 3, ["a", "b"]);
  const same = answer("moon", 6, ["b", "a"]);
  const kept = acceptIndexedSearchResult(held, same, "moon");
  assert.equal(kept.ids, held.ids, "an unchanged answer keeps its identity");
  assert.equal(kept.sequence, 6);
  const older = answer("moon", 5, ["c"]);
  assert.equal(acceptIndexedSearchResult(kept, older, "moon"), kept);
}

// A changed query is debounced like typing; re-asking an answered query after
// a library change waits for the burst of updates to settle.
assert.equal(indexedSearchDelayMs(null, "moon"), QUERY_DEBOUNCE_MS);
assert.equal(indexedSearchDelayMs("moo", "moon"), QUERY_DEBOUNCE_MS);
assert.equal(indexedSearchDelayMs("moon", "moon"), REVISION_DEBOUNCE_MS);
assert.ok(REVISION_DEBOUNCE_MS > QUERY_DEBOUNCE_MS);

// Only updates to searchable fields should trigger a re-search.
assert.equal(touchesSearchableFields({ title: "New" }), true);
assert.equal(touchesSearchableFields({ bpm: 128, key: "8A" }), true);
assert.equal(touchesSearchableFields({ sourcePath: "/music/renamed.mp3" }), true);
assert.equal(
  touchesSearchableFields({ sampleRate: 44_100, bitDepth: 16, fileSize: 1 }),
  false,
  "technical scan batches do not re-run the search",
);
assert.equal(touchesSearchableFields({ playCount: 3, lastPlayedAt: "now" }), false);
assert.equal(touchesSearchableFields({}), false);

console.log("indexed-search-smoke: all assertions passed");
