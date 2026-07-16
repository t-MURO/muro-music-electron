import { listen } from "@muro/desktop/events";
import { useCallback, useEffect, useRef } from "react";
import { commandManager, type Command } from "../command-manager/commandManager";
import { useLibraryStore, useUIStore, notify } from "../stores";
import { useDbPath } from "./useDbPath";
import {
  addTracksToPlaylist,
  createPlaylist,
  removeLastTracksFromPlaylist,
  importFiles,
  importedTrackToTrack,
  listPlaylistFiles,
} from "../utils";
import type { Playlist } from "../types";

export type ImportProgress = {
  imported: number;
  total: number;
  phase: "scanning" | "importing";
};

export type PlaylistDropOperation = {
  playlistId: string;
  trackIds: string[];
  duplicateTrackIds: string[];
};

type UseFileImportArgs = {
  onImportComplete?: () => void;
  onPlaylistFolderDetected?: (directoryPath: string) => Promise<void>;
};

export const useFileImport = ({
  onImportComplete,
  onPlaylistFolderDetected,
}: UseFileImportArgs = {}) => {
  const playlistSequenceRef = useRef(0);
  const clearProgressTimerRef = useRef<number | null>(null);

  // Get state and actions from stores
  const playlists = useLibraryStore((s) => s.playlists);
  const setPlaylists = useLibraryStore((s) => s.setPlaylists);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const pendingPlaylistDrop = useUIStore((s) => s.pendingPlaylistDrop);
  const setPendingPlaylistDrop = useUIStore((s) => s.setPendingPlaylistDrop);
  const setImportProgress = useUIStore((s) => s.setImportProgress);

  // Ref to access current pending drop
  const pendingPlaylistDropRef = useRef<PlaylistDropOperation | null>(null);
  pendingPlaylistDropRef.current = pendingPlaylistDrop;

  const resolveDbPath = useDbPath();

  const executePlaylistDrop = useCallback(
    async (playlistId: string, payload: string[]) => {
      const resolvedDbPath = await resolveDbPath();
      const trackCount = payload.length;

      // Capture the current state before executing
      const playlist = playlists.find((p: Playlist) => p.id === playlistId);
      if (!playlist) {
        return;
      }
      const previousIds = [...playlist.trackIds];
      const nextIds = [...previousIds, ...payload];

      const command: Command = {
        label: `Add ${trackCount} tracks to playlist`,
        do: () => {
          setPlaylists((current) =>
            current.map((p) =>
              p.id === playlistId ? { ...p, trackIds: nextIds } : p
            )
          );
          // Persist to database
          addTracksToPlaylist(resolvedDbPath, playlistId, payload).catch(() => {
            notify.error("Failed to add tracks to playlist");
          });
        },
        undo: () => {
          setPlaylists((current) =>
            current.map((p) =>
              p.id === playlistId ? { ...p, trackIds: previousIds } : p
            )
          );
          removeLastTracksFromPlaylist(resolvedDbPath, playlistId, trackCount).catch(() => {
            notify.error("Failed to undo playlist changes");
          });
        },
      };

      commandManager.execute(command);
    },
    [setPlaylists, resolveDbPath, playlists]
  );

  const handlePlaylistDrop = useCallback(
    (playlistId: string, payload: string[] = []) => {
      if (payload.length === 0) {
        return;
      }

      const playlist = playlists.find((p: Playlist) => p.id === playlistId);
      if (!playlist) {
        return;
      }

      const existingIds = new Set(playlist.trackIds);
      const duplicateTrackIds = payload.filter((id) => existingIds.has(id));

      if (duplicateTrackIds.length > 0) {
        setPendingPlaylistDrop({
          playlistId,
          trackIds: payload,
          duplicateTrackIds,
        });
        return;
      }

      executePlaylistDrop(playlistId, payload);
    },
    [playlists, executePlaylistDrop, setPendingPlaylistDrop]
  );

  const confirmPlaylistDropOperation = useCallback(() => {
    const pending = pendingPlaylistDropRef.current;
    if (!pending) {
      return;
    }
    executePlaylistDrop(pending.playlistId, pending.trackIds);
    setPendingPlaylistDrop(null);
  }, [executePlaylistDrop, setPendingPlaylistDrop]);

  const cancelPlaylistDropOperation = useCallback(() => {
    setPendingPlaylistDrop(null);
  }, [setPendingPlaylistDrop]);

  const handleImportPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }

      try {
        if (clearProgressTimerRef.current !== null && typeof window !== "undefined") {
          window.clearTimeout(clearProgressTimerRef.current);
          clearProgressTimerRef.current = null;
        }
        setImportProgress({ imported: 0, total: 0, phase: "scanning" });
        const resolvedDbPath = await resolveDbPath();
        const result = await importFiles(resolvedDbPath, paths);
        const imported = result.imported;
        if (imported.length === 0) {
          if (result.scanned === 0) {
            if (paths.length === 1 && onPlaylistFolderDetected) {
              try {
                const playlistScan = await listPlaylistFiles(paths[0]);
                if (playlistScan.files.length > 0) {
                  setImportProgress(null);
                  await onPlaylistFolderDetected(paths[0]);
                  return;
                }
              } catch {
                // The path was not a readable playlist directory. Keep the
                // original audio-import error below.
              }
            }
            notify.error("No supported audio files were found");
          } else if (result.failures.length > 0) {
            notify.error(
              result.failures.length === 1
                ? `Could not import ${result.failures[0].path.split(/[\\/]/).slice(-1)[0] || "audio file"}`
                : `${result.failures.length} audio files could not be imported`
            );
          } else {
            notify.success("All selected songs are already in Muro");
          }
          if (typeof window !== "undefined") {
            clearProgressTimerRef.current = window.setTimeout(() => {
              setImportProgress(null);
              clearProgressTimerRef.current = null;
            }, 500);
          } else {
            setImportProgress(null);
          }
          return;
        }

        const convertedTracks = imported.map(importedTrackToTrack);
        const command: Command = {
          label: `Import ${imported.length} tracks`,
          do: () => {
            setInboxTracks((current) => [...convertedTracks, ...current]);
          },
          undo: () => {
            const ids = new Set(imported.map((track) => track.id));
            setInboxTracks((current) =>
              current.filter((track) => !ids.has(track.id))
            );
          },
        };
        commandManager.execute(command);
        if (result.failures.length > 0) {
          notify.error(`${result.failures.length} audio files could not be imported`);
        } else {
          notify.success(`Imported ${imported.length} ${imported.length === 1 ? "song" : "songs"}`);
        }
        onImportComplete?.();
        if (typeof window !== "undefined") {
          clearProgressTimerRef.current = window.setTimeout(() => {
            setImportProgress(null);
            clearProgressTimerRef.current = null;
          }, 800);
        } else {
          setImportProgress(null);
        }
      } catch (error) {
        notify.error("Import failed");
        setImportProgress(null);
      }
    },
    [
      resolveDbPath,
      setImportProgress,
      setInboxTracks,
      onImportComplete,
      onPlaylistFolderDetected,
    ]
  );

  const handleCreatePlaylist = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }

      playlistSequenceRef.current += 1;
      const playlist: Playlist = {
        id: `playlist-${Date.now()}-${playlistSequenceRef.current}`,
        name: trimmed,
        trackIds: [],
      };

      const command: Command = {
        label: `Create playlist ${trimmed}`,
        do: () => {
          setPlaylists((current) => [...current, playlist]);
        },
        undo: () => {
          setPlaylists((current) =>
            current.filter((item) => item.id !== playlist.id)
          );
        },
      };

      commandManager.execute(command);

      try {
        const resolvedDbPath = await resolveDbPath();
        await createPlaylist(resolvedDbPath, playlist.id, playlist.name);
      } catch (error) {
        notify.error("Failed to create playlist");
      }
    },
    [resolveDbPath, setPlaylists]
  );

  // Undo/Redo keyboard handler
  useEffect(() => {
    const handleUndoRedo = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") {
        return;
      }

      event.preventDefault();
      if (key === "y" || event.shiftKey) {
        commandManager.redo();
        return;
      }
      commandManager.undo();
    };

    window.addEventListener("keydown", handleUndoRedo);
    return () => window.removeEventListener("keydown", handleUndoRedo);
  }, []);

  // Import progress listener
  const importListenerSetupRef = useRef(false);
  const importUnlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (importListenerSetupRef.current) {
      return;
    }
    importListenerSetupRef.current = true;

    const setup = async () => {
      try {
        importUnlistenRef.current = await listen<ImportProgress>(
          "muro://import-progress",
          (event) => {
            const payload = event.payload;
            if (!payload) {
              return;
            }
            setImportProgress({
              imported: payload.imported,
              total: payload.total,
              phase: "importing",
            });
            if (payload.total > 0 && payload.imported >= payload.total) {
              if (clearProgressTimerRef.current !== null && typeof window !== "undefined") {
                window.clearTimeout(clearProgressTimerRef.current);
              }
              if (typeof window !== "undefined") {
                clearProgressTimerRef.current = window.setTimeout(() => {
                  setImportProgress(null);
                  clearProgressTimerRef.current = null;
                }, 800);
              } else {
                setImportProgress(null);
              }
            }
          }
        );
      } catch (error) {
        notify.error("Failed to setup import progress listener");
      }
    };

    void setup();

    return () => {
      importUnlistenRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setImportProgress is stable, only run once
  }, []);

  return {
    handleImportPaths,
    handlePlaylistDrop,
    handleCreatePlaylist,
    pendingPlaylistDrop,
    confirmPlaylistDropOperation,
    cancelPlaylistDropOperation,
  };
};
