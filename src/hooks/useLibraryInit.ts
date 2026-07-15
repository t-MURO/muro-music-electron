import { useCallback, useEffect, useState } from "react";
import { appDataDir, join } from "@muro/desktop/paths";
import { useLibraryStore, useSettingsStore, useRecentlyPlayedStore, notify } from "../stores";
import {
  backfillCoverArt,
  backfillSearchText,
  clearTracks,
  loadPlaylists,
  loadRecentlyPlayed,
  loadTracks,
  importedTrackToTrack,
} from "../utils";
import { useDbPath } from "./useDbPath";
import { confirm } from "@muro/desktop/dialogs";
import { t } from "../i18n";

export const useLibraryInit = () => {
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const setPlaylists = useLibraryStore((s) => s.setPlaylists);
  const setPlaylistFolders = useLibraryStore((s) => s.setPlaylistFolders);
  const setRecentlyPlayedTracks = useRecentlyPlayedStore((s) => s.setRecentlyPlayedTracks);

  const dbPath = useSettingsStore((s) => s.dbPath);
  const dbFileName = useSettingsStore((s) => s.dbFileName);
  const useAutoDbPath = useSettingsStore((s) => s.useAutoDbPath);

  const resolveDbPath = useDbPath();

  // Backfill state
  const [backfillPending, setBackfillPending] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const [coverArtBackfillPending, setCoverArtBackfillPending] = useState(false);
  const [coverArtBackfillStatus, setCoverArtBackfillStatus] = useState<string | null>(null);
  const [clearSongsPending, setClearSongsPending] = useState(false);

  // Auto-resolve DB path
  useEffect(() => {
    let isMounted = true;

    const resolveDefaultDbPath = async () => {
      if (!useAutoDbPath) {
        return;
      }

      try {
        const baseDir = await appDataDir();
        const defaultPath = await join(baseDir, dbFileName || "muro.db");
        if (isMounted) {
          useSettingsStore.setState({ dbPath: defaultPath });
        }
      } catch (error) {
        console.warn("Failed to resolve default db path", error);
      }
    };

    resolveDefaultDbPath();
    return () => {
      isMounted = false;
    };
  }, [dbFileName, useAutoDbPath]);

  // Load library on mount
  useEffect(() => {
    let isMounted = true;

    const loadLibrary = async () => {
      try {
        const resolvedPath = await resolveDbPath();
        const [snapshot, playlistSnapshot, recentlyPlayedSnapshot] = await Promise.all([
          loadTracks(resolvedPath),
          loadPlaylists(resolvedPath),
          loadRecentlyPlayed(resolvedPath, 50),
        ]);
        if (!isMounted) {
          return;
        }
        setTracks(snapshot.library.map(importedTrackToTrack));
        setInboxTracks(snapshot.inbox.map(importedTrackToTrack));
        setPlaylists(
          playlistSnapshot.playlists.map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            folderId: playlist.folder_id ?? undefined,
            trackIds: playlist.track_ids,
          }))
        );
        setPlaylistFolders(playlistSnapshot.folders);
        setRecentlyPlayedTracks(recentlyPlayedSnapshot.map(importedTrackToTrack));
      } catch (error) {
        notify.error("Failed to load library");
      }
    };

    loadLibrary();
    return () => {
      isMounted = false;
    };
  }, [resolveDbPath, setTracks, setInboxTracks, setPlaylists, setPlaylistFolders, setRecentlyPlayedTracks]);

  // Backfill handlers
  const handleBackfillSearchText = useCallback(async () => {
    if (!dbPath.trim()) {
      setBackfillStatus("Enter a database path to run the backfill.");
      return;
    }

    try {
      setBackfillPending(true);
      setBackfillStatus("Running backfill...");
      const updated = await backfillSearchText(dbPath.trim());
      setBackfillStatus(`Updated ${updated} tracks.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Backfill failed.";
      setBackfillStatus(message);
    } finally {
      setBackfillPending(false);
    }
  }, [dbPath]);

  const handleBackfillCoverArt = useCallback(async () => {
    if (!dbPath.trim()) {
      setCoverArtBackfillStatus("Enter a database path to run the backfill.");
      return;
    }

    try {
      setCoverArtBackfillPending(true);
      setCoverArtBackfillStatus("Extracting cover art...");
      const updated = await backfillCoverArt(dbPath.trim());
      setCoverArtBackfillStatus(`Extracted cover art for ${updated} tracks.`);
      // Reload tracks to get the new cover art paths
      const resolvedPath = await resolveDbPath();
      const snapshot = await loadTracks(resolvedPath);
      setTracks(snapshot.library.map(importedTrackToTrack));
      setInboxTracks(snapshot.inbox.map(importedTrackToTrack));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Cover art extraction failed.";
      setCoverArtBackfillStatus(message);
    } finally {
      setCoverArtBackfillPending(false);
    }
  }, [dbPath, resolveDbPath, setTracks, setInboxTracks]);

  // Clear songs handler
  const handleClearSongs = useCallback(async () => {
    if (clearSongsPending) {
      return;
    }

    const shouldClear = await confirm(
      t("settings.dev.clearSongs.confirm.body"),
      {
        title: t("settings.dev.clearSongs.confirm.title"),
        kind: "warning",
      }
    );
    if (!shouldClear) {
      return;
    }

    setClearSongsPending(true);
    try {
      const resolvedPath = await resolveDbPath();
      await clearTracks(resolvedPath);
      setTracks([]);
      setInboxTracks([]);
    } catch (error) {
      notify.error("Failed to clear songs");
    } finally {
      setClearSongsPending(false);
    }
  }, [clearSongsPending, resolveDbPath, setTracks, setInboxTracks]);

  return {
    // Backfill state
    backfillPending,
    backfillStatus,
    coverArtBackfillPending,
    coverArtBackfillStatus,
    clearSongsPending,
    // Handlers
    handleBackfillSearchText,
    handleBackfillCoverArt,
    handleClearSongs,
  };
};
