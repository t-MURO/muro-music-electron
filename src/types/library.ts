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
  folderId?: string;
};

export type PlaylistFolder = {
  id: string;
  name: string;
};

export type ArtistProfile = {
  artistKey: string;
  requestedName: string;
  name: string;
  status: "ready" | "not-found";
  sortName?: string | null;
  disambiguation?: string | null;
  type?: string | null;
  country?: string | null;
  area?: string | null;
  begin?: string | null;
  end?: string | null;
  ended?: boolean;
  genres?: string[];
  description?: string | null;
  biography?: string | null;
  imagePath?: string | null;
  imageUrl?: string | null;
  imageProvider?: "wikipedia" | "fanart.tv" | null;
  fanartAttempted?: boolean;
  musicBrainzId?: string | null;
  musicBrainzUrl?: string | null;
  wikipediaUrl?: string | null;
  fanartUrl?: string | null;
  fetchedAt: string;
  cacheState?: "fresh" | "stale";
};

export type SmartCrateField =
  | "bpm"
  | "key"
  | "genre"
  | "rating"
  | "artist"
  | "album"
  | "year"
  | "dateAdded"
  | "playCount"
  | "comment";

export type SmartCrateOperator =
  | "equals"
  | "contains"
  | "atLeast"
  | "atMost"
  | "between"
  | "withinDays";

export type SmartCrateRule = {
  id: string;
  field: SmartCrateField;
  operator: SmartCrateOperator;
  value: string;
  secondaryValue?: string;
};

export type SmartCrate = {
  id: string;
  name: string;
  match: "all" | "any";
  rules: SmartCrateRule[];
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
  | "format"
  | "rating";

export type ColumnConfig = {
  key: ColumnKey;
  labelKey: MessageKey;
  visible: boolean;
  width: number;
};
