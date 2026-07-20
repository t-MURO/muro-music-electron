import type { MessageKey } from "../i18n";
import type { BeatGrid } from "../lib/beatgrid/types";

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
  sampleRate?: number;
  bitDepth?: number;
  fileSize?: number;
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
  beatGrid?: BeatGrid;
  musicBrainzTrackId?: string;
  musicBrainzAlbumId?: string;
  musicBrainzReleaseGroupId?: string;
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
  musicBrainzTrackId?: string;
  musicBrainzAlbumId?: string;
  musicBrainzReleaseGroupId?: string;
};

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  folderId?: string;
  sortOrder: number;
};

export type PlaylistFolder = {
  id: string;
  name: string;
  parentId?: string;
  sortOrder: number;
};

export type ArtistProfile = {
  profileVersion?: number;
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
  imageProvider?: "wikimedia-commons" | "wikipedia" | "theaudiodb" | "fanart.tv" | null;
  imageAttribution?: string | null;
  imageLicense?: string | null;
  imageLicenseUrl?: string | null;
  imageSelection?: "automatic" | "manual";
  lastFmAttempted?: boolean;
  lastFmUrl?: string | null;
  similarArtists?: Array<{
    name: string;
    musicBrainzId?: string | null;
    url?: string | null;
  }>;
  theAudioDbAttempted?: boolean;
  theAudioDbId?: string | null;
  theAudioDbUrl?: string | null;
  fanartAttempted?: boolean;
  musicBrainzId?: string | null;
  musicBrainzUrl?: string | null;
  wikipediaUrl?: string | null;
  wikimediaCommonsUrl?: string | null;
  fanartUrl?: string | null;
  fetchedAt: string;
  cacheState?: "fresh" | "stale";
};

export type ArtistImageCandidate = {
  id: string;
  provider: "wikimedia-commons" | "wikipedia" | "theaudiodb" | "fanart.tv";
  imageUrl: string;
  sourceUrl?: string | null;
  attribution?: string | null;
  license?: string | null;
  licenseUrl?: string | null;
  width?: number | null;
  height?: number | null;
  score?: number;
  current?: boolean;
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
  | "discNumber"
  | "key"
  | "bpm"
  | "genre"
  | "year"
  | "date"
  | "dateAdded"
  | "dateModified"
  | "lastPlayedAt"
  | "playCount"
  | "duration"
  | "bitrate"
  | "sampleRate"
  | "bitDepth"
  | "fileSize"
  | "format"
  | "rating"
  | "comment"
  | "sourcePath";

export type ColumnConfig = {
  key: ColumnKey;
  labelKey: MessageKey;
  visible: boolean;
  width: number;
};
