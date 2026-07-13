import { useMemo } from "react";
import { t } from "../i18n";
import type { Playlist, Track } from "../types";

export type LibraryView = "library" | "inbox" | "settings" | "recentlyPlayed" | `playlist:${string}`;

export type ViewType = "library" | "inbox" | "settings" | "playlist" | "recentlyPlayed";

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

type UseViewConfigArgs = {
  view: LibraryView;
  playlists: Playlist[];
  libraryTracks: Track[];
  inboxTracks: Track[];
  recentlyPlayedTracks: Track[];
};

export const useViewConfig = ({
  view,
  playlists,
  libraryTracks,
  inboxTracks,
  recentlyPlayedTracks,
}: UseViewConfigArgs): ViewConfig => {
  return useMemo(() => {
    const playlistId = parsePlaylistId(view);
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
  }, [view, playlists, libraryTracks, inboxTracks, recentlyPlayedTracks]);
};
