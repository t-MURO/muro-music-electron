import type { Track } from "../types";

/**
 * Normalize a string for search comparison.
 * Converts to lowercase, removes accents, and normalizes whitespace.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^\w\s]/g, " ") // Replace punctuation with spaces
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

/**
 * Check if a track matches a search query.
 * Searches across title, artist, album, and year.
 */
export function matchesSearchQuery(track: Track, query: string): boolean {
  if (!query.trim()) {
    return true;
  }

  const normalizedQuery = normalizeText(query);
  const queryTerms = normalizedQuery.split(" ").filter(Boolean);

  // Build searchable text from track fields
  const searchableFields = [
    track.title,
    track.artist,
    track.album,
    track.year?.toString(),
    track.key,
    track.bpm?.toString(),
  ].filter(Boolean);

  const normalizedTrackText = normalizeText(searchableFields.join(" "));

  // All query terms must match somewhere in the track text
  return queryTerms.every((term) => normalizedTrackText.includes(term));
}

/**
 * Filter tracks by search query.
 */
export function filterTracksBySearch(tracks: Track[], query: string): Track[] {
  if (!query.trim()) {
    return tracks;
  }

  return tracks.filter((track) => matchesSearchQuery(track, query));
}
