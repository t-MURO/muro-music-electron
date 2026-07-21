import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useMatch } from "react-router-dom";
import {
  AppLayout,
  QueuePanel,
  LibraryHeader,
  PlayerBar,
  SettingsPanel,
  Sidebar,
  WindowChrome,
  ColumnsMenu,
  InboxBanner,
  TrackSelectionBar,
  AlbumsView,
  ArtistDetailPanel,
  ArtistIndexView,
  buildArtistIndexItems,
  CollectionIndexView,
  buildCollectionIndexItems,
  TrackTable,
  ContextMenu,
  DeleteTracksModal,
  DragOverlay,
  PlaylistContextMenu,
  AnalysisModal,
  DuplicateTracksModal,
  EditTrackModal,
  MetadataSearchModal,
  AlbumMetadataSearchModal,
  AcoustIdModal,
  ArtistImageModal,
  PlaylistCreateModal,
  PlaylistEditModal,
  SmartCrateModal,
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
  useMixTransition,
  useSidebarPanel,
  useSidebarData,
  useTrackRatings,
  usePlaylistOperations,
  usePlaylistFolders,
  usePlaylistTransfer,
  useInboxOperations,
  useTrackAnalysis,
  useTrackEdit,
  useTrackDeletion,
  useLibraryInit,
  usePlayTracking,
  useKeyboardShortcuts,
  useArtistProfiles,
  normalizeArtistProfileKey,
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
  useSmartCrateStore,
  selectAllTracks,
  notify,
  applyThemeMode,
} from "./stores";
import {
  getPathForView,
  compareSortValues,
  getSortableValue,
  filterTracksBySearch,
  filterTracksAdvanced,
  countAdvancedTrackFilters,
  listTrackFormats,
  filterAlbumsBySearch,
  groupTracksIntoAlbums,
} from "./utils";
import { confirm, open, save } from "@muro/desktop/dialogs";
import { openExternal, showItemInFolder } from "./desktop/shell";
import { isDjMixFeatureAvailable } from "./lib/mix/config";
import type { ArtistImageCandidate, ColumnConfig, SmartCrate, Track, TrackMetadataUpdates } from "./types";

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const playlistMatch = useMatch("/playlists/:playlistId");
  const smartCrateMatch = useMatch("/smart-crates/:smartCrateId");
  const collectionMatch = useMatch("/collection/:facet");

  // Get state from stores
  const tracks = useLibraryStore((s) => s.tracks);
  const inboxTracks = useLibraryStore((s) => s.inboxTracks);
  const playlists = useLibraryStore((s) => s.playlists);
  const playlistFolders = useLibraryStore((s) => s.playlistFolders);
  const allTracks = useLibraryStore(selectAllTracks);
  const allTracksById = useMemo(
    () => new Map(allTracks.map((track) => [track.id, track])),
    [allTracks],
  );

  const recentlyPlayedTracks = useRecentlyPlayedStore((s) => s.recentlyPlayedTracks);
  const smartCrates = useSmartCrateStore((s) => s.smartCrates);
  const createSmartCrate = useSmartCrateStore((s) => s.createSmartCrate);
  const updateSmartCrate = useSmartCrateStore((s) => s.updateSmartCrate);
  const deleteSmartCrate = useSmartCrateStore((s) => s.deleteSmartCrate);
  const [isSmartCrateModalOpen, setIsSmartCrateModalOpen] = useState(false);
  const [editingSmartCrateId, setEditingSmartCrateId] = useState<string | null>(null);
  const [isFolderCreateOpen, setIsFolderCreateOpen] = useState(false);
  const [folderCreateName, setFolderCreateName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderEditName, setFolderEditName] = useState("");
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(() => new Set());
  const [metadataSearchTrackId, setMetadataSearchTrackId] = useState<string | null>(null);
  const [albumMetadataTrackIds, setAlbumMetadataTrackIds] = useState<string[]>([]);
  const [acoustIdTrackIds, setAcoustIdTrackIds] = useState<string[]>([]);
  const [artistImageArtistName, setArtistImageArtistName] = useState<string | null>(null);
  const [revealTrackRequest, setRevealTrackRequest] = useState<{
    trackId: string;
    requestId: number;
  } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{
    folderId: string;
    position: { x: number; y: number };
  } | null>(null);

  const theme = useSettingsStore((s) => s.theme);
  const locale = useSettingsStore((s) => s.locale);
  const seekMode = useSettingsStore((s) => s.seekMode);
  const djMixFeatureEnabled = useSettingsStore((s) => s.djMixEnabled);
  const djMixEnabled = isDjMixFeatureAvailable(djMixFeatureEnabled);
  const dbPath = useSettingsStore((s) => s.dbPath);
  const dbFileName = useSettingsStore((s) => s.dbFileName);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const setSeekMode = useSettingsStore((s) => s.setSeekMode);
  const setDbPath = useSettingsStore((s) => s.setDbPath);
  const setDbFileName = useSettingsStore((s) => s.setDbFileName);
  const setUseAutoDbPath = useSettingsStore((s) => s.setUseAutoDbPath);

  useEffect(() => {
    applyThemeMode(theme);
    if (theme !== "system" || typeof window.matchMedia !== "function") return;

    const colorScheme = window.matchMedia("(prefers-color-scheme: light)");
    const handleColorSchemeChange = () => applyThemeMode("system");
    colorScheme.addEventListener("change", handleColorSchemeChange);
    return () => colorScheme.removeEventListener("change", handleColorSchemeChange);
  }, [theme]);

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
  const advancedTrackFilters = useUIStore((s) => s.advancedTrackFilters);
  const importProgress = useUIStore((s) => s.importProgress);
  const pendingPlaylistDrop = useUIStore((s) => s.pendingPlaylistDrop);
  const isPlaylistModalOpen = useUIStore((s) => s.isPlaylistModalOpen);
  const playlistModalName = useUIStore((s) => s.playlistModalName);
  const selectTrack = useUIStore((s) => s.selectTrack);
  const activateSortView = useUIStore((s) => s.activateSortView);
  const toggleSort = useUIStore((s) => s.toggleSort);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const setAdvancedTrackFilters = useUIStore((s) => s.setAdvancedTrackFilters);
  const resetAdvancedTrackFilters = useUIStore((s) => s.resetAdvancedTrackFilters);
  const openPlaylistModal = useUIStore((s) => s.openPlaylistModal);
  const closePlaylistModal = useUIStore((s) => s.closePlaylistModal);
  const setPlaylistModalName = useUIStore((s) => s.setPlaylistModalName);
  const openAnalysisModal = useUIStore((s) => s.openAnalysisModal);
  const clearSelection = useUIStore((s) => s.clearSelection);

  const view = useMemo((): LibraryView => {
    if (location.pathname === "/inbox") return "inbox";
    if (location.pathname === "/settings") return "settings";
    if (location.pathname === "/recently-played") return "recentlyPlayed";
    if (smartCrateMatch?.params.smartCrateId) {
      return `smartCrate:${smartCrateMatch.params.smartCrateId}` as LibraryView;
    }
    if (collectionMatch?.params.facet) {
      return `collection:${collectionMatch.params.facet}` as LibraryView;
    }
    if (playlistMatch?.params.playlistId) {
      return `playlist:${playlistMatch.params.playlistId}` as LibraryView;
    }
    return "library";
  }, [collectionMatch, location.pathname, playlistMatch, smartCrateMatch]);

  const navigateToView = useCallback(
    (newView: LibraryView) => {
      navigate(getPathForView(newView));
    },
    [navigate]
  );

  useEffect(() => {
    activateSortView(view);
  }, [activateSortView, view]);

  const isAlbumsView = view === "collection:albums";
  const collectionFilterValue = collectionMatch?.params.facet
    ? new URLSearchParams(location.search).get("value")
    : null;
  const isArtistIndex = view === "collection:artists" && !collectionFilterValue;
  const isArtistDetail = view === "collection:artists" && Boolean(collectionFilterValue);
  const collectionIndexFacet = !collectionFilterValue && view === "collection:genres"
    ? "genres"
    : !collectionFilterValue && view === "collection:keys"
      ? "keys"
      : null;
  const selectedAlbumId = isAlbumsView
    ? new URLSearchParams(location.search).get("album")
    : null;

  const handleSelectAlbum = useCallback(
    (albumId: string | null) => {
      if (!albumId) {
        navigate("/collection/albums");
        return;
      }
      const params = new URLSearchParams();
      params.set("album", albumId);
      navigate({ pathname: "/collection/albums", search: params.toString() });
    },
    [navigate]
  );

  const handleOpenCollectionValue = useCallback((facet: "artists" | "genres" | "keys", value: string) => {
    const params = new URLSearchParams();
    params.set("value", value);
    navigate({ pathname: `/collection/${facet}`, search: params.toString() });
  }, [navigate]);

  const handleOpenArtistSource = useCallback((url: string) => {
    void openExternal(url).catch(() => notify.error("Could not open artist source"));
  }, []);

  // Redirect unknown paths to library
  useEffect(() => {
    const { pathname } = location;
    const isKnownPath =
      pathname === "/" ||
      pathname === "/inbox" ||
      pathname === "/settings" ||
      pathname === "/recently-played" ||
      pathname.startsWith("/collection/") ||
      pathname.startsWith("/playlists/") ||
      pathname.startsWith("/smart-crates/");
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
    smartCrates,
    collectionFilterValue,
  });

  // Filtering and sorting
  const displayedTracks = viewConfig.trackTable?.tracks ?? [];
  const {
    profiles: artistProfiles,
    loadingKeys: artistProfileLoadingKeys,
    errors: artistProfileErrors,
    loadProfile: loadArtistProfile,
    searchImages: searchArtistProfileImages,
    selectImage: selectArtistProfileImage,
  } = useArtistProfiles();
  const albums = useMemo(() => groupTracksIntoAlbums(tracks), [tracks]);
  const handleOpenTableArtist = useCallback(
    (artist: string) => handleOpenCollectionValue("artists", artist),
    [handleOpenCollectionValue],
  );
  const handleOpenTableAlbum = useCallback(
    (trackId: string) => {
      const album = albums.find((item) => item.tracks.some((track) => track.id === trackId));
      if (album) {
        handleSelectAlbum(album.id);
      }
    },
    [albums, handleSelectAlbum],
  );
  const albumResults = useMemo(
    () => filterAlbumsBySearch(albums, searchQuery),
    [albums, searchQuery]
  );
  const collectionIndexItems = useMemo(
    () => collectionIndexFacet ? buildCollectionIndexItems(tracks, collectionIndexFacet) : [],
    [collectionIndexFacet, tracks],
  );
  const collectionIndexResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return query
      ? collectionIndexItems.filter((item) => item.value.toLocaleLowerCase().includes(query))
      : collectionIndexItems;
  }, [collectionIndexItems, searchQuery]);
  const artistIndexItems = useMemo(() => buildArtistIndexItems(tracks), [tracks]);
  const artistIndexResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return query
      ? artistIndexItems.filter((item) => item.name.toLocaleLowerCase().includes(query))
      : artistIndexItems;
  }, [artistIndexItems, searchQuery]);
  const selectedArtistName = isArtistDetail ? collectionFilterValue?.trim() ?? "" : "";
  const selectedArtistKey = normalizeArtistProfileKey(selectedArtistName);
  const selectedArtistProfile = artistProfiles[selectedArtistKey];
  const selectedArtistProfileLoading = artistProfileLoadingKeys.has(selectedArtistKey);
  const selectedArtistProfileError = artistProfileErrors[selectedArtistKey];
  const selectedArtistAlbumCount = useMemo(() => new Set(
    displayedTracks
      .map((track) => track.album.trim().toLocaleLowerCase())
      .filter(Boolean),
  ).size, [displayedTracks]);

  useEffect(() => {
    if (!selectedArtistName) return;
    void loadArtistProfile(selectedArtistName);
  }, [loadArtistProfile, selectedArtistName]);

  const handleSelectArtistImage = useCallback(async (
    artistName: string,
    candidate: ArtistImageCandidate,
  ) => {
    await selectArtistProfileImage(artistName, candidate);
    notify.success("Artist picture updated");
  }, [selectArtistProfileImage]);

  const filterFormats = useMemo(
    () => listTrackFormats(displayedTracks),
    [displayedTracks],
  );
  const activeTrackFilterCount = useMemo(
    () => countAdvancedTrackFilters(advancedTrackFilters),
    [advancedTrackFilters],
  );

  // Apply text search first, then the structured track filters.
  const filteredTracks = useMemo(() => {
    const searchResults = filterTracksBySearch(displayedTracks, searchQuery);
    return filterTracksAdvanced(searchResults, advancedTrackFilters);
  }, [advancedTrackFilters, displayedTracks, searchQuery]);
  const hasTrackSearchFilters = searchQuery.trim().length > 0 || activeTrackFilterCount > 0;

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

  const selectedVisibleTrackIds = useMemo(
    () => sortedTracks.filter((track) => selectedIds.has(track.id)).map((track) => track.id),
    [selectedIds, sortedTracks],
  );

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
  const { closeMenu, menuPosition, menuSelection, openForRow, openForSelection, openMenuId } =
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

  // Track end handler for auto-advance. advanceToNext depends on playTrack
  // (defined below by useAudioPlayback), so it is routed through a ref.
  const advanceToNextRef = useRef<() => void>(() => {});
  const handleTrackEnd = useCallback(() => {
    const transition = usePlaybackStore.getState().transition;
    if (transition && (transition.status === "armed" || transition.status === "active")) {
      // The mix engine owns this track boundary and hands off playback itself.
      return;
    }
    advanceToNextRef.current();
  }, []);

  // Media control refs for skip handlers (needed before useAudioPlayback)
  const skipPreviousRef = useRef<() => void>(() => {});
  const skipNextRef = useRef<() => void>(() => {});
  const mediaPlaybackRef = useRef<{
    play: () => void | Promise<void>;
    pause: () => void | Promise<void>;
    toggle: () => void | Promise<void>;
  }>({ play: () => {}, pause: () => {}, toggle: () => {} });

  // Media control handler
  const handleMediaControl = useCallback((action: string) => {
    switch (action) {
      case "next":
        skipNextRef.current();
        break;
      case "previous":
        skipPreviousRef.current();
        break;
      case "play":
        void mediaPlaybackRef.current.play();
        break;
      case "pause":
        void mediaPlaybackRef.current.pause();
        break;
      case "toggle":
        void mediaPlaybackRef.current.toggle();
        break;
    }
  }, []);

  // Audio playback
  const {
    isPlaying,
    currentPosition,
    currentTrack,
    playTrack,
    togglePlay,
    play,
    pause,
    seek,
    setVolume,
  } = useAudioPlayback({ onTrackEnd: handleTrackEnd, onMediaControl: handleMediaControl, seekMode });

  const playbackContextIdsRef = useRef<string[]>([]);
  const playbackSourceRef = useRef<{ path: string; trackIds: string[] } | null>(null);
  const playTrackById = useCallback((trackId: string, contextTracks?: Track[], sourcePath?: string) => {
    const track = allTracksById.get(trackId);
    if (!track) return;
    if (contextTracks && contextTracks.some((item) => item.id === trackId)) {
      const trackIds = contextTracks.map((item) => item.id);
      playbackContextIdsRef.current = trackIds;
      playbackSourceRef.current = {
        path: sourcePath ?? `${location.pathname}${location.search}`,
        trackIds,
      };
    }
    void playTrack(track);
  }, [allTracksById, location.pathname, location.search, playTrack]);

  const handleOpenCurrentTrack = useCallback(() => {
    const activeTrackId = usePlaybackStore.getState().currentTrack?.id;
    if (!activeTrackId) return;

    const source = playbackSourceRef.current;
    const destination = source?.trackIds.includes(activeTrackId) ? source.path : "/";
    setSearchQuery("");
    setRevealTrackRequest((current) => ({
      trackId: activeTrackId,
      requestId: (current?.requestId ?? 0) + 1,
    }));
    if (`${location.pathname}${location.search}` !== destination) {
      navigate(destination);
    }
  }, [location.pathname, location.search, navigate, setSearchQuery]);

  const getPlaybackContext = useCallback((activeTrackId: string | null) => {
    const remembered = playbackContextIdsRef.current
      .map((id) => allTracksById.get(id))
      .filter((track): track is Track => track !== undefined);
    if (activeTrackId && remembered.some((track) => track.id === activeTrackId)) {
      return remembered;
    }
    if (activeTrackId && sortedTracks.some((track) => track.id === activeTrackId)) {
      return sortedTracks;
    }
    return allTracks;
  }, [allTracks, allTracksById, sortedTracks]);

  // DJ-style transitions (manual pair mix + auto-mix into the queue)
  const { mixCurrentWith, mixSelectedPair, transition } = useMixTransition({
    enabled: djMixEnabled,
    allTracks,
    playTrack,
    seek,
  });

  // Play tracking (30-second threshold)
  usePlayTracking({ currentPosition, allTracks });

  // Skip handlers
  const handleSkipPrevious = useCallback(() => {
    const playbackState = usePlaybackStore.getState();
    if (playbackState.currentPosition > 3) {
      void seek(0);
      return;
    }
    const playbackList = getPlaybackContext(playbackState.currentTrack?.id ?? null);
    const currentIndex = playbackState.currentTrack
      ? playbackList.findIndex((track) => track.id === playbackState.currentTrack?.id)
      : -1;
    if (currentIndex > 0) {
      void playTrack(playbackList[currentIndex - 1]);
    }
  }, [getPlaybackContext, seek, playTrack]);

  // Shared advance logic for skip-next and natural track end.
  const advanceToNext = useCallback(() => {
    const currentQueue = usePlaybackStore.getState().queue;

    // If there's a track in the queue, use it
    if (currentQueue.length > 0) {
      const nextTrackId = currentQueue[0];
      const nextTrack = allTracksById.get(nextTrackId);
      if (nextTrack) {
        setQueue(currentQueue.slice(1));
        void playTrack(nextTrack);
        return;
      }
    }

    // No queue - fall back to normal progression
    const activeTrack = usePlaybackStore.getState().currentTrack;
    const playbackList = getPlaybackContext(activeTrack?.id ?? null);
    const currentIndex = activeTrack
      ? playbackList.findIndex((track) => track.id === activeTrack.id)
      : -1;

    // Shuffle
    if (shuffleEnabled && playbackList.length > 0) {
      const randomIndex = Math.floor(Math.random() * playbackList.length);
      void playTrack(playbackList[randomIndex]);
      return;
    }

    // Next track in list
    if (currentIndex >= 0 && currentIndex < playbackList.length - 1) {
      void playTrack(playbackList[currentIndex + 1]);
      return;
    }

    // Repeat all - wrap to beginning
    if (repeatMode === "all" && playbackList.length > 0) {
      void playTrack(playbackList[0]);
    }
  }, [allTracksById, getPlaybackContext, shuffleEnabled, repeatMode, playTrack, setQueue]);

  const handleSkipNext = advanceToNext;

  // Update refs for media control and track-end handlers
  useEffect(() => {
    advanceToNextRef.current = advanceToNext;
  }, [advanceToNext]);

  useEffect(() => {
    skipPreviousRef.current = handleSkipPrevious;
  }, [handleSkipPrevious]);

  useEffect(() => {
    skipNextRef.current = handleSkipNext;
  }, [handleSkipNext]);

  useEffect(() => {
    mediaPlaybackRef.current = { play, pause, toggle: togglePlay };
  }, [pause, play, togglePlay]);

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
      playTrackById(trackId, sortedTracks.length > 0 ? sortedTracks : allTracks);
    },
    [allTracks, playTrackById, sortedTracks]
  );

  const handlePlayAlbumTrack = useCallback((trackId: string) => {
    const album = albums.find((item) => item.tracks.some((track) => track.id === trackId));
    playTrackById(trackId, album?.tracks);
  }, [albums, playTrackById]);

  const handlePlayAlbum = useCallback(
    (trackIds: string[]) => {
      if (trackIds.length === 0) return;
      const contextTracks = trackIds
        .map((id) => allTracksById.get(id))
        .filter((track): track is Track => track !== undefined);
      const album = albums.find((item) => item.tracks.some((track) => track.id === trackIds[0]));
      const sourcePath = album
        ? `/collection/albums?album=${encodeURIComponent(album.id)}`
        : undefined;
      setQueue(trackIds.slice(1));
      playTrackById(trackIds[0], contextTracks, sourcePath);
    },
    [albums, allTracksById, playTrackById, setQueue]
  );

  const { importPlaylist, importPlaylistFolder, exportPlaylist } = usePlaylistTransfer();

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
    onPlaylistFolderDetected: async (directoryPath) => {
      const imported = await importPlaylistFolder(directoryPath);
      const firstPlaylistId = imported?.playlistIds[0];
      if (firstPlaylistId) navigateToView(`playlist:${firstPlaylistId}` as LibraryView);
    },
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
  const playlistMenuSelection = useMemo(() => {
    if (!playlistMenuId) return [];
    if (!selectedPlaylistIds.has(playlistMenuId)) {
      return playlistMenuTarget ? [playlistMenuTarget] : [];
    }
    const selected: typeof playlists = [];
    for (const playlistId of selectedPlaylistIds) {
      const playlist = playlists.find((candidate) => candidate.id === playlistId);
      if (playlist) selected.push(playlist);
    }
    return selected;
  }, [playlistMenuId, playlistMenuTarget, playlists, selectedPlaylistIds]);
  const playlistMenuCommonFolderId = useMemo(() => {
    if (playlistMenuSelection.length === 0) return undefined;
    const folderIds = new Set(playlistMenuSelection.map((playlist) => playlist.folderId ?? ""));
    if (folderIds.size !== 1) return undefined;
    const folderId = [...folderIds][0];
    return folderId || undefined;
  }, [playlistMenuSelection]);
  const folderMenuTarget = useMemo(
    () => playlistFolders.find((folder) => folder.id === folderMenu?.folderId) ?? null,
    [folderMenu?.folderId, playlistFolders],
  );
  const playlistFolderOptions = useMemo(() => {
    const byId = new Map(playlistFolders.map((folder) => [folder.id, folder]));
    const pathFor = (folderId: string, visited = new Set<string>()): string => {
      const folder = byId.get(folderId);
      if (!folder || visited.has(folderId)) return "";
      visited.add(folderId);
      const parentPath = folder.parentId ? pathFor(folder.parentId, visited) : "";
      return parentPath ? `${parentPath} / ${folder.name}` : folder.name;
    };
    return playlistFolders.map((folder) => ({
      ...folder,
      name: pathFor(folder.id) || folder.name,
    }));
  }, [playlistFolders]);
  const playlistAddOptions = useMemo(() => {
    const folderNames = new Map(playlistFolderOptions.map((folder) => [folder.id, folder.name]));
    return playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      trackCount: playlist.trackIds.length,
      folderName: playlist.folderId ? folderNames.get(playlist.folderId) : undefined,
    }));
  }, [playlistFolderOptions, playlists]);

  // Playlist operations
  const {
    isPlaylistEditOpen,
    playlistEditName,
    setPlaylistEditName,
    handleOpenPlaylistEdit,
    handleClosePlaylistEdit,
    handleDeletePlaylists,
    handleRemoveTracksFromPlaylist,
    handlePlaylistEditSubmit,
  } = usePlaylistOperations({
    currentView: view,
    navigateToView,
  });
  const {
    createFolder,
    renameFolder,
    removeFolder,
    movePlaylists,
    reorderPlaylist,
  } = usePlaylistFolders();

  // Inbox operations
  const { handleAcceptTracks, handleRejectTracks } = useInboxOperations();

  // Track analysis
  const {
    analysisTrackIds,
    isAnalysisModalOpen,
    isAnalysisModalMinimized,
    closeAnalysisModal,
    minimizeAnalysisModal,
    restoreAnalysisModal,
    handleAnalysisComplete,
  } = useTrackAnalysis();

  const analysisTracks = useMemo(
    () => analysisTrackIds
      .map((id) => allTracks.find((track) => track.id === id))
      .filter((track): track is Track => track !== undefined),
    [allTracks, analysisTrackIds]
  );

  // Track editing
  const {
    editTrackIds,
    isEditModalOpen,
    openEditModal,
    closeEditModal,
    handleSaveMetadata,
    handleFetchCoverArt,
    handleSearchMetadata,
    handleSearchAlbumMetadata,
    handleLoadAlbumMetadata,
    handleIdentifyWithAcoustId,
  } = useTrackEdit();

  const metadataSearchTrack = metadataSearchTrackId
    ? allTracksById.get(metadataSearchTrackId) ?? null
    : null;

  const handleApplySearchedMetadata = useCallback(async (updates: TrackMetadataUpdates) => {
    if (!metadataSearchTrackId) return;
    await handleSaveMetadata([metadataSearchTrackId], updates);
  }, [handleSaveMetadata, metadataSearchTrackId]);

  const albumMetadataTracks = useMemo(
    () => albumMetadataTrackIds.map((id) => allTracksById.get(id)).filter((track): track is Track => Boolean(track)),
    [albumMetadataTrackIds, allTracksById],
  );

  const handleApplyAlbumMetadata = useCallback(async (
    entries: Array<{ trackId: string; updates: TrackMetadataUpdates }>,
  ) => {
    for (const entry of entries) {
      await handleSaveMetadata([entry.trackId], entry.updates);
    }
  }, [handleSaveMetadata]);

  const acoustIdTracks = useMemo(
    () => acoustIdTrackIds
      .map((id) => allTracksById.get(id))
      .filter((track): track is Track => Boolean(track)),
    [acoustIdTrackIds, allTracksById],
  );

  const handleApplyAcoustIdMatches = useCallback(async (
    entries: Array<{ trackId: string; updates: TrackMetadataUpdates }>,
  ) => {
    for (const entry of entries) {
      await handleSaveMetadata([entry.trackId], entry.updates);
    }
    notify.success(`Applied AcoustID metadata to ${entries.length} ${entries.length === 1 ? "track" : "tracks"}`);
  }, [handleSaveMetadata]);

  const {
    pendingTracks: pendingDeleteTracks,
    isDeleting: isDeletingTracks,
    lastDeleteMode,
    requestTrackDeletion,
    closeTrackDeletion,
    removePendingFromLibrary,
    deletePendingFromDisk,
  } = useTrackDeletion();

  // Panel state
  const {
    sidebarCollapsed,
    sidebarWidth,
    startSidebarResize,
    toggleSidebarCollapsed,
  } = useSidebarPanel();
  const {
    queuePanelCollapsed,
    queuePanelExpanded,
    queuePanelWidth,
    startQueuePanelResize,
    toggleQueuePanelCollapsed,
    toggleQueuePanelExpanded,
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

  const editingSmartCrate = useMemo(
    () => smartCrates.find((crate) => crate.id === editingSmartCrateId) ?? null,
    [editingSmartCrateId, smartCrates],
  );

  const handleCreateSmartCrate = useCallback(() => {
    setEditingSmartCrateId(null);
    setIsSmartCrateModalOpen(true);
  }, []);

  const handleEditSmartCrate = useCallback((id: string) => {
    setEditingSmartCrateId(id);
    setIsSmartCrateModalOpen(true);
  }, []);

  const handleCloseSmartCrateModal = useCallback(() => {
    setIsSmartCrateModalOpen(false);
    setEditingSmartCrateId(null);
  }, []);

  const handleSaveSmartCrate = useCallback((crate: Omit<SmartCrate, "id">) => {
    if (editingSmartCrateId) {
      updateSmartCrate(editingSmartCrateId, crate);
      notify.success(`Updated ${crate.name}`);
      navigateToView(`smartCrate:${editingSmartCrateId}` as LibraryView);
    } else {
      const id = createSmartCrate(crate);
      notify.success(`Created ${crate.name}`);
      navigateToView(`smartCrate:${id}` as LibraryView);
    }
    handleCloseSmartCrateModal();
  }, [
    createSmartCrate,
    editingSmartCrateId,
    handleCloseSmartCrateModal,
    navigateToView,
    updateSmartCrate,
  ]);

  const handleDeleteSmartCrate = useCallback(async (id: string) => {
    const crate = smartCrates.find((item) => item.id === id);
    if (!crate) return;
    const shouldDelete = await confirm(
      `Delete the Smart Crate “${crate.name}”? Your tracks will stay in the library.`,
      { title: "Delete Smart Crate", kind: "warning" },
    );
    if (!shouldDelete) return;
    deleteSmartCrate(id);
    if (view === `smartCrate:${id}`) navigateToView("library");
    notify.success(`Deleted ${crate.name}`);
  }, [deleteSmartCrate, navigateToView, smartCrates, view]);

  useEffect(() => {
    const available = new Set(playlists.map((playlist) => playlist.id));
    setSelectedPlaylistIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      if (next.size === current.size) return current;
      return next;
    });
  }, [playlists]);

  const handlePlaylistSelectionChange = useCallback((ids: string[]) => {
    setSelectedPlaylistIds(new Set(ids));
  }, []);

  const handleOpenPlaylistMenu = useCallback((
    event: React.MouseEvent<HTMLButtonElement>,
    playlistId: string,
  ) => {
    setFolderMenu(null);
    setSelectedPlaylistIds((current) => current.has(playlistId)
      ? current
      : new Set([playlistId]));
    openPlaylistMenu(event, playlistId);
  }, [openPlaylistMenu]);

  const handleOpenFolderMenu = useCallback((
    event: React.MouseEvent<HTMLButtonElement>,
    folderId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    closePlaylistMenu();
    setFolderMenu({ folderId, position: { x: event.clientX, y: event.clientY } });
  }, [closePlaylistMenu]);

  const handleImportPlaylistFile = useCallback(async () => {
    try {
      const result = await open({
        multiple: false,
        filters: [{ name: "Playlists", extensions: ["m3u", "m3u8", "pls"] }],
      });
      const filePath = Array.isArray(result) ? result[0] : result;
      if (!filePath) return;
      const playlistId = await importPlaylist(filePath);
      if (playlistId) navigateToView(`playlist:${playlistId}` as LibraryView);
    } catch {
      notify.error("Playlist picker failed");
    }
  }, [importPlaylist, navigateToView]);

  const handleImportPlaylistFolder = useCallback(async () => {
    try {
      const result = await open({ directory: true });
      const directoryPath = Array.isArray(result) ? result[0] : result;
      if (!directoryPath) return;
      const imported = await importPlaylistFolder(directoryPath);
      const firstPlaylistId = imported?.playlistIds[0];
      if (firstPlaylistId) navigateToView(`playlist:${firstPlaylistId}` as LibraryView);
    } catch {
      notify.error("Playlist folder picker failed");
    }
  }, [importPlaylistFolder, navigateToView]);

  const handleOpenFolderCreate = useCallback(() => {
    setFolderCreateName("");
    setIsFolderCreateOpen(true);
  }, []);

  const handlePlaylistReorder = useCallback((
    sourceId: string,
    targetId: string,
    placement: "before" | "after",
  ) => {
    void reorderPlaylist(sourceId, targetId, placement);
  }, [reorderPlaylist]);

  // Sidebar props
  const sidebarProps = useSidebarData({
    view,
    draggingPlaylistId,
    onViewChange: navigateToView,
    onPlaylistDrop: onPlaylistDropEvent,
    onPlaylistDragEnter,
    onPlaylistDragLeave,
    onPlaylistDragOver,
    onCreatePlaylist: openPlaylistModal,
    onPlaylistContextMenu: handleOpenPlaylistMenu,
    onCreatePlaylistFolder: handleOpenFolderCreate,
    onImportPlaylist: handleImportPlaylistFile,
    onImportPlaylistFolder: handleImportPlaylistFolder,
    selectedPlaylistIds,
    onPlaylistSelectionChange: handlePlaylistSelectionChange,
    onPlaylistReorder: handlePlaylistReorder,
    onPlaylistFolderContextMenu: handleOpenFolderMenu,
    onCreateSmartCrate: handleCreateSmartCrate,
    onEditSmartCrate: handleEditSmartCrate,
    onDeleteSmartCrate: (id) => { void handleDeleteSmartCrate(id); },
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

  const handleAlbumTracksContextMenu = useCallback(
    (event: React.MouseEvent, trackIds: string[]) => {
      openForSelection(event, trackIds);
    },
    [openForSelection]
  );

  const handleTableAlbumContextMenu = useCallback((event: React.MouseEvent, trackId: string) => {
    const album = albums.find((item) => item.tracks.some((track) => track.id === trackId));
    if (!album) return;
    openForSelection(event, album.tracks.map((track) => track.id));
  }, [albums, openForSelection]);

  const handleShowBpmKey = useCallback(() => {
    openAnalysisModal(menuSelection);
    closeMenu();
  }, [menuSelection, closeMenu, openAnalysisModal]);

  const handleShowInFinder = useCallback(() => {
    const track = menuSelection.length === 1
      ? allTracks.find((item) => item.id === menuSelection[0])
      : undefined;
    closeMenu();
    if (!track) return;
    void showItemInFolder(track.sourcePath).catch(() => {
      notify.error("Could not show the track in Finder");
    });
  }, [allTracks, closeMenu, menuSelection]);

  const handleEdit = useCallback(() => {
    openEditModal(menuSelection);
    closeMenu();
  }, [menuSelection, closeMenu, openEditModal]);

  const handleOpenMetadataSearch = useCallback(() => {
    const trackId = menuSelection.length === 1 ? menuSelection[0] : null;
    closeMenu();
    if (trackId) setMetadataSearchTrackId(trackId);
  }, [closeMenu, menuSelection]);

  const menuAlbumTracks = useMemo(
    () => menuSelection.map((id) => allTracksById.get(id)).filter((track): track is Track => Boolean(track)),
    [allTracksById, menuSelection],
  );
  const menuIsSingleAlbum = menuAlbumTracks.length > 1
    && menuAlbumTracks.every((track) => (
      track.album.trim().toLocaleLowerCase() === menuAlbumTracks[0].album.trim().toLocaleLowerCase()
      && (track.artists || track.artist).trim().toLocaleLowerCase()
        === (menuAlbumTracks[0].artists || menuAlbumTracks[0].artist).trim().toLocaleLowerCase()
    ));

  const handleOpenAlbumMetadataSearch = useCallback(() => {
    const trackIds = menuIsSingleAlbum ? menuAlbumTracks.map((track) => track.id) : [];
    closeMenu();
    if (trackIds.length > 0) setAlbumMetadataTrackIds(trackIds);
  }, [closeMenu, menuAlbumTracks, menuIsSingleAlbum]);

  const handleOpenAcoustId = useCallback(() => {
    const trackIds = [...menuSelection];
    closeMenu();
    if (trackIds.length > 0) setAcoustIdTrackIds(trackIds);
  }, [closeMenu, menuSelection]);

  const handleDeleteTracks = useCallback(() => {
    const trackIds = [...menuSelection];
    closeMenu();
    requestTrackDeletion(trackIds);
  }, [closeMenu, menuSelection, requestTrackDeletion]);

  const handleRemoveMenuTracksFromPlaylist = useCallback(() => {
    const playlistId = viewConfig.playlist?.id;
    const trackIds = [...menuSelection];
    closeMenu();
    if (playlistId) void handleRemoveTracksFromPlaylist(playlistId, trackIds);
  }, [closeMenu, handleRemoveTracksFromPlaylist, menuSelection, viewConfig.playlist]);

  const handleRemoveSelectedFromPlaylist = useCallback(() => {
    const playlistId = viewConfig.playlist?.id;
    if (playlistId) {
      void handleRemoveTracksFromPlaylist(playlistId, selectedVisibleTrackIds);
    }
  }, [handleRemoveTracksFromPlaylist, selectedVisibleTrackIds, viewConfig.playlist]);

  const handlePlaySelected = useCallback(() => {
    const [firstTrackId, ...remainingTrackIds] = selectedVisibleTrackIds;
    if (!firstTrackId) return;
    setQueue(remainingTrackIds);
    handlePlayTrack(firstTrackId);
  }, [handlePlayTrack, selectedVisibleTrackIds, setQueue]);

  const handleAnalyzeSelected = useCallback(() => {
    if (selectedVisibleTrackIds.length > 0) openAnalysisModal(selectedVisibleTrackIds);
  }, [openAnalysisModal, selectedVisibleTrackIds]);

  const handleEditSelected = useCallback(() => {
    if (selectedVisibleTrackIds.length > 0) openEditModal(selectedVisibleTrackIds);
  }, [openEditModal, selectedVisibleTrackIds]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedVisibleTrackIds.length > 0) requestTrackDeletion(selectedVisibleTrackIds);
  }, [requestTrackDeletion, selectedVisibleTrackIds]);

  // Playlist menu handlers
  const handlePlaylistMenuEdit = useCallback(() => {
    if (!playlistMenuTarget || playlistMenuSelection.length !== 1) {
      return;
    }
    handleOpenPlaylistEdit(playlistMenuTarget);
    closePlaylistMenu();
  }, [closePlaylistMenu, handleOpenPlaylistEdit, playlistMenuSelection.length, playlistMenuTarget]);

  const handlePlaylistMenuDelete = useCallback(() => {
    const ids = playlistMenuSelection.map((playlist) => playlist.id);
    if (ids.length === 0) return;
    closePlaylistMenu();
    setSelectedPlaylistIds(new Set());
    void handleDeletePlaylists(ids);
  }, [closePlaylistMenu, handleDeletePlaylists, playlistMenuSelection]);

  const handlePlaylistMenuExport = useCallback(async () => {
    if (!playlistMenuTarget) return;
    closePlaylistMenu();
    const safeName = playlistMenuTarget.name.replace(/[<>:"/\\|?*]+/g, "-").trim() || "playlist";
    try {
      const filePath = await save({
        defaultPath: `${safeName}.m3u8`,
        filters: [{ name: "M3U8 Playlist", extensions: ["m3u8"] }],
      });
      if (filePath) await exportPlaylist(playlistMenuTarget.id, filePath);
    } catch {
      notify.error("Playlist export dialog failed");
    }
  }, [closePlaylistMenu, exportPlaylist, playlistMenuTarget]);

  const handleMovePlaylist = useCallback((folderId: string | null) => {
    const ids = playlistMenuSelection.map((playlist) => playlist.id);
    if (ids.length === 0) return;
    closePlaylistMenu();
    void movePlaylists(ids, folderId);
  }, [closePlaylistMenu, movePlaylists, playlistMenuSelection]);

  const handleFolderCreateSubmit = useCallback(async () => {
    if (await createFolder(folderCreateName)) {
      setIsFolderCreateOpen(false);
      setFolderCreateName("");
    }
  }, [createFolder, folderCreateName]);

  const handleFolderMenuEdit = useCallback(() => {
    if (!folderMenuTarget) return;
    setEditingFolderId(folderMenuTarget.id);
    setFolderEditName(folderMenuTarget.name);
    setFolderMenu(null);
  }, [folderMenuTarget]);

  const handleFolderEditSubmit = useCallback(async () => {
    if (!editingFolderId) return;
    if (await renameFolder(editingFolderId, folderEditName)) {
      setEditingFolderId(null);
      setFolderEditName("");
    }
  }, [editingFolderId, folderEditName, renameFolder]);

  const handleFolderMenuDelete = useCallback(async () => {
    if (!folderMenuTarget) return;
    const target = folderMenuTarget;
    setFolderMenu(null);
    const destination = target.parentId ? "its parent folder" : "the Playlists section";
    const shouldDelete = await confirm(
      `Delete the playlist folder “${target.name}”? Its playlists and subfolders will move to ${destination}.`,
      { title: "Delete Playlist Folder", kind: "warning" },
    );
    if (shouldDelete) await removeFolder(target.id);
  }, [folderMenuTarget, removeFolder]);

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
      className="theme-transition flex h-screen flex-col overflow-hidden bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
      onClick={() => {
        closeMenu();
        closeColumnsMenu();
        closePlaylistMenu();
        setFolderMenu(null);
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
      <PlaylistCreateModal
        isOpen={isFolderCreateOpen}
        value={folderCreateName}
        onChange={setFolderCreateName}
        onClose={() => setIsFolderCreateOpen(false)}
        onSubmit={() => { void handleFolderCreateSubmit(); }}
        title="New playlist folder"
        subtitle="Group related playlists without changing their tracks."
        placeholder="Folder name"
        submitLabel="Create folder"
      />
      <PlaylistEditModal
        isOpen={Boolean(editingFolderId)}
        value={folderEditName}
        onChange={setFolderEditName}
        onClose={() => {
          setEditingFolderId(null);
          setFolderEditName("");
        }}
        onSubmit={() => { void handleFolderEditSubmit(); }}
        title="Rename playlist folder"
        subtitle="Choose a name that makes this playlist group easy to find."
        placeholder="Folder name"
        submitLabel="Save"
      />
      <SmartCrateModal
        isOpen={isSmartCrateModalOpen}
        crate={editingSmartCrate}
        onClose={handleCloseSmartCrateModal}
        onSave={handleSaveSmartCrate}
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
      <DeleteTracksModal
        tracks={pendingDeleteTracks}
        isDeleting={isDeletingTracks}
        preferredMode={lastDeleteMode}
        onClose={closeTrackDeletion}
        onRemoveFromLibrary={removePendingFromLibrary}
        onDeleteFromDisk={deletePendingFromDisk}
      />
      <AnalysisModal
        isOpen={isAnalysisModalOpen}
        isMinimized={isAnalysisModalMinimized}
        tracks={analysisTracks}
        dbPath={dbPath}
        onClose={closeAnalysisModal}
        onMinimize={minimizeAnalysisModal}
        onRestore={restoreAnalysisModal}
        onAnalysisComplete={handleAnalysisComplete}
      />
      <EditTrackModal
        isOpen={isEditModalOpen}
        libraryTracks={allTracks}
        tracks={editTrackIds
          .map((id) => allTracks.find((t) => t.id === id))
          .filter((t): t is Track => t !== undefined)}
        onClose={closeEditModal}
        onSave={handleSaveMetadata}
        onFetchCoverArt={handleFetchCoverArt}
      />
      <MetadataSearchModal
        track={metadataSearchTrack}
        onClose={() => setMetadataSearchTrackId(null)}
        onSearch={handleSearchMetadata}
        onApply={handleApplySearchedMetadata}
      />
      <AlbumMetadataSearchModal
        tracks={albumMetadataTracks}
        onClose={() => setAlbumMetadataTrackIds([])}
        onSearch={handleSearchAlbumMetadata}
        onLoadRelease={handleLoadAlbumMetadata}
        onApply={handleApplyAlbumMetadata}
      />
      <AcoustIdModal
        tracks={acoustIdTracks}
        onClose={() => setAcoustIdTrackIds([])}
        onIdentify={handleIdentifyWithAcoustId}
        onApply={handleApplyAcoustIdMatches}
      />
      <ArtistImageModal
        artistName={artistImageArtistName}
        onClose={() => setArtistImageArtistName(null)}
        onSearch={searchArtistProfileImages}
        onApply={handleSelectArtistImage}
        onOpenSource={handleOpenArtistSource}
      />
      <WindowChrome />
      <div
        className="app-shell-grid grid min-h-0 flex-1 grid-cols-[var(--sidebar-width)_1fr_var(--queue-width)] grid-rows-[1fr_auto_var(--media-controls-height)] overflow-hidden"
        data-app-shell-grid
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
                onClose={closeMenu}
                onPlay={() => {
                  if (menuSelection.length > 0) {
                    const firstTrack = allTracksById.get(menuSelection[0]);
                    if (firstTrack) {
                      const album = isAlbumsView
                        ? albums.find((item) => item.tracks.some((track) => track.id === firstTrack.id))
                        : undefined;
                      playTrackById(
                        firstTrack.id,
                        album?.tracks ?? (sortedTracks.length > 0 ? sortedTracks : allTracks),
                        album ? `/collection/albums?album=${encodeURIComponent(album.id)}` : undefined,
                      );
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
                playlistOptions={playlistAddOptions}
                onAddToPlaylist={(playlistId) => {
                  const trackIds = [...menuSelection];
                  closeMenu();
                  handlePlaylistDrop(playlistId, trackIds);
                }}
                onShowInFinder={menuSelection.length === 1 ? handleShowInFinder : undefined}
                onSearchMetadata={menuSelection.length === 1 ? handleOpenMetadataSearch : undefined}
                onSearchAlbumMetadata={menuIsSingleAlbum ? handleOpenAlbumMetadataSearch : undefined}
                onIdentifyWithAcoustId={menuSelection.length > 0 ? handleOpenAcoustId : undefined}
                onRemoveFromPlaylist={
                  viewConfig.type === "playlist" && viewConfig.playlist
                    ? handleRemoveMenuTracksFromPlaylist
                    : undefined
                }
                onShowBpmKey={handleShowBpmKey}
                onEdit={handleEdit}
                onDelete={handleDeleteTracks}
              />
              <PlaylistContextMenu
                isOpen={isPlaylistMenuOpen}
                position={playlistMenuPosition}
                playlistName={playlistMenuSelection.length > 1
                  ? `${playlistMenuSelection.length} playlists selected`
                  : playlistMenuTarget?.name}
                selectionCount={playlistMenuSelection.length}
                onClose={closePlaylistMenu}
                onEdit={playlistMenuSelection.length === 1 ? handlePlaylistMenuEdit : undefined}
                onExport={playlistMenuSelection.length === 1
                  ? () => { void handlePlaylistMenuExport(); }
                  : undefined}
                folders={playlistMenuSelection.length > 0 ? playlistFolderOptions : []}
                currentFolderId={playlistMenuCommonFolderId}
                showRootMoveOption={playlistMenuSelection.some((playlist) => playlist.folderId)}
                onMoveToFolder={playlistMenuSelection.length > 0 ? handleMovePlaylist : undefined}
                onDelete={handlePlaylistMenuDelete}
              />
              <PlaylistContextMenu
                isOpen={Boolean(folderMenu)}
                position={folderMenu?.position ?? { x: 0, y: 0 }}
                playlistName={folderMenuTarget?.name}
                onClose={() => setFolderMenu(null)}
                onEdit={handleFolderMenuEdit}
                onDelete={() => { void handleFolderMenuDelete(); }}
              />
              <ColumnsMenu
                isOpen={showColumns}
                position={columnsMenuPosition}
                columns={columns}
                onClose={closeColumnsMenu}
                onToggleColumn={toggleColumn}
              />
              <div className="flex min-h-0 flex-1 flex-col">
                <LibraryHeader
                  title={viewConfig.title}
                  subtitle={viewConfig.subtitle}
                  isSettings={viewConfig.type === "settings"}
                  resultCount={isArtistIndex ? artistIndexResults.length : collectionIndexFacet ? collectionIndexResults.length : isAlbumsView ? albumResults.length : sortedTracks.length}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  advancedFilters={advancedTrackFilters}
                  filterFormats={filterFormats}
                  onAdvancedFiltersChange={setAdvancedTrackFilters}
                  onAdvancedFiltersReset={resetAdvancedTrackFilters}
                  onShowColumns={openColumnsMenu}
                  contentMode={isArtistIndex || collectionIndexFacet ? "collections" : isAlbumsView ? "albums" : "tracks"}
                  resultLabel={isArtistIndex ? "artists" : collectionIndexFacet ?? undefined}
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
                  ) : isArtistIndex ? (
                    <ArtistIndexView
                      items={artistIndexResults}
                      profiles={artistProfiles}
                      onSelect={(artistName) => handleOpenCollectionValue("artists", artistName)}
                    />
                  ) : collectionIndexFacet ? (
                    <CollectionIndexView
                      facet={collectionIndexFacet}
                      items={collectionIndexResults}
                      onSelect={(value) => handleOpenCollectionValue(collectionIndexFacet, value)}
                    />
                  ) : isAlbumsView ? (
                    <AlbumsView
                      albums={albums}
                      searchQuery={searchQuery}
                      selectedAlbumId={selectedAlbumId}
                      currentTrackId={currentTrack?.id ?? null}
                      isPlaying={isPlaying}
                      onSelectAlbum={handleSelectAlbum}
                      onPlayTrack={handlePlayAlbumTrack}
                      onPlayAlbum={handlePlayAlbum}
                      onTogglePlay={togglePlay}
                      onPlayNext={playNext}
                      onAddToQueue={addToQueue}
                      onOpenArtist={(artist) => handleOpenCollectionValue("artists", artist)}
                      onOpenGenre={(genre) => handleOpenCollectionValue("genres", genre)}
                      onTracksContextMenu={handleAlbumTracksContextMenu}
                      onImportFiles={handleEmptyImport}
                      onImportFolder={handleEmptyImportFolder}
                      revealRequest={revealTrackRequest}
                    />
                  ) : (
                    viewConfig.trackTable && (
                      <>
                        {isArtistDetail && selectedArtistName && (
                          <ArtistDetailPanel
                            artistName={selectedArtistName}
                            profile={selectedArtistProfile}
                            isLoading={selectedArtistProfileLoading}
                            error={selectedArtistProfileError}
                            trackCount={displayedTracks.length}
                            albumCount={selectedArtistAlbumCount}
                            onRefresh={() => { void loadArtistProfile(selectedArtistName, true); }}
                            onChangePicture={() => setArtistImageArtistName(selectedArtistName)}
                            onOpenSource={handleOpenArtistSource}
                          />
                        )}
                        <TrackTable
                          tracks={sortedTracks}
                          columns={columns}
                          emptyTitle={
                            hasTrackSearchFilters && sortedTracks.length === 0
                              ? t("search.noResults")
                              : viewConfig.trackTable.emptyState.title
                          }
                          emptyDescription={
                            hasTrackSearchFilters && sortedTracks.length === 0
                              ? ""
                              : viewConfig.trackTable.emptyState.description
                          }
                          emptyActionLabel={
                            hasTrackSearchFilters && sortedTracks.length === 0
                              ? undefined
                              : viewConfig.trackTable.emptyState.primaryAction
                                  ?.label
                          }
                          onEmptyAction={
                            hasTrackSearchFilters && sortedTracks.length === 0
                              ? undefined
                              : viewConfig.trackTable.showImportActions
                                ? handleEmptyImport
                                : undefined
                          }
                          emptySecondaryActionLabel={
                            hasTrackSearchFilters && sortedTracks.length === 0
                              ? undefined
                              : viewConfig.trackTable.emptyState.secondaryAction
                                  ?.label
                          }
                          onEmptySecondaryAction={
                            hasTrackSearchFilters && sortedTracks.length === 0
                              ? undefined
                              : viewConfig.trackTable.showImportActions
                                ? handleEmptyImportFolder
                                : undefined
                          }
                          onRowSelect={handleRowSelect}
                          onRowMouseDown={onRowMouseDown}
                          onRowContextMenu={handleRowContextMenu}
                          onRowDoubleClick={handlePlayTrack}
                          onTogglePlay={togglePlay}
                          onOpenArtist={handleOpenTableArtist}
                          onOpenAlbum={handleOpenTableAlbum}
                          onAlbumContextMenu={handleTableAlbumContextMenu}
                          onColumnResize={handleColumnResize}
                          onColumnAutoFit={autoFitColumn}
                          onColumnReorder={reorderColumns}
                          onHeaderContextMenu={openColumnsMenu}
                          onSortChange={handleSortChange}
                          onRatingChange={handleRatingChange}
                          revealRequest={revealTrackRequest}
                        />
                        <TrackSelectionBar
                          selectedCount={selectedVisibleTrackIds.length}
                          onPlay={handlePlaySelected}
                          onMix={djMixEnabled
                            ? () => { void mixSelectedPair(selectedVisibleTrackIds); }
                            : undefined}
                          onPlayNext={() => playNext(selectedVisibleTrackIds)}
                          onAddToQueue={() => addToQueue(selectedVisibleTrackIds)}
                          onAnalyze={handleAnalyzeSelected}
                          onEdit={handleEditSelected}
                          onDelete={handleDeleteSelected}
                          onClear={clearSelection}
                          onRemoveFromPlaylist={
                            viewConfig.type === "playlist" && viewConfig.playlist
                              ? handleRemoveSelectedFromPlaylist
                              : undefined
                          }
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
              expanded={queuePanelExpanded}
              onToggleCollapsed={toggleQueuePanelCollapsed}
              onToggleExpanded={toggleQueuePanelExpanded}
              queueTracks={queueTracks}
              allTracks={allTracks}
              currentTrack={currentTrack}
              currentTrackDetails={currentTrack ? allTracks.find((track) => track.id === currentTrack.id) : null}
              currentPlaylist={viewConfig.playlist}
              onRemoveFromQueue={removeFromQueue}
              onReorderQueue={reorderQueue}
              onClearQueue={clearQueue}
              onPlayTrack={(trackId) => playTrackById(trackId)}
              onPlayNext={(trackId) => playNext([trackId])}
              onMixWithCurrent={djMixEnabled
                ? (trackId) => { void mixCurrentWith(trackId); }
                : undefined}
            />
          }
        />
        <PlayerBar
          onTogglePlay={togglePlay}
          onOpenCurrentTrack={handleOpenCurrentTrack}
          onSeekChange={seek}
          onVolumeChange={setVolume}
          onSkipPrevious={handleSkipPrevious}
          onSkipNext={handleSkipNext}
          transition={djMixEnabled ? transition : null}
        />
      </div>
    </div>
  );
}

export default App;
