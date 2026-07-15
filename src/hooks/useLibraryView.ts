import { useMemo } from "react";
import { t } from "../i18n";
import { filterTracksBySmartCrate } from "../utils/smartCrates";
import type { Playlist, SmartCrate, Track } from "../types";

export type CollectionFacet = "genres" | "artists" | "albums" | "labels" | "keys" | "bpm" | "formats";
export type LibraryView =
  | "library"
  | "inbox"
  | "settings"
  | "recentlyPlayed"
  | `playlist:${string}`
  | `smartCrate:${string}`
  | `collection:${CollectionFacet}`;

export type ViewType = "library" | "inbox" | "settings" | "playlist" | "smartCrate" | "recentlyPlayed" | "collection";

export type EmptyStateConfig = {
  title: string;
  description: string;
  primaryAction?: {
    label: string;
  };
  secondaryAction?: {
    label: string;
  };
};

export type TrackTableConfig = {
  tracks: Track[];
  emptyState: EmptyStateConfig;
  showImportActions: boolean;
  banner?: "inbox";
};

export type ViewConfig = {
  type: ViewType;
  title: string;
  subtitle: string;
  playlist: Playlist | null;
  trackTable: TrackTableConfig | null;
};

const parsePlaylistId = (view: LibraryView): string | null => {
  if (view.startsWith("playlist:")) {
    return view.slice("playlist:".length);
  }
  return null;
};

const parseCollectionFacet = (view: LibraryView): CollectionFacet | null =>
  view.startsWith("collection:") ? view.slice("collection:".length) as CollectionFacet : null;

const parseSmartCrateId = (view: LibraryView): string | null =>
  view.startsWith("smartCrate:") ? view.slice("smartCrate:".length) : null;

type UseViewConfigArgs = {
  view: LibraryView;
  playlists: Playlist[];
  libraryTracks: Track[];
  inboxTracks: Track[];
  recentlyPlayedTracks: Track[];
  smartCrates: SmartCrate[];
  collectionFilterValue?: string | null;
};

