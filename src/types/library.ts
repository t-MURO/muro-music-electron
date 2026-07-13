import type { MessageKey } from "../i18n";

export type Track = {
  id: string;
  title: string;
  artist: string;
  artists?: string;
  album: string;
  trackNumber?: number;
  trackTotal?: number;
  key?: string;
  bpm?: number;
  year?: number;
  date?: string;
  dateAdded?: string;
  dateModified?: string;
  duration: string;
  durationSeconds: number;
  bitrate: string;
  rating: number;
  sourcePath: string;
  coverArtPath?: string;
  coverArtThumbPath?: string;
  genre?: string;
  comment?: string;
  label?: string;
  discNumber?: number;
  discTotal?: number;
  lastPlayedAt?: string;
  playCount: number;
};

export type TrackMetadataUpdates = {
  title?: string;
  artist?: string;
  artists?: string;
  album?: string;
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
  year?: number;
  genre?: string;
  comment?: string;
  label?: string;
  bpm?: number;
  key?: string;
  rating?: number;
  coverArtPath?: string;
  coverArtThumbPath?: string;
};

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
};

export type ColumnKey =
  | "title"
  | "artist"
  | "artists"
  | "album"
  | "trackNumber"
  | "trackTotal"
  | "key"
  | "bpm"
  | "year"
  | "date"
  | "dateAdded"
  | "dateModified"
  | "duration"
  | "bitrate"
  | "rating";

export type ColumnConfig = {
  key: ColumnKey;
  labelKey: MessageKey;
  visible: boolean;
  width: number;
};
