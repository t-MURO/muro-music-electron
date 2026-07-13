import type { LibraryView } from "../hooks/useLibraryView";

/**
 * Maps a LibraryView to its corresponding URL path.
 */
export const getPathForView = (view: LibraryView): string => {
  if (view === "inbox") return "/inbox";
  if (view === "settings") return "/settings";
  if (view === "recentlyPlayed") return "/recently-played";
  if (view.startsWith("playlist:"))
    return `/playlists/${view.slice("playlist:".length)}`;
  return "/";
};
