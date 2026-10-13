import { useEffect, useRef, useState } from "react";
import { invoke } from "@muro/desktop/runtime";
import {
  acceptIndexedSearchResult,
  indexedSearchDelayMs,
  indexedSearchMatches,
  normalizeIndexedQuery,
  type IndexedSearchResult,
} from "../utils/indexedSearch";

/**
 * Resolves a search query through the SQLite full-text index instead of
 * re-normalizing every track's text on each keystroke.
 *
 * Returns the matching ids as a Set, or null while no query is active or the
 * index has not answered the current query yet — callers treat null as "do not
 * filter" and can fall back to their in-memory matcher.
 *
 * `revision` changes whenever the library's searchable data does; the active
 * query is then asked again so imports, edits and deletes show up.
 */
export const useIndexedSearch = (query: string, revision = 0) => {
  const activeQuery = normalizeIndexedQuery(query);
  const [result, setResult] = useState<IndexedSearchResult | null>(null);
  const [pending, setPending] = useState(false);
  const sequenceRef = useRef(0);
  const activeQueryRef = useRef(activeQuery);
  // The query the held answer belongs to, read when choosing a debounce.
  const answeredQueryRef = useRef<string | null>(null);

  useEffect(() => {
    answeredQueryRef.current = result?.query ?? null;
  }, [result]);

  useEffect(() => {
    activeQueryRef.current = activeQuery;
    if (!activeQuery) {
      sequenceRef.current += 1;
      setResult(null);
      setPending(false);
      return;
    }

    const sequence = ++sequenceRef.current;
    const delayMs = indexedSearchDelayMs(answeredQueryRef.current, activeQuery);
    setPending(true);

    const timer = setTimeout(() => {
      void (async () => {
        let ids: ReadonlySet<string> | null;
        try {
          const found = await invoke<string[] | null>("search_tracks", {
            query: activeQuery,
          });
          // null means the index had no opinion (no searchable terms, or an
          // expression it could not evaluate); fall back to the local matcher
          // rather than showing an empty library.
          ids = found === null ? null : new Set(found);
        } catch {
          // The in-memory matcher covers the query until the index responds
          // again.
          ids = null;
        }
        setResult((current) =>
          acceptIndexedSearchResult(
            current,
            { query: activeQuery, sequence, ids },
            activeQueryRef.current,
          ),
        );
        if (sequenceRef.current === sequence) setPending(false);
      })();
    }, delayMs);

    return () => clearTimeout(timer);
  }, [activeQuery, revision]);

  return { matchedIds: indexedSearchMatches(result, activeQuery), pending };
};
