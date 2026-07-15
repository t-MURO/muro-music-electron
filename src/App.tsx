import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useLocation, useNavigate, useMatch } from "react-router-dom";
import {
  AppLayout,
  QueuePanel,
  LibraryHeader,
  PlayerBar,
  SettingsPanel,
  Sidebar,
  ColumnsMenu,
  InboxBanner,
  TrackTable,
  ContextMenu,
  DragOverlay,
  PlaylistContextMenu,
  AnalysisModal,
  DuplicateTracksModal,
  EditTrackModal,
  PlaylistCreateModal,
  PlaylistEditModal,
  ToastContainer,
} from "./components";
import {
  useFileImport,
  useViewConfig,
  useColumns,
  useColumnsMenu,
  useContextMenu,
  useQueuePanel,
  useNativeDrag,
  usePlaylistMenu,
  usePlaylistDrag,
  useAudioPlayback,
  useSidebarPanel,
  useSidebarData,
  useHistoryNavigation,
  useTrackRatings,
  usePlaylistOperations,
  useInboxOperations,
  useTrackAnalysis,
  useTrackEdit,
  useLibraryInit,
  usePlayTracking,
  useKeyboardShortcuts,
  type LibraryView,
} from "./hooks";
import { themes } from "./data/library";
import { localeOptions, t } from "./i18n";
import {
  useLibraryStore,
  usePlaybackStore,
  useSettingsStore,
  useUIStore,
  useRecentlyPlayedStore,
  selectAllTracks,
  notify,
} from "./stores";
import { getPathForView, compareSortValues, getSortableValue, filterTracksBySearch } from "./utils";
import { open } from "@muro/desktop/dialogs";
import type { ColumnConfig, Track } from "./types";

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const playlistMatch = useMatch("/playlists/:playlistId");
  const collectionMatch = useMatch("/collection/:facet");
  const { canGoBack, canGoForward, goBack, goForward } = useHistoryNavigation();

  // Get state from stores
  const tracks = useLibraryStore((s) => s.tracks);
  const inboxTracks = useLibraryStore((s) => s.inboxTracks);
  const playlists = useLibraryStore((s) => s.playlists);
  const allTracks = useLibraryStore(selectAllTracks);

  const recentlyPlayedTracks = useRecentlyPlayedStore((s) => s.recentlyPlayedTracks);

  const theme = useSettingsStore((s) => s.theme);
  const locale = useSettingsStore((s) => s.locale);
  const seekMode = useSettingsStore((s) => s.seekMode);
  const dbPath = useSettingsStore((s) => s.dbPath);
  const dbFileName = useSettingsStore((s) => s.dbFileName);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const setSeekMode = useSettingsStore((s) => s.setSeekMode);
  const setDbPath = useSettingsStore((s) => s.setDbPath);
  const setDbFileName = useSettingsStore((s) => s.setDbFileName);
  const setUseAutoDbPath = useSettingsStore((s) => s.setUseAutoDbPath);

  const shuffleEnabled = usePlaybackStore((s) => s.shuffleEnabled);
  const repeatMode = usePlaybackStore((s) => s.repeatMode);
  const queue = usePlaybackStore((s) => s.queue);
  const addToQueue = usePlaybackStore((s) => s.addToQueue);
  const playNext = usePlaybackStore((s) => s.playNext);
  const removeFromQueue = usePlaybackStore((s) => s.removeFromQueue);
  const clearQueue = usePlaybackStore((s) => s.clearQueue);
  const reorderQueue = usePlaybackStore((s) => s.reorderQueue);
  const setQueue = usePlaybackStore((s) => s.setQueue);

  const selectedIds = useUIStore((s) => s.selectedIds);
  const sortState = useUIStore((s) => s.sortState);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const importProgress = useUIStore((s) => s.importProgress);
  const pendingPlaylistDrop = useUIStore((s) => s.pendingPlaylistDrop);
  const isPlaylistModalOpen = useUIStore((s) => s.isPlaylistModalOpen);
  const playlistModalName = useUIStore((s) => s.playlistModalName);
  const selectTrack = useUIStore((s) => s.selectTrack);
  const toggleSort = useUIStore((s) => s.toggleSort);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const openPlaylistModal = useUIStore((s) => s.openPlaylistModal);
  const closePlaylistModal = useUIStore((s) => s.closePlaylistModal);
  const setPlaylistModalName = useUIStore((s) => s.setPlaylistModalName);
  const openAnalysisModal = useUIStore((s) => s.openAnalysisModal);

  const view = useMemo((): LibraryView => {
    if (location.pathname === "/inbox") return "inbox";
    if (location.pathname === "/settings") return "settings";
    if (location.pathname === "/recently-played") return "recentlyPlayed";
    if (collectionMatch?.params.facet) {
      return `collection:${collectionMatch.params.facet}` as LibraryView;
    }
    if (playlistMatch?.params.playlistId) {
      return `playlist:${playlistMatch.params.playlistId}` as LibraryView;
    }
    return "library";
  }, [collectionMatch, location.pathname, playlistMatch]);

  const navigateToView = useCallback(
    (newView: LibraryView) => {
      navigate(getPathForView(newView));
    },
    [navigate]
  );

  // Redirect unknown paths to library
  useEffect(() => {
    const { pathname } = location;
    const isKnownPath =
      pathname === "/" ||
      pathname === "/inbox" ||
      pathname === "/settings" ||
      pathname === "/recently-played" ||
      pathname.startsWith("/collection/") ||
      pathname.startsWith("/playlists/");
    if (!isKnownPath) {
      navigate("/", { replace: true });
    }
  }, [location, navigate]);

  // View configuration
  const viewConfig = useViewConfig({
    view,
    playlists,
    libraryTracks: tracks,
    inboxTracks,
    recentlyPlayedTracks,
  });

  // Filtering and sorting
  const displayedTracks = viewConfig.trackTable?.tracks ?? [];

  // Apply search filter
  const filteredTracks = useMemo(() => {
    return filterTracksBySearch(displayedTracks, searchQuery);
  }, [displayedTracks, searchQuery]);

  const sortedTracks = useMemo(() => {
    if (!sortState) {
      return filteredTracks;
    }
    const next = [...filteredTracks];
    next.sort((left, right) => {
      const leftValue = getSortableValue(left, sortState.key);
      const rightValue = getSortableValue(right, sortState.key);

      if (leftValue === null && rightValue === null) {
        return 0;
      }
      if (leftValue === null) {
        return 1;
      }
      if (rightValue === null) {
        return -1;
      }

      const result = compareSortValues(leftValue, rightValue);
      return sortState.direction === "asc" ? result : -result;
    });
    return next;
  }, [filteredTracks, sortState]);

  const handleSortChange = useCallback(
    (key: ColumnConfig["key"]) => {
      toggleSort(key);
    },
    [toggleSort]
  );

  // Keep selection behavior aligned with the current sorted track order.
  const handleRowSelect = useCallback(
    (
      index: number,
      id: string,
      options?: { isMetaKey?: boolean; isShiftKey?: boolean }
    ) => {
      selectTrack(index, id, options, sortedTracks);
    },
    [selectTrack, sortedTracks]
  );

  // Columns
  const {
    autoFitColumn,
    columns,
    handleColumnResize,
    reorderColumns,
    toggleColumn,
  } = useColumns({ tracks });

  // Context menus
  const { closeMenu, menuPosition, menuSelection, openForRow, openMenuId } =
    useContextMenu({
      selectedIds,
      onSelectRow: handleRowSelect,
    });
  const {
    closeMenu: closeColumnsMenu,
    isOpen: showColumns,
    position: columnsMenuPosition,
    openAt: openColumnsMenu,
  } = useColumnsMenu();

  // Queue tracks
  const queueTracks = useMemo(() => {
    return queue
      .map((id) => allTracks.find((t) => t.id === id))
      .filter((t): t is Track => t !== undefined);
  }, [queue, allTracks]);

  // Track end handler for auto-advance
  const handleTrackEnd = useCallback(() => {
    const currentQueue = usePlaybackStore.getState().queue;

    if (currentQueue.length > 0) {
      const nextTrackId = currentQueue[0];
      const nextTrack = allTracks.find((t) => t.id === nextTrackId);
      if (nextTrack) {
        setQueue(currentQueue.slice(1));
        // playTrack will be called by useAudioPlayback
      }
    }
  }, [allTracks, setQueue]);

  // Media control refs for skip handlers (needed before useAudioPlayback)
  const skipPreviousRef = useRef<() => void>(() => {});
  const skipNextRef = useRef<() => void>(() => {});

  // Media control handler
  const handleMediaControl = useCallback((action: string) => {
    switch (action) {
      case "next":
        skipNextRef.current();
        break;
      case "previous":
        skipPreviousRef.current();
        break;
      // play, pause, and toggle are handled by the playback runtime.
    }
  }, []);

  // Audio playback
  const {
    currentPosition,
    currentTrack,
    playTrack,
    togglePlay,
    seek,
    setVolume,
  } = useAudioPlayback({ onTrackEnd: handleTrackEnd, onMediaControl: handleMediaControl, seekMode });

  // Play tracking (30-second threshold)
  usePlayTracking({ currentPosition, allTracks });

  // Skip handlers
  const handleSkipPrevious = useCallback(() => {
    if (currentPosition > 3) {
      seek(0);
      return;
    }
    const currentIndex = currentTrack
      ? allTracks.findIndex((t) => t.id === currentTrack.id)
      : -1;
    if (currentIndex > 0) {
      playTrack(allTracks[currentIndex - 1]);
    }
  }, [currentPosition, currentTrack, allTracks, seek, playTrack]);

  const handleSkipNext = useCallback(() => {
    const currentQueue = usePlaybackStore.getState().queue;

    // If there's a track in the queue, use it
    if (currentQueue.length > 0) {
      const nextTrackId = currentQueue[0];
      const nextTrack = allTracks.find((t) => t.id === nextTrackId);
      if (nextTrack) {
        setQueue(currentQueue.slice(1));
        playTrack(nextTrack);
        return;
      }
    }

    // No queue - fall back to normal progression
    const currentIndex = currentTrack
      ? allTracks.findIndex((t) => t.id === currentTrack.id)
      : -1;

    // Shuffle
    if (shuffleEnabled) {
      const randomIndex = Math.floor(Math.random() * allTracks.length);
      playTrack(allTracks[randomIndex]);
      return;
    }

    // Next track in list
    if (currentIndex < allTracks.length - 1) {
      playTrack(allTracks[currentIndex + 1]);
      return;
    }

    // Repeat all - wrap to beginning
    if (repeatMode === "all" && allTracks.length > 0) {
      playTrack(allTracks[0]);
    }
  }, [allTracks, currentTrack, shuffleEnabled, repeatMode, playTrack, setQueue]);

  // Update refs for media control handler
  useEffect(() => {
    skipPreviousRef.current = handleSkipPrevious;
  }, [handleSkipPrevious]);

  useEffect(() => {
    skipNextRef.current = handleSkipNext;
  }, [handleSkipNext]);

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    onTogglePlay: togglePlay,
    onSkipPrevious: handleSkipPrevious,
    onSkipNext: handleSkipNext,
    onSeek: seek,
    currentPosition,
  });

  const handlePlayTrack = useCallback(
    (trackId: string) => {
      const track = allTracks.find((t) => t.id === trackId);
      if (track) {
        playTrack(track);
      }
    },
    [allTracks, playTrack]
  );

  // Track ratings
  const { handleRatingChange } = useTrackRatings();

  // File import and playlist drop
  const {
    handleImportPaths,
    handlePlaylistDrop,
    handleCreatePlaylist,
    confirmPlaylistDropOperation,
    cancelPlaylistDropOperation,
  } = useFileImport({
    onImportComplete: () => navigateToView("inbox"),
  });

  // Playlist drag
  const {
    dragIndicator,
    draggingPlaylistId,
    isInternalDrag,
    onPlaylistDragEnter,
    onPlaylistDragLeave,
    onPlaylistDragOver,
    onPlaylistDropEvent,
    onRowMouseDown,
  } = usePlaylistDrag({ selectedIds, onDropToPlaylist: handlePlaylistDrop });

  // Playlist menu
  const {
    closeMenu: closePlaylistMenu,
    isOpen: isPlaylistMenuOpen,
    openAt: openPlaylistMenu,
    playlistId: playlistMenuId,
    position: playlistMenuPosition,
  } = usePlaylistMenu();

  const playlistMenuTarget = useMemo(
    () => playlists.find((playlist) => playlist.id === playlistMenuId) ?? null,
    [playlists, playlistMenuId]
  );

  // Playlist operations
  const {
    isPlaylistEditOpen,
    playlistEditName,
    setPlaylistEditName,
    handleOpenPlaylistEdit,
    handleClosePlaylistEdit,
    handleDeletePlaylist,
    handlePlaylistEditSubmit,
  } = usePlaylistOperations({
    currentView: view,
    navigateToView,
  });

  // Inbox operations
  const { handleAcceptTracks, handleRejectTracks } = useInboxOperations();

  // Track analysis
  const {
    analysisTrackIds,
    isAnalysisModalOpen,
    closeAnalysisModal,
    handleAnalysisComplete,
  } = useTrackAnalysis();

  // Track editing
  const {
    editTrackIds,
    isEditModalOpen,
    openEditModal,
    closeEditModal,
    handleSaveMetadata,
  } = useTrackEdit();

  // Panel state
  const {
    sidebarCollapsed,
    sidebarWidth,
    startSidebarResize,
    toggleSidebarCollapsed,
  } = useSidebarPanel();
  const {
    queuePanelCollapsed,
    queuePanelWidth,
    startQueuePanelResize,
    toggleQueuePanelCollapsed,
  } = useQueuePanel();

  // Library initialization and backfill
  const {
    backfillPending,
    backfillStatus,
    coverArtBackfillPending,
    coverArtBackfillStatus,
    clearSongsPending,
    handleBackfillSearchText,
    handleBackfillCoverArt,
    handleClearSongs,
  } = useLibraryInit();

  // Sidebar props
  const sidebarProps = useSidebarData({
    view,
    draggingPlaylistId,
    canGoBack,
    canGoForward,
    onGoBack: goBack,
    onGoForward: goForward,
    onViewChange: navigateToView,
    onPlaylistDrop: onPlaylistDropEvent,
    onPlaylistDragEnter,
    onPlaylistDragLeave,
    onPlaylistDragOver,
    onCreatePlaylist: openPlaylistModal,
    onPlaylistContextMenu: openPlaylistMenu,
  });

  // Native drag
  const { isDragging, nativeDropStatus } = useNativeDrag(handleImportPaths);

  // Context menu handlers
  const handleRowContextMenu = useCallback(
    (
      event: React.MouseEvent,
      trackId: string,
      index: number,
      isSelected: boolean
    ) => {
      openForRow(event, trackId, index, isSelected);
    },
    [openForRow]
  );

  const handleShowBpmKey = useCallback(() => {
    openAnalysisModal(menuSelection);
    closeMenu();
  }, [menuSelection, closeMenu, openAnalysisModal]);

  const handleEdit = useCallback(() => {
    openEditModal(menuSelection);
    closeMenu();
  }, [menuSelection, closeMenu, openEditModal]);

  // Playlist menu handlers
  const handlePlaylistMenuEdit = useCallback(() => {
    if (!playlistMenuTarget) {
      return;
    }
    handleOpenPlaylistEdit(playlistMenuTarget);
    closePlaylistMenu();
  }, [closePlaylistMenu, handleOpenPlaylistEdit, playlistMenuTarget]);

  const handlePlaylistMenuDelete = useCallback(() => {
    if (!playlistMenuId) {
      return;
    }
    closePlaylistMenu();
    handleDeletePlaylist(playlistMenuId);
  }, [closePlaylistMenu, handleDeletePlaylist, playlistMenuId]);

  // Disable user select during internal drag
  useEffect(() => {
    if (!isInternalDrag) {
      document.body.style.userSelect = "";
      return;
    }

    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = "";
    };
  }, [isInternalDrag]);

  // Import handlers
  const handleEmptyImport = useCallback(async () => {
    try {
      const result = await open({
        multiple: true,
        filters: [
          {
            name: "Audio",
            extensions: [
              "mp3",
              "flac",
              "wav",
              "m4a",
              "aac",
              "ogg",
              "aiff",
              "alac",
            ],
          },
        ],
      });

      if (!result) {
        return;
      }

      const paths = Array.isArray(result) ? result : [result];
      handleImportPaths(paths);
    } catch (error) {
      notify.error("File picker failed");
    }
  }, [handleImportPaths]);

  const handleEmptyImportFolder = useCallback(async () => {
    try {
      const result = await open({ directory: true });
      if (!result) {
        return;
      }

      const paths = Array.isArray(result) ? result : [result];
      handleImportPaths(paths);
    } catch (error) {
      notify.error("Folder picker failed");
    }
  }, [handleImportPaths]);

  // Playlist submit handler
  const handlePlaylistSubmit = useCallback(async () => {
    const trimmed = playlistModalName.trim();
    if (!trimmed) {
      return;
    }

    await handleCreatePlaylist(trimmed);
    closePlaylistModal();
  }, [handleCreatePlaylist, playlistModalName, closePlaylistModal]);

  const importPercent = importProgress
    ? Math.min(
        100,
        importProgress.total > 0
          ? Math.round((importProgress.imported / importProgress.total) * 100)
          : 0
      )
    : 0;

  return (
    <div
      className="theme-transition h-screen overflow-hidden bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
      onClick={() => {
        closeMenu();
        closeColumnsMenu();
        closePlaylistMenu();
      }}
    >
      <ToastContainer />
      <DragOverlay
        isDragging={isDragging}
        nativeDropStatus={nativeDropStatus}
        dragIndicator={dragIndicator}
        isInternalDrag={isInternalDrag}
      />
      <PlaylistCreateModal
        isOpen={isPlaylistModalOpen}
        value={playlistModalName}
        onChange={setPlaylistModalName}
        onClose={closePlaylistModal}
        onSubmit={handlePlaylistSubmit}
      />
      <PlaylistEditModal
        isOpen={isPlaylistEditOpen}
        value={playlistEditName}
        onChange={setPlaylistEditName}
        onClose={handleClosePlaylistEdit}
        onSubmit={handlePlaylistEditSubmit}
      />
      <DuplicateTracksModal
        isOpen={pendingPlaylistDrop !== null}
        duplicateTracks={
          pendingPlaylistDrop
            ? pendingPlaylistDrop.duplicateTrackIds
                .map((id) => allTracks.find((t) => t.id === id))
                .filter((t): t is Track => t !== undefined)
            : []
        }
        onClose={cancelPlaylistDropOperation}
        onConfirm={confirmPlaylistDropOperation}
      />
      <AnalysisModal
        isOpen={isAnalysisModalOpen}
        tracks={analysisTrackIds
          .map((id) => allTracks.find((t) => t.id === id))
          .filter((t): t is Track => t !== undefined)}
        dbPath={dbPath}
        onClose={closeAnalysisModal}
        onAnalysisComplete={handleAnalysisComplete}
      />
      <EditTrackModal
        isOpen={isEditModalOpen}
        tracks={editTrackIds
          .map((id) => allTracks.find((t) => t.id === id))
          .filter((t): t is Track => t !== undefined)}
        onClose={closeEditModal}
        onSave={handleSaveMetadata}
      />
      <div
        className="grid h-screen grid-cols-[var(--sidebar-width)_1fr_var(--queue-width)] grid-rows-[1fr_auto_var(--media-controls-height)] overflow-hidden"
        style={
          {
            "--sidebar-width": `${sidebarWidth}px`,
            "--queue-width": `${queuePanelWidth}px`,
          } as CSSProperties
        }
      >
        <AppLayout
          onSidebarResizeStart={startSidebarResize}
          onQueuePanelResizeStart={startQueuePanelResize}
          sidebarCollapsed={sidebarCollapsed}
          detailCollapsed={queuePanelCollapsed}
          sidebar={
            <Sidebar
              {...sidebarProps}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={toggleSidebarCollapsed}
            />
          }
          main={
            <>
              <ContextMenu
                isOpen={Boolean(openMenuId)}
                position={menuPosition}
                selectionCount={menuSelection.length}
                onPlay={() => {
                  if (menuSelection.length > 0) {
                    const firstTrack = allTracks.find(
                      (t) => t.id === menuSelection[0]
                    );
                    if (firstTrack) {
                      playTrack(firstTrack);
                    }
                  }
                  closeMenu();
                }}
                onPlayNext={() => {
                  playNext(menuSelection);
                  closeMenu();
                }}
                onAddToQueue={() => {
                  addToQueue(menuSelection);
                  closeMenu();
                }}
                onShowBpmKey={handleShowBpmKey}
                onEdit={handleEdit}
              />
              <PlaylistContextMenu
                isOpen={isPlaylistMenuOpen}
                position={playlistMenuPosition}
                playlistName={playlistMenuTarget?.name}
                onEdit={handlePlaylistMenuEdit}
                onDelete={handlePlaylistMenuDelete}
              />
              <ColumnsMenu
                isOpen={showColumns}
                position={columnsMenuPosition}
                columns={columns}
                onToggleColumn={toggleColumn}
              />
              <div className="flex min-h-0 flex-1 flex-col">
                <LibraryHeader
                  title={viewConfig.title}
                  subtitle={viewConfig.subtitle}
                  isSettings={viewConfig.type === "settings"}
                  resultCount={sortedTracks.length}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onAddMusic={handleEmptyImport}
                  onShowColumns={openColumnsMenu}
                  onSort={() => handleSortChange("title")}
                />
                {viewConfig.trackTable && importProgress && (
                  <div className="border-b border-[var(--color-border-light)] bg-[var(--color-bg-primary)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
                    <div className="mb-[var(--spacing-xs)] text-[length:var(--font-size-xs)] font-semibold text-[color:var(--color-text-secondary)]">
                      {importProgress.phase === "scanning" ||
                      importProgress.total === 0
                        ? "Scanning files..."
                        : `${importProgress.imported} of ${importProgress.total} songs imported`}
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-[var(--radius-full)] bg-[var(--color-bg-tertiary)]">
                      <div
                        className="h-full rounded-[var(--radius-full)] bg-[var(--color-accent)] transition-all duration-[var(--transition-normal)]"
                        style={{ width: `${importPercent}%` }}
                      />
                    </div>
                  </div>
                )}
                <section className="flex min-h-0 flex-1 flex-col bg-[var(--color-bg-primary)]">
                  {viewConfig.type === "settings" ? (
                    <SettingsPanel
                      theme={theme}
                      locale={locale}
                      themes={themes}
                      localeOptions={localeOptions}
                      dbPath={dbPath}
                      dbFileName={dbFileName}
                      backfillPending={backfillPending}
                      backfillStatus={backfillStatus}
                      coverArtBackfillPending={coverArtBackfillPending}
                      coverArtBackfillStatus={coverArtBackfillStatus}
                      clearSongsPending={clearSongsPending}
                      seekMode={seekMode}
                      onThemeChange={setTheme}
                      onLocaleChange={setLocale}
                      onSeekModeChange={setSeekMode}
                      onDbPathChange={setDbPath}
                      onDbFileNameChange={setDbFileName}
                      onBackfillSearchText={handleBackfillSearchText}
                      onBackfillCoverArt={handleBackfillCoverArt}
                      onClearSongs={handleClearSongs}
                      onUseDefaultLocation={() => setUseAutoDbPath(true)}
                    />
                  ) : (
                    viewConfig.trackTable && (
                      <>
                        <TrackTable
                          tracks={sortedTracks}
                          columns={columns}
                          emptyTitle={
                            searchQuery && sortedTracks.length === 0
                              ? t("search.noResults")
                              : viewConfig.trackTable.emptyState.title
                          }
                          emptyDescription={
                            searchQuery && sortedTracks.length === 0
                              ? ""
                              : viewConfig.trackTable.emptyState.description
                          }
                          emptyActionLabel={
                            searchQuery && sortedTracks.length === 0
                              ? undefined
                              : viewConfig.trackTable.emptyState.primaryAction
                                  ?.label
                          }
                          onEmptyAction={
                            searchQuery && sortedTracks.length === 0
                              ? undefined
                              : viewConfig.trackTable.showImportActions
                                ? handleEmptyImport
                                : undefined
                          }
                          emptySecondaryActionLabel={
                            searchQuery && sortedTracks.length === 0
                              ? undefined
                              : viewConfig.trackTable.emptyState.secondaryAction
                                  ?.label
                          }
                          onEmptySecondaryAction={
                            searchQuery && sortedTracks.length === 0
                              ? undefined
                              : viewConfig.trackTable.showImportActions
                                ? handleEmptyImportFolder
                                : undefined
                          }
                          onRowSelect={handleRowSelect}
                          onRowMouseDown={onRowMouseDown}
                          onRowContextMenu={handleRowContextMenu}
                          onRowDoubleClick={handlePlayTrack}
                          onColumnResize={handleColumnResize}
                          onColumnAutoFit={autoFitColumn}
                          onColumnReorder={reorderColumns}
                          onHeaderContextMenu={openColumnsMenu}
                          onSortChange={handleSortChange}
                          onRatingChange={handleRatingChange}
                        />
                        {viewConfig.trackTable.banner === "inbox" && (
                          <InboxBanner
                            selectedCount={selectedIds.size}
                            onAccept={handleAcceptTracks}
                            onReject={handleRejectTracks}
                          />
                        )}
                      </>
                    )
                  )}
                </section>
              </div>
            </>
          }
          detail={
            <QueuePanel
              collapsed={queuePanelCollapsed}
              onToggleCollapsed={toggleQueuePanelCollapsed}
              queueTracks={queueTracks}
              currentTrack={currentTrack}
              currentTrackDetails={currentTrack ? allTracks.find((track) => track.id === currentTrack.id) : null}
              onRemoveFromQueue={removeFromQueue}
              onReorderQueue={reorderQueue}
              onClearQueue={clearQueue}
            />
          }
        />
        <PlayerBar
          onTogglePlay={togglePlay}
          onSeekChange={seek}
          onVolumeChange={setVolume}
          onSkipPrevious={handleSkipPrevious}
          onSkipNext={handleSkipNext}
        />
      </div>
    </div>
  );
}

export default App;
