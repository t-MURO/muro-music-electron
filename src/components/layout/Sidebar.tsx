import {
  Badge,
  ChevronDown,
  ChevronRight,
  Clock3,
  Disc3,
  Folder,
  FolderInput,
  FolderPlus,
  Import,
  Inbox,
  ListMusic,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  UserRound,
  KeyRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "../../i18n";
import { useLibraryStore, useSmartCrateStore } from "../../stores";
import { filterTracksBySmartCrate } from "../../utils";
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
  onCreatePlaylistFolder: () => void;
  onImportPlaylist: () => void;
  onImportPlaylistFolder: () => void;
  onPlaylistContextMenu: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
  onPlaylistFolderContextMenu: (event: React.MouseEvent<HTMLButtonElement>, id: string) => void;
  onCreateSmartCrate: () => void;
  onEditSmartCrate: (id: string) => void;
  onDeleteSmartCrate: (id: string) => void;
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
  onCreatePlaylistFolder,
  onImportPlaylist,
  onImportPlaylistFolder,
  onPlaylistContextMenu,
  onPlaylistFolderContextMenu,
  onCreateSmartCrate,
  onEditSmartCrate,
  onDeleteSmartCrate,
}: SidebarProps) => {
  const tracks = useLibraryStore((state) => state.tracks);
  const inboxTracks = useLibraryStore((state) => state.inboxTracks);
  const playlists = useLibraryStore((state) => state.playlists);
  const playlistFolders = useLibraryStore((state) => state.playlistFolders);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const smartCrates = useSmartCrateStore((state) => state.smartCrates);
  const smartCrateCounts = useMemo(
    () => new Map(smartCrates.map((crate) => [crate.id, filterTracksBySmartCrate(tracks, crate).length])),
    [smartCrates, tracks],
  );

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
  ];

  const itemClass = (active: boolean) =>
    `sidebar-item ${active ? "sidebar-item--active" : ""} ${collapsed ? "justify-center px-0" : ""}`;

  const folderIds = useMemo(
    () => new Set(playlistFolders.map((folder) => folder.id)),
    [playlistFolders],
  );
  const rootPlaylists = playlists.filter((playlist) => !playlist.folderId || !folderIds.has(playlist.folderId));
  const toggleFolder = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };
  const renderPlaylist = (playlist: (typeof playlists)[number], folderId?: string) => {
    const active = currentView === `playlist:${playlist.id}`;
    const dropTarget = draggingPlaylistId === playlist.id;
    return (
      <button
        key={playlist.id}
        className={`${itemClass(active)} ${dropTarget ? "sidebar-item--drop" : ""} ${folderId ? "pl-7" : ""}`}
        onClick={() => onViewChange(`playlist:${playlist.id}`)}
        onContextMenu={(event) => onPlaylistContextMenu(event, playlist.id)}
        onDragEnter={(event) => { event.preventDefault(); onPlaylistDragEnter(playlist.id); }}
        onDragLeave={(event) => { event.preventDefault(); onPlaylistDragLeave(playlist.id); }}
        onDragOver={(event) => { event.preventDefault(); onPlaylistDragOver(playlist.id); }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onPlaylistDrop(event, playlist.id); }}
        data-playlist-id={playlist.id}
        data-playlist-target={playlist.id}
        data-playlist-folder-parent={folderId}
        type="button"
      >
        <ListMusic className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
        <span className="sidebar-count">{playlist.trackIds.length}</span>
      </button>
    );
  };

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
            <button className="toolbar-icon-button h-6 w-6" onClick={onImportPlaylist} title="Import playlist" aria-label="Import playlist" data-playlist-import type="button"><Import className="h-3.5 w-3.5" /></button>
            <button className="toolbar-icon-button h-6 w-6" onClick={onImportPlaylistFolder} title="Import folder of playlists" aria-label="Import folder of playlists" data-playlist-folder-import type="button"><FolderInput className="h-3.5 w-3.5" /></button>
            <button className="toolbar-icon-button h-6 w-6" onClick={onCreatePlaylistFolder} title="New playlist folder" aria-label="New playlist folder" data-playlist-folder-create type="button"><FolderPlus className="h-3.5 w-3.5" /></button>
            <button className="toolbar-icon-button h-6 w-6" onClick={onCreatePlaylist} title="New playlist" aria-label="New playlist" type="button"><Plus className="h-3.5 w-3.5" /></button>
          </div>
          <div className="space-y-1">
            {rootPlaylists.map((playlist) => renderPlaylist(playlist))}
            {playlistFolders.map((folder) => {
              const folderPlaylists = playlists.filter((playlist) => playlist.folderId === folder.id);
              const isCollapsed = collapsedFolderIds.has(folder.id);
              return (
                <div key={folder.id} data-playlist-folder={folder.id}>
                <button
                  className="sidebar-item"
                  onClick={() => toggleFolder(folder.id)}
                  onContextMenu={(event) => onPlaylistFolderContextMenu(event, folder.id)}
                  aria-expanded={!isCollapsed}
                  type="button"
                >
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <span className="sidebar-count">{folderPlaylists.length}</span>
                </button>
                {!isCollapsed && folderPlaylists.map((playlist) => renderPlaylist(playlist, folder.id))}
                </div>
              );
            })}
          </div>
          <div className="mt-4 border-t border-[var(--color-border-light)] pt-4">
            <div className="sidebar-section-label">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="flex-1">Smart Crates</span>
              <button
                className="toolbar-icon-button h-6 w-6"
                onClick={onCreateSmartCrate}
                title="New Smart Crate"
                aria-label="New Smart Crate"
                data-smart-crate-create
                type="button"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {smartCrates.length > 0 ? (
              <div className="space-y-1">
                {smartCrates.map((crate) => {
                  const crateView = `smartCrate:${crate.id}` as LibraryView;
                  const active = currentView === crateView;
                  return (
                    <div className="smart-crate-sidebar-row group flex min-w-0 items-center gap-1" key={crate.id}>
                      <button
                        className={`${itemClass(active)} min-w-0 flex-1`}
                        onClick={() => onViewChange(crateView)}
                        aria-current={active ? "page" : undefined}
                        data-smart-crate-id={crate.id}
                        type="button"
                      >
                        <Sparkles className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{crate.name}</span>
                        <span className="sidebar-count">{(smartCrateCounts.get(crate.id) ?? 0).toLocaleString()}</span>
                      </button>
                      <div className="smart-crate-sidebar-actions flex shrink-0 items-center">
                        <button className="toolbar-icon-button h-7 w-7" onClick={() => onEditSmartCrate(crate.id)} title={`Edit ${crate.name}`} aria-label={`Edit ${crate.name}`} data-smart-crate-edit={crate.id} type="button"><Pencil className="h-3 w-3" /></button>
                        <button className="toolbar-icon-button h-7 w-7" onClick={() => onDeleteSmartCrate(crate.id)} title={`Delete ${crate.name}`} aria-label={`Delete ${crate.name}`} data-smart-crate-delete={crate.id} type="button"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <button
                className="mx-2 mt-1 text-left text-[10px] leading-relaxed text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
                onClick={onCreateSmartCrate}
                type="button"
              >
                Build a live playlist from BPM, key, genre, rating, and more.
              </button>
            )}
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
                    data-collection-facet={facet}
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
