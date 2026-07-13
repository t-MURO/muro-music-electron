import { ChevronLeft, ChevronRight, Clock, Inbox, Library, ListMusic, Music, Plus, Settings } from "lucide-react";
import { t } from "../../i18n";
import { useLibraryStore } from "../../stores";
import type { LibraryView } from "../../hooks";

type SidebarProps = {
  currentView: LibraryView;
  draggingPlaylistId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onViewChange: (view: LibraryView) => void;
  onPlaylistDrop: (event: React.DragEvent<HTMLButtonElement>, id: string) => void;
  onPlaylistDragEnter: (id: string) => void;
  onPlaylistDragLeave: (id: string) => void;
  onPlaylistDragOver: (id: string) => void;
  onCreatePlaylist: () => void;
  onPlaylistContextMenu: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
};

export const Sidebar = ({
  currentView,
  draggingPlaylistId,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onViewChange,
  onPlaylistDrop,
  onPlaylistDragEnter,
  onPlaylistDragLeave,
  onPlaylistDragOver,
  onCreatePlaylist,
  onPlaylistContextMenu,
}: SidebarProps) => {
  // Read state from store
  const tracks = useLibraryStore((s) => s.tracks);
  const inboxTracks = useLibraryStore((s) => s.inboxTracks);
  const playlists = useLibraryStore((s) => s.playlists);
  const trackCount = tracks.length;
  const inboxCount = inboxTracks.length;
  const isLibrary = currentView === "library";
  const isInbox = currentView === "inbox";
  const isRecentlyPlayed = currentView === "recentlyPlayed";
  const isSettings = currentView === "settings";

  return (
    <aside className="flex h-full flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      <div
        className="flex items-center justify-between border-b border-[var(--color-border-light)] p-[var(--spacing-lg)] pb-[var(--spacing-md)] pt-12"
      >
        <div className="flex gap-[var(--spacing-xs)]">
          <button
            type="button"
            onClick={onGoBack}
            disabled={!canGoBack}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:pointer-events-none disabled:opacity-30"
            aria-label="Go back"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onGoForward}
            disabled={!canGoForward}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:pointer-events-none disabled:opacity-30"
            aria-label="Go forward"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h1 className="text-[var(--font-size-lg)] font-semibold text-[var(--color-text-primary)]">
          {t("app.name")}
        </h1>
      </div>

      <nav className="flex flex-col gap-[var(--spacing-xs)] p-[var(--spacing-md)]">
        <div className="mb-[var(--spacing-xs)] flex items-center gap-[var(--spacing-sm)]">
          <Library className="h-4 w-4 text-[var(--color-text-muted)]" />
          <span className="text-[var(--font-size-xs)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t("nav.library.section")}
          </span>
        </div>

        <button
          className={`flex w-full items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
            isLibrary
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => onViewChange("library")}
          type="button"
        >
          <Music className="h-[var(--icon-size)] w-[var(--icon-size)]" />
          <span className="flex-1">{t("nav.library")}</span>
          <span
            className={`rounded-[var(--radius-full)] px-2 py-0.5 text-[var(--font-size-xs)] ${
              isLibrary
                ? "bg-white/20 text-white"
                : "bg-[var(--color-bg-tertiary)]"
            }`}
          >
            {trackCount}
          </span>
        </button>

        <button
          className={`flex w-full items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
            isInbox
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => onViewChange("inbox")}
          type="button"
        >
          <Inbox className="h-[var(--icon-size)] w-[var(--icon-size)]" />
          <span className="flex-1">{t("nav.inbox")}</span>
          <span
            className={`rounded-[var(--radius-full)] px-2 py-0.5 text-[var(--font-size-xs)] ${
              isInbox
                ? "bg-white/20 text-white"
                : "bg-[var(--color-bg-tertiary)]"
            }`}
          >
            {inboxCount}
          </span>
        </button>

        <button
          className={`flex w-full items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
            isRecentlyPlayed
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => onViewChange("recentlyPlayed")}
          type="button"
        >
          <Clock className="h-[var(--icon-size)] w-[var(--icon-size)]" />
          <span className="flex-1">{t("nav.recentlyPlayed")}</span>
        </button>
      </nav>

      <div className="flex-1 overflow-y-auto p-[var(--spacing-md)]">
        <div className="mb-[var(--spacing-sm)] flex items-center gap-[var(--spacing-sm)]">
          <ListMusic className="h-4 w-4 text-[var(--color-text-muted)]" />
          <span className="flex-1 text-[var(--font-size-xs)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t("nav.playlists")}
          </span>
          <button
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-full)] opacity-50 transition-all hover:bg-[var(--color-bg-hover)] hover:opacity-100"
            onClick={onCreatePlaylist}
            type="button"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {playlists.length === 0 && (
          <p className="p-[var(--spacing-sm)] text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            No playlists yet
          </p>
        )}

        {playlists.map((playlist) => {
          const isDropTarget = draggingPlaylistId === playlist.id;
          const isActive = currentView === `playlist:${playlist.id}`;
          return (
            <button
              key={playlist.id}
              className={`mb-1 flex w-full items-center justify-between rounded-[var(--radius-md)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
                isActive
                  ? "bg-[var(--color-accent)] text-white"
                  : isDropTarget
                  ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              }`}
              onClick={() => onViewChange(`playlist:${playlist.id}`)}
              onDragEnter={(event) => {
                event.preventDefault();
                onPlaylistDragEnter(playlist.id);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                onPlaylistDragLeave(playlist.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                onPlaylistDragOver(playlist.id);
              }}
              onContextMenu={(event) => onPlaylistContextMenu(event, playlist.id)}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onPlaylistDrop(event, playlist.id);
              }}
              data-playlist-target={playlist.id}
              type="button"
            >
              <span className="truncate">{playlist.name}</span>
              <span
                className={`ml-2 rounded-[var(--radius-full)] px-2 py-0.5 text-[var(--font-size-xs)] ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-[var(--color-bg-tertiary)]"
                }`}
              >
                {playlist.trackIds.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto border-t border-[var(--color-border-light)] p-[var(--spacing-md)]">
        <button
          className={`flex w-full items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left text-[var(--font-size-sm)] transition-all duration-[var(--transition-fast)] ${
            isSettings
              ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => onViewChange("settings")}
          type="button"
        >
          <Settings className="h-[var(--icon-size)] w-[var(--icon-size)]" />
          <span>{t("nav.settings")}</span>
        </button>
      </div>
    </aside>
  );
};