export const useViewConfig = ({
  view,
  playlists,
  libraryTracks,
  inboxTracks,
  recentlyPlayedTracks,
  smartCrates,
  collectionFilterValue,
}: UseViewConfigArgs): ViewConfig => {
  return useMemo(() => {
    const playlistId = parsePlaylistId(view);
    const smartCrateId = parseSmartCrateId(view);
    const collectionFacet = parseCollectionFacet(view);
    const playlist = playlistId
      ? playlists.find((p) => p.id === playlistId) ?? null
      : null;

    // Settings view
    if (view === "settings") {
      return {
        type: "settings",
        title: t("header.settings"),
        subtitle: t("header.settings.subtitle"),
        playlist: null,
        trackTable: null,
      };
    }

    // Library view
    if (view === "library") {
      return {
        type: "library",
        title: t("header.library"),
        subtitle: t("header.library.subtitle"),
        playlist: null,
        trackTable: {
          tracks: libraryTracks,
          emptyState: {
            title: "No tracks yet",
            description: "Drag folders or files into the app to build your library.",
            primaryAction: { label: "Import files" },
            secondaryAction: { label: "Import folder" },
          },
          showImportActions: true,
        },
      };
    }

    // Inbox view
    if (view === "inbox") {
      return {
        type: "inbox",
        title: t("header.inbox"),
        subtitle: t("header.inbox.subtitle"),
        playlist: null,
        trackTable: {
          tracks: inboxTracks,
          emptyState: {
            title: "Inbox is empty",
            description: "Drop folders or audio files here to stage new imports.",
            primaryAction: { label: "Import files" },
            secondaryAction: { label: "Import folder" },
          },
          showImportActions: true,
          banner: "inbox",
        },
      };
    }

    // Recently Played view
    if (view === "recentlyPlayed") {
      return {
        type: "recentlyPlayed",
        title: t("header.recentlyPlayed"),
        subtitle: t("header.recentlyPlayed.subtitle"),
        playlist: null,
        trackTable: {
          tracks: recentlyPlayedTracks,
          emptyState: {
            title: t("recentlyPlayed.empty.title"),
            description: t("recentlyPlayed.empty.description"),
          },
          showImportActions: false,
        },
      };
    }

    if (smartCrateId) {
      const smartCrate = smartCrates.find((crate) => crate.id === smartCrateId) ?? null;
      if (!smartCrate) {
        return {
          type: "smartCrate",
          title: "Smart Crate not found",
          subtitle: "",
          playlist: null,
          trackTable: {
            tracks: [],
            emptyState: {
              title: "Smart Crate not found",
              description: "It may have been deleted.",
            },
            showImportActions: false,
          },
        };
      }

      const crateTracks = filterTracksBySmartCrate(libraryTracks, smartCrate);
      return {
        type: "smartCrate",
        title: smartCrate.name,
        subtitle: `${crateTracks.length.toLocaleString()} live matches · ${smartCrate.rules.length} ${smartCrate.rules.length === 1 ? "rule" : "rules"}`,
        playlist: null,
        trackTable: {
          tracks: crateTracks,
          emptyState: {
            title: "No tracks match yet",
            description: "Edit the crate rules or update track metadata to populate it.",
          },
          showImportActions: false,
        },
      };
    }

    if (collectionFacet) {
      const labels: Record<CollectionFacet, string> = {
        genres: "Genres",
        artists: "Artists",
        albums: "Albums",
        labels: "Labels",
        keys: "Keys",
        bpm: "BPM",
        formats: "Formats",
      };
      const normalizedFilter = collectionFilterValue?.trim().toLocaleLowerCase() ?? "";
      const collectionTracks = libraryTracks.filter((track) => {
        let value = "";
        if (collectionFacet === "genres") value = track.genre ?? "";
        else if (collectionFacet === "artists") value = track.artist;
        else if (collectionFacet === "albums") value = track.album;
        else if (collectionFacet === "labels") value = track.label ?? "";
        else if (collectionFacet === "keys") value = track.key ?? "";
        else if (collectionFacet === "bpm") value = track.bpm == null ? "" : String(Math.round(track.bpm));
        else value = track.sourcePath.split(".").pop()?.toUpperCase() ?? "";

        if (!value.trim()) return false;
        if (!normalizedFilter) return true;
        return collectionFacet === "genres"
          ? value.toLocaleLowerCase().includes(normalizedFilter)
          : value.toLocaleLowerCase() === normalizedFilter;
      });
      const collectionTitle = labels[collectionFacet];
      const title = collectionFilterValue?.trim() || collectionTitle;
      return {
        type: "collection",
        title,
        subtitle: normalizedFilter
          ? `${collectionTracks.length.toLocaleString()} tracks · ${collectionTitle}`
          : `${collectionTracks.length.toLocaleString()} tracks with ${collectionTitle.toLowerCase()} metadata`,
        playlist: null,
        trackTable: {
          tracks: collectionTracks,
          emptyState: {
            title: normalizedFilter ? `No tracks match ${title}` : `No ${collectionTitle.toLowerCase()} yet`,
            description: `Add or edit track metadata to populate this collection.`,
          },
          showImportActions: false,
        },
      };
    }

    // Playlist view
    if (playlist) {
      const trackMap = new Map(
        [...libraryTracks, ...inboxTracks].map((track) => [track.id, track])
      );
      const playlistTracks = playlist.trackIds
        .map((id) => trackMap.get(id))
        .filter((track): track is Track => track !== undefined);

      return {
        type: "playlist",
        title: playlist.name,
        subtitle: t("header.playlist.subtitle", {
          count: String(playlist.trackIds.length),
        }),
        playlist,
        trackTable: {
          tracks: playlistTracks,
          emptyState: {
            title: t("playlist.empty.title"),
            description: t("playlist.empty.description"),
          },
          showImportActions: false,
        },
      };
    }

    // Playlist not found fallback
    return {
      type: "playlist",
      title: t("header.playlist.notFound"),
      subtitle: "",
      playlist: null,
      trackTable: {
        tracks: [],
        emptyState: {
          title: t("header.playlist.notFound"),
          description: "",
        },
        showImportActions: false,
      },
    };
  }, [
    collectionFilterValue,
    inboxTracks,
    libraryTracks,
    playlists,
    recentlyPlayedTracks,
    smartCrates,
    view,
  ]);
};
