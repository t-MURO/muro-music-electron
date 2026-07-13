import type { ColumnConfig, Track } from "../types";

export const themes = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "compact-light", label: "Compact Light" },
  { id: "compact-dark", label: "Compact Dark" },
  { id: "terminal", label: "Terminal" },
  { id: "compact-terminal", label: "Compact Terminal" },
  { id: "bw-terminal", label: "B&W Terminal" },
  { id: "compact-bw-terminal", label: "Compact B&W Terminal" },
];

export const baseColumns: ColumnConfig[] = [
  { key: "title", labelKey: "columns.title", visible: true, width: 240 },
  { key: "artist", labelKey: "columns.artist", visible: true, width: 180 },
  { key: "artists", labelKey: "columns.artists", visible: false, width: 220 },
  { key: "album", labelKey: "columns.album", visible: true, width: 200 },
  { key: "trackNumber", labelKey: "columns.trackNumber", visible: false, width: 120 },
  { key: "trackTotal", labelKey: "columns.trackTotal", visible: false, width: 120 },
  { key: "key", labelKey: "columns.key", visible: false, width: 80 },
  { key: "bpm", labelKey: "columns.bpm", visible: false, width: 80 },
  { key: "year", labelKey: "columns.year", visible: false, width: 110 },
  { key: "date", labelKey: "columns.date", visible: false, width: 160 },
  { key: "dateAdded", labelKey: "columns.dateAdded", visible: false, width: 170 },
  { key: "dateModified", labelKey: "columns.dateModified", visible: false, width: 180 },
  { key: "duration", labelKey: "columns.duration", visible: true, width: 120 },
  { key: "bitrate", labelKey: "columns.bitrate", visible: true, width: 120 },
  { key: "rating", labelKey: "columns.rating", visible: true, width: 110 },
];

export const initialTracks: Track[] = [];

export const initialInboxTracks: Track[] = [];
