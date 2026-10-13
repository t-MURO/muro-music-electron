import type { Track } from "../types";

// Wait after a keystroke before asking the index.
export const QUERY_DEBOUNCE_MS = 120;

// Library changes arrive in bursts (imports, multi-track edits, background
// scans), and the visible answer for the same query stays usable meanwhile,
// so a refresh waits for the burst to settle.
export const REVISION_DEBOUNCE_MS = 400;

// Track fields that feed the search text. Keep aligned with matchesSearchQuery
// in ./search and refreshSearchText in electron/database.mjs.
const SEARCHABLE_TRACK_FIELDS: ReadonlySet<keyof Track> = new Set<keyof Track>([
  "title",
  "artist",
  "artistCredits",
  "albumArtist",
  "albumArtistCredits",
  "artists",
  "album",
  "genre",
  "comment",
  "label",
  "sourcePath",
  "year",
  "trackNumber",
  "discNumber",
  "key",
  "bpm",
]);

/** Whether a partial track update can change what a search matches. */
export const touchesSearchableFields = (updates: Partial<Track>): boolean =>
  (Object.keys(updates) as Array<keyof Track>).some((key) => SEARCHABLE_TRACK_FIELDS.has(key));

export type IndexedSearchResult = {
  /** The normalized query this answer belongs to. */
  query: string;
  /** Issue order of the request; a later request supersedes an earlier one. */
  sequence: number;
  /** null when the index had no opinion and callers use their own matcher. */
  ids: ReadonlySet<string> | null;
};

export const normalizeIndexedQuery = (query: string): string => query.trim();

/**
 * A query without an answer yet is debounced like typing; re-asking a query
 * that is already answered, because the library changed, waits longer.
 */
export const indexedSearchDelayMs = (answeredQuery: string | null, query: string): number =>
  answeredQuery === query ? REVISION_DEBOUNCE_MS : QUERY_DEBOUNCE_MS;

const sameIds = (left: ReadonlySet<string> | null, right: ReadonlySet<string> | null): boolean => {
  if (left === right) return true;
  if (!left || !right || left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
};

/**
 * Decide which answer to keep when a response arrives. Responses can resolve
 * in any order, so one is accepted only if it answers the query being shown
 * now and was issued after the answer already held for that query.
 */
export const acceptIndexedSearchResult = (
  current: IndexedSearchResult | null,
  incoming: IndexedSearchResult,
  activeQuery: string,
): IndexedSearchResult | null => {
  if (incoming.query !== activeQuery) return current;
  if (current?.query !== incoming.query) return incoming;
  if (current.sequence > incoming.sequence) return current;
  // A refresh that found the same tracks keeps the existing set so views
  // memoized on it do not refilter the library.
  if (sameIds(current.ids, incoming.ids)) {
    return { ...current, sequence: incoming.sequence };
  }
  return incoming;
};

/**
 * The ids to filter by for the query on screen. An answer for any other query
 * is hidden, so callers fall back to their own matcher until the index
 * answers the current one.
 */
export const indexedSearchMatches = (
  result: IndexedSearchResult | null,
  activeQuery: string,
): ReadonlySet<string> | null => (activeQuery && result?.query === activeQuery ? result.ids : null);
