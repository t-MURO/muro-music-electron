import {
  Activity,
  Badge,
  Clock3,
  Disc3,
  FileAudio,
  Inbox,
  ListMusic,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Tag,
  UserRound,
  KeyRound,
} from "lucide-react";
import { t } from "../../i18n";
import { useLibraryStore } from "../../stores";
import type { CollectionFacet, LibraryView } from "../../hooks";

type SidebarProps = {
  collapsed: boolean;
  currentView: LibraryView;
  draggingPlaylistId: string | null;
  onToggleCollapsed: () => void;
  onViewChange: (view: LibraryView) => void;
  onPlaylistDrop: (event: React.DragEvent<HTMLButtonElement>, id: string) => void;
  onPlaylistDragEnter: (id: string) => void;
  onPlaylistDragLeave: (id: string) => void;
  onPlaylistDragOver: (id: string) => void;
  onCreatePlaylist: () => void;
  onPlaylistContextMenu: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
};

export const Sidebar = ({
  collapsed,
  currentView,
  draggingPlaylistId,
  onToggleCollapsed,
  onViewChange,
  onPlaylistDrop,
  onPlaylistDragEnter,
  onPlaylistDragLeave,
  onPlaylistDragOver,
  onCreatePlaylist,
  onPlaylistContextMenu,
}: SidebarProps) => {
  const tracks = useLibraryStore((state) => state.tracks);
  const inboxTracks = useLibraryStore((state) => state.inboxTracks);
  const playlists = useLibraryStore((state) => state.playlists);

  const navigation = [
    { view: "library" as const, label: t("nav.library"), icon: Music2, count: tracks.length },
    { view: "inbox" as const, label: t("nav.inbox"), icon: Inbox, count: inboxTracks.length },
    { view: "recentlyPlayed" as const, label: t("nav.recentlyPlayed"), icon: Clock3 },
  ];
  const collections: { facet: CollectionFacet; label: string; icon: typeof Tag }[] = [
    { facet: "genres", label: "Genres", icon: Tag },
    { facet: "artists", label: "Artists", icon: UserRound },
    { facet: "albums", label: "Albums", icon: Disc3 },
    { facet: "labels", label: "Labels", icon: Badge },
    { facet: "keys", label: "Keys", icon: KeyRound },
    { facet: "bpm", label: "BPM", icon: Activity },
    { facet: "formats", label: "Formats", icon: FileAudio },
  ];

  const itemClass = (active: boolean) =>
    `sidebar-item ${active ? "sidebar-item--active" : ""} ${collapsed ? "justify-center px-0" : ""}`;

  return (
    <aside className="sidebar-shell flex h-full flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div className={`sidebar-titlebar flex h-[68px] shrink-0 items-center border-b border-[var(--color-border)] ${collapsed ? "justify-center px-2" : "justify-end px-3"}`}>
        <button
          className="toolbar-icon-button sidebar-collapse-button shrink-0"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          type="button"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className={`shrink-0 ${collapsed ? "px-2 py-3" : "px-3 py-4"}`} aria-label="Library navigation">
        {!collapsed && <div className="sidebar-section-label">Library</div>}
        <div className="space-y-1">
          {navigation.map(({ view, label, icon: Icon, count }) => {
            const active = currentView === view;
            return (
              <button
                key={view}
                className={itemClass(active)}
                onClick={() => onViewChange(view)}
                title={collapsed ? label : undefined}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                type="button"
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <><span className="min-w-0 flex-1 truncate">{label}</span>{count !== undefined && <span className="sidebar-count">{count.toLocaleString()}</span>}</>}
              </button>
            );
          })}
        </div>
      </nav>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--color-border-light)] px-3 py-4">
          <div className="sidebar-section-label">
            <ListMusic className="h-3.5 w-3.5" />
            <span className="flex-1">Playlists</span>
            <button className="toolbar-icon-button h-6 w-6" onClick={onCreatePlaylist} title="New playlist" type="button"><Plus className="h-3.5 w-3.5" /></button>
          </div>
          <div className="space-y-1">
            {playlists.map((playlist) => {
              const active = currentView === `playlist:${playlist.id}`;
              const dropTarget = draggingPlaylistId === playlist.id;
              return (
                <button
                  key={playlist.id}
                  className={`${itemClass(active)} ${dropTarget ? "sidebar-item--drop" : ""}`}
                  onClick={() => onViewChange(`playlist:${playlist.id}`)}
                  onContextMenu={(event) => onPlaylistContextMenu(event, playlist.id)}
                  onDragEnter={(event) => { event.preventDefault(); onPlaylistDragEnter(playlist.id); }}
                  onDragLeave={(event) => { event.preventDefault(); onPlaylistDragLeave(playlist.id); }}
                  onDragOver={(event) => { event.preventDefault(); onPlaylistDragOver(playlist.id); }}
                  onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onPlaylistDrop(event, playlist.id); }}
                  type="button"
                >
                  <ListMusic className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                  <span className="sidebar-count">{playlist.trackIds.length}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 border-t border-[var(--color-border-light)] pt-4">
            <div className="sidebar-section-label">Collection</div>
            <div className="space-y-1">
              {collections.map(({ facet, label, icon: Icon }) => {
                const collectionView = `collection:${facet}` as LibraryView;
                return (
                  <button
                    key={facet}
                    className={itemClass(currentView === collectionView)}
                    onClick={() => onViewChange(collectionView)}
                    type="button"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className={`mt-auto border-t border-[var(--color-border)] ${collapsed ? "p-2" : "p-3"}`}>
        <button
          className={itemClass(currentView === "settings")}
          onClick={() => onViewChange("settings")}
          title={collapsed ? t("nav.settings") : undefined}
          aria-label={t("nav.settings")}
          type="button"
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{t("nav.settings")}</span>}
        </button>
      </div>
    </aside>
  );
};
