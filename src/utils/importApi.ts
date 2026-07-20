import { invoke } from "@muro/desktop/runtime";
import type { Track } from "../types";
import type { BeatGrid } from "../lib/beatgrid/types";

// ============================================================================
// Types
// ============================================================================

export type ImportedTrack = {
  id: string;
  title: string;
  artist: string;
  artists?: string;
  album: string;
  track_number?: number;
  track_total?: number;
  key?: string;
  bpm?: number;
  year?: number;
  date?: string;
  date_added?: string;
  date_modified?: string;
  duration: string;
  duration_seconds: number;
  bitrate: string;
  sample_rate_hz?: number;
  bit_depth?: number;
  file_size_bytes?: number;
  rating: number;
  source_path: string;
  cover_art_path?: string;
  cover_art_thumb_path?: string;
  genre?: string;
  comment?: string;
  label?: string;
  disc_number?: number;
  disc_total?: number;
  last_played_at?: string;
  play_count: number;
  beat_grid_json?: string | null;
};

export type LibrarySnapshot = {
  library: ImportedTrack[];
  inbox: ImportedTrack[];
};

export type PlaylistSnapshot = {
  playlists: {
    id: string;
    name: string;
    folder_id: string | null;
    sort_order: number;
    track_ids: string[];
  }[];
  folders: {
    id: string;
    name: string;
    parent_id: string | null;
    sort_order: number;
  }[];
};

export type ImportedPlaylistFile = {
  name: string;
  entries: Array<{
    path: string;
    track_id: string | null;
    exists: boolean;
  }>;
};

export type ImportFilesResult = {
  imported: ImportedTrack[];
  scanned: number;
  failures: Array<{ path: string; message: string }>;
};

// ============================================================================
// Import Operations
// ============================================================================

export const importFiles = (dbPath: string, paths: string[]) => {
  return invoke<ImportFilesResult>("import_files", {
    paths,
    dbPath,
  });
};

// ============================================================================
// Type Conversion
// ============================================================================

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parseBeatGrid = (raw?: string | null): BeatGrid | undefined => {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const candidate = parsed as Partial<BeatGrid>;
    if (
      candidate.version === 1 &&
      isFiniteNumber(candidate.bpm) &&
      isFiniteNumber(candidate.firstBeatSec) &&
      isFiniteNumber(candidate.firstDownbeatSec) &&
      isFiniteNumber(candidate.confidence)
    ) {
      return candidate as BeatGrid;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Converts the database transfer object to the renderer's Track shape.
 */
export const importedTrackToTrack = (imported: ImportedTrack): Track => ({
  id: imported.id,
  title: imported.title,
  artist: imported.artist,
  artists: imported.artists,
  album: imported.album,
  trackNumber: imported.track_number,
  trackTotal: imported.track_total,
  key: imported.key,
  bpm: imported.bpm,
  year: imported.year,
  date: imported.date,
  dateAdded: imported.date_added,
  dateModified: imported.date_modified,
  duration: imported.duration,
  durationSeconds: imported.duration_seconds,
  bitrate: imported.bitrate,
  sampleRate: imported.sample_rate_hz,
  bitDepth: imported.bit_depth,
  fileSize: imported.file_size_bytes,
  rating: imported.rating,
  sourcePath: imported.source_path,
  coverArtPath: imported.cover_art_path,
  coverArtThumbPath: imported.cover_art_thumb_path,
  genre: imported.genre,
  comment: imported.comment,
  label: imported.label,
  discNumber: imported.disc_number,
  discTotal: imported.disc_total,
  lastPlayedAt: imported.last_played_at,
  playCount: imported.play_count,
  beatGrid: parseBeatGrid(imported.beat_grid_json),
});
