import { listen } from "@muro/desktop/events";
import { useCallback, useEffect, useRef } from "react";
import { commandManager, type Command } from "../command-manager/commandManager";
import {
  useLibraryStore,
  useSettingsStore,
  useUIStore,
  notify,
  startTask,
  type TaskHandle,
} from "../stores";
import {
  cancelImport,
  createPlaylist,
  deletePlaylist,
  deleteTracks,
  importFiles,
  importedTrackToTrack,
  listPlaylistFiles,
  setPlaylistTracks,
} from "../utils";
import type { Playlist } from "../types";
import { t } from "../i18n";
import { taskDetailsAction, taskErrorMessage, taskItemName } from "../utils/tasks";

export type ImportProgress = {
  imported: number;
  total: number;
  phase: "scanning" | "importing";
  /** Set by imports started with an ID, so progress reaches the right task. */
  importId?: string | null;
};

let importSequence = 0;

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
  // Background tasks of running imports, by import ID, for progress events.
  const importTasksRef = useRef(new Map<string, TaskHandle>());
  const handleImportPathsRef = useRef<(paths: string[]) => Promise<void>>(() => Promise.resolve());

  // Get state and actions from stores
  const playlists = useLibraryStore((s) => s.playlists);
  const setPlaylists = useLibraryStore((s) => s.setPlaylists);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const pendingPlaylistDrop = useUIStore((s) => s.pendingPlaylistDrop);
  const setPendingPlaylistDrop = useUIStore((s) => s.setPendingPlaylistDrop);
  const setImportProgress = useUIStore((s) => s.setImportProgress);
  const watchedFolder = useSettingsStore((s) => s.watchedFolder);

  // Ref to access current pending drop
  const pendingPlaylistDropRef = useRef<PlaylistDropOperation | null>(null);
  pendingPlaylistDropRef.current = pendingPlaylistDrop;

  const executePlaylistDrop = useCallback(
    async (playlistId: string, payload: string[]) => {
      // Capture the current state before executing
      const playlist = playlists.find((p: Playlist) => p.id === playlistId);
      if (!playlist) {
        return;
      }
      if (playlist.sourcePath) {
        notify.info(t("toast.playlist.sourceManaged", { name: playlist.name }));
        return;
      }
      const previousIds = [...playlist.trackIds];
      const previousSet = new Set(previousIds);
      const novelIds = [...new Set(payload)].filter((trackId) => !previousSet.has(trackId));
      if (novelIds.length === 0) {
        notify.info(t("history.playlist.noneAdded", { name: playlist.name }));
        return;
      }
      const nextIds = [...previousIds, ...novelIds];

      const command: Command = {
        label: `Add ${novelIds.length} tracks to playlist`,
        do: async () => {
          await setPlaylistTracks(playlistId, nextIds);
          setPlaylists((current) =>
            current.map((p) => (p.id === playlistId ? { ...p, trackIds: nextIds } : p)),
          );
          return t(
            novelIds.length === 1 ? "history.playlist.added.one" : "history.playlist.added.many",
            { count: String(novelIds.length), name: playlist.name },
          );
        },
        undo: async () => {
          await setPlaylistTracks(playlistId, previousIds);
          setPlaylists((current) =>
            current.map((p) => (p.id === playlistId ? { ...p, trackIds: previousIds } : p)),
          );
          return t(
            previousIds.length === 1
              ? "history.playlist.restoredCount.one"
              : "history.playlist.restoredCount.many",
            { count: String(previousIds.length), name: playlist.name },
          );
        },
      };

      try {
        await commandManager.execute(command);
      } catch {
        notify.error(t("toast.playlist.addFailed"));
      }
    },
    [setPlaylists, playlists],
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

      void executePlaylistDrop(playlistId, payload);
    },
    [playlists, executePlaylistDrop, setPendingPlaylistDrop],
  );

  const confirmPlaylistDropOperation = useCallback(() => {
    const pending = pendingPlaylistDropRef.current;
    if (!pending) {
      return;
    }
    void executePlaylistDrop(pending.playlistId, pending.trackIds);
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

      let importId: string | null = null;
      let task: TaskHandle | null = null;
      try {
        if (clearProgressTimerRef.current !== null && typeof window !== "undefined") {
          window.clearTimeout(clearProgressTimerRef.current);
          clearProgressTimerRef.current = null;
        }
        setImportProgress({ imported: 0, total: 0, phase: "scanning" });
        if (paths.length === 1 && onPlaylistFolderDetected) {
          try {
            const playlistScan = await listPlaylistFiles(paths[0]);
            // A normal music folder can also contain exported playlists. In that
            // case import its songs; reserve automatic playlist-folder routing
            // for bundles that contain playlists but no audio of their own.
            if (playlistScan.files.length > 0 && playlistScan.audioFileCount === 0) {
              setImportProgress(null);
              await onPlaylistFolderDetected(paths[0]);
              return;
            }
          } catch {
            // A regular audio file or folder continues through the normal importer.
          }
        }

        importId = `import-${Date.now()}-${++importSequence}`;
        const taskImportId = importId;
        task = startTask({
          kind: "import",
          title: t("tasks.import.title"),
          detail: t("tasks.import.scanning"),
          cancel: () => void cancelImport(taskImportId).catch(() => undefined),
        });
        importTasksRef.current.set(importId, task);
        const result = await importFiles(paths, {
          libraryFolder: watchedFolder,
          importId,
        });
        importTasksRef.current.delete(importId);
        for (const failure of result.failures) {
          task.addError(taskItemName(failure.path), failure.message);
        }
        const failedPaths = result.failures.map((failure) => failure.path);
        if (failedPaths.length > 0) {
          task.update({ retry: () => void handleImportPathsRef.current(failedPaths) });
        }
        const imported = result.imported;
        const summary = t("tasks.import.summary", {
          imported: String(imported.length),
          scanned: String(result.scanned),
        });
        if (result.cancelled) {
          task.cancelled(summary);
        } else if (result.scanned === 0 && failedPaths.length === 0) {
          task.fail(t("toast.import.noSupportedFiles"));
        } else {
          task.finish(summary);
        }
        if (imported.length === 0) {
          if (result.cancelled) {
            notify.info(t("toast.import.cancelled"));
          } else if (result.scanned === 0) {
            notify.error(t("toast.import.noSupportedFiles"));
          } else if (result.failures.length > 0) {
            notify.error(
              result.failures.length === 1
                ? `Could not import ${result.failures[0].path.split(/[\\/]/).slice(-1)[0] || "audio file"}`
                : `${result.failures.length} audio files could not be imported`,
              { action: taskDetailsAction() },
            );
          } else {
            notify.success(t("toast.import.allKnown"));
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

        let currentImported = imported;
        let convertedTracks = currentImported.map(importedTrackToTrack);
        const importedSourcePaths = imported.map((track) => track.source_path);
        const command: Command = {
          label: `Import ${imported.length} tracks`,
          do: async () => {
            const redoResult = await importFiles(importedSourcePaths, {
              libraryFolder: watchedFolder,
            });
            if (
              redoResult.failures.length > 0 ||
              redoResult.imported.length !== importedSourcePaths.length
            ) {
              throw new Error(t("history.import.restoreFailed"));
            }
            currentImported = redoResult.imported;
            convertedTracks = currentImported.map(importedTrackToTrack);
            setInboxTracks((current) => [...convertedTracks, ...current]);
            return t(
              currentImported.length === 1
                ? "history.import.redone.one"
                : "history.import.redone.many",
              { count: String(currentImported.length) },
            );
          },
          undo: async () => {
            const ids = currentImported.map((track) => track.id);
            const result = await deleteTracks(ids, false);
            if (result.failures.length > 0 || result.deletedTrackIds.length !== ids.length) {
              throw new Error(t("history.import.removeFailed"));
            }
            const deletedIds = new Set(result.deletedTrackIds);
            setInboxTracks((current) => current.filter((track) => !deletedIds.has(track.id)));
            return t(
              deletedIds.size === 1 ? "history.import.undone.one" : "history.import.undone.many",
              { count: String(deletedIds.size) },
            );
          },
        };
        setInboxTracks((current) => [...convertedTracks, ...current]);
        await commandManager.recordExecuted(command);
        if (result.failures.length > 0) {
          notify.error(t("toast.import.someFailed", { count: String(result.failures.length) }), {
            action: taskDetailsAction(),
          });
        } else {
          notify.success(t("toast.import.succeeded", { count: String(imported.length) }));
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
        if (importId) importTasksRef.current.delete(importId);
        if (task && !task.finished) {
          task.update({ retry: () => void handleImportPathsRef.current(paths) });
          task.fail(taskErrorMessage(error));
        }
        notify.error(t("toast.import.failed"), task ? { action: taskDetailsAction() } : undefined);
        setImportProgress(null);
      }
    },
    [setImportProgress, setInboxTracks, onImportComplete, onPlaylistFolderDetected, watchedFolder],
  );
  useEffect(() => {
    handleImportPathsRef.current = handleImportPaths;
  }, [handleImportPaths]);

  const handleCreatePlaylist = useCallback(
    async (name: string, initialTrackIds: string[] = []): Promise<string | null> => {
      const trimmed = name.trim();
      if (!trimmed) {
        return null;
      }

      playlistSequenceRef.current += 1;
      const playlist: Playlist = {
        id: `playlist-${Date.now()}-${playlistSequenceRef.current}`,
        name: trimmed,
        trackIds: [...new Set(initialTrackIds)],
        sortOrder:
          playlists
            .filter((item) => !item.folderId)
            .reduce((highest, item) => Math.max(highest, item.sortOrder), -1) + 1,
      };

      const command: Command = {
        label: `Create playlist ${trimmed}`,
        do: async () => {
          await createPlaylist(playlist.id, playlist.name, playlist.folderId, playlist.sortOrder);
          try {
            if (playlist.trackIds.length > 0) {
              await setPlaylistTracks(playlist.id, playlist.trackIds);
            }
          } catch (error) {
            await deletePlaylist(playlist.id).catch(() => undefined);
            throw error;
          }
          setPlaylists((current) => [...current, playlist]);
          return t("history.playlist.created", { name: playlist.name });
        },
        undo: async () => {
          await deletePlaylist(playlist.id);
          setPlaylists((current) => current.filter((item) => item.id !== playlist.id));
          return t("history.playlist.undidCreate", { name: playlist.name });
        },
      };

      try {
        await commandManager.execute(command);
        return playlist.id;
      } catch (error) {
        notify.error(t("toast.playlist.createFailed"));
        return null;
      }
    },
    [playlists, setPlaylists],
  );

  // Undo/redo is bound globally in useKeyboardShortcuts, which also guards
  // text fields so Cmd+Z keeps working inside inputs.

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
            if (payload.importId) {
              importTasksRef.current
                .get(payload.importId)
                ?.progress(payload.imported, payload.total, null);
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
          },
        );
      } catch (error) {
        notify.error(t("toast.import.listenerFailed"));
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
