import { listen } from "@muro/desktop/events";
import { useCallback, useEffect, useRef } from "react";
import { useLibraryStore, notify, startTask } from "../stores";
import {
  addTracksToPlaylist,
  configurePlaylistSync,
  createPlaylist,
  createPlaylistFolder,
  deletePlaylist,
  deletePlaylistFolder,
  exportAllPlaylists as exportAllPlaylistFiles,
  exportPlaylistFile,
  importFiles,
  importedTrackToTrack,
  importPlaylistFile,
  listPlaylistFiles,
  syncPlaylistSource,
  type PlaylistSourceSyncResult,
} from "../utils";
import { t } from "../i18n";
import type { Playlist } from "../types";
import { taskDetailsAction, taskErrorMessage, taskItemName } from "../utils/tasks";

const normalizePath = (value: string) => value.replace(/\//g, "\\").toLocaleLowerCase();

export const usePlaylistTransfer = () => {
  const sequenceRef = useRef(0);
  // Task-center retries call the latest version of these.
  const importPlaylistRef = useRef<(filePath: string) => Promise<string | null>>(() =>
    Promise.resolve(null),
  );
  const exportAllPlaylistsRef = useRef<(destinationPath: string) => Promise<unknown>>(() =>
    Promise.resolve(null),
  );
  const setInboxTracks = useLibraryStore((state) => state.setInboxTracks);
  const setPlaylists = useLibraryStore((state) => state.setPlaylists);
  const setPlaylistFolders = useLibraryStore((state) => state.setPlaylistFolders);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      unlisten = await listen<PlaylistSourceSyncResult>(
        "muro://playlist-source-synced",
        (event) => {
          const result = event.payload;
          if (!result) return;

          const converted = result.imported.map(importedTrackToTrack);
          if (converted.length > 0) {
            setInboxTracks((current) => {
              const existing = new Set(current.map((track) => track.id));
              return [...converted.filter((track) => !existing.has(track.id)), ...current];
            });
          }
          setPlaylists((current) =>
            current.map((playlist) =>
              playlist.id === result.playlistId
                ? {
                    ...playlist,
                    trackIds: result.trackIds,
                    sourcePath: result.sourcePath,
                    sourceSyncError: result.sourceSyncError ?? undefined,
                    lastSyncedAt: Math.floor(Date.now() / 1000),
                  }
                : playlist,
            ),
          );

          if (result.sourceSyncError) {
            notify.error(
              result.skipped > 0
                ? t("toast.playlist.syncPartial", {
                    name: result.name,
                    count: String(result.skipped),
                  })
                : t("toast.playlist.syncFailed", { name: result.name }),
            );
          } else if (result.changed) {
            notify.success(
              t("toast.playlist.synced", {
                name: result.name,
                added: String(result.added),
                removed: String(result.removed),
              }),
            );
          }
        },
      );
      if (cancelled) {
        unlisten();
        unlisten = null;
        return;
      }
      if (!cancelled) await configurePlaylistSync();
    })().catch((error) => {
      console.warn("Failed to start imported playlist synchronization", error);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setInboxTracks, setPlaylists]);

  const importPlaylistIntoStore = useCallback(
    async (filePath: string, folderId?: string) => {
      const parsed = await importPlaylistFile(filePath);
      const libraryTrackIdByPath = new Map(
        useLibraryStore
          .getState()
          .tracks.map((track) => [normalizePath(track.sourcePath), track.id]),
      );
      const missingPaths = [
        ...new Set(
          parsed.entries
            .filter(
              (entry) =>
                !entry.track_id &&
                !libraryTrackIdByPath.has(normalizePath(entry.path)) &&
                entry.exists,
            )
            .map((entry) => entry.path),
        ),
      ];
      const importResult =
        missingPaths.length > 0
          ? await importFiles(missingPaths)
          : { imported: [], scanned: 0, failures: [] };
      const imported = importResult.imported;
      const converted = imported.map(importedTrackToTrack);
      if (converted.length > 0) {
        setInboxTracks((current) => {
          const existing = new Set(current.map((track) => track.id));
          return [...converted.filter((track) => !existing.has(track.id)), ...current];
        });
      }

      const importedIdByPath = new Map(
        imported.map((track) => [normalizePath(track.source_path), track.id]),
      );
      const orderedTrackIds = parsed.entries
        .map((entry) => {
          const normalizedPath = normalizePath(entry.path);
          return (
            entry.track_id ??
            libraryTrackIdByPath.get(normalizedPath) ??
            importedIdByPath.get(normalizedPath) ??
            null
          );
        })
        .filter((trackId): trackId is string => Boolean(trackId));
      const trackIds = [...new Set(orderedTrackIds)];

      sequenceRef.current += 1;
      const sortOrder =
        useLibraryStore
          .getState()
          .playlists.filter((item) => item.folderId === folderId)
          .reduce((highest, item) => Math.max(highest, item.sortOrder), -1) + 1;
      const playlist: Playlist = {
        id: `playlist-import-${Date.now()}-${sequenceRef.current}`,
        name: parsed.name || "Imported Playlist",
        trackIds,
        folderId,
        sortOrder,
        sourcePath: parsed.source_path,
      };
      await createPlaylist(playlist.id, playlist.name, folderId, sortOrder, parsed.source_path);
      try {
        if (playlist.trackIds.length > 0) {
          await addTracksToPlaylist(playlist.id, playlist.trackIds);
        }
      } catch (error) {
        await deletePlaylist(playlist.id).catch(() => undefined);
        throw error;
      }
      setPlaylists((current) => [...current, playlist]);
      const initialSync = await syncPlaylistSource(playlist.id).catch((error) => {
        console.warn(`Initial playlist sync failed for ${playlist.name}`, error);
        return null;
      });
      if (initialSync) {
        const initiallyImported = initialSync.imported.map(importedTrackToTrack);
        if (initiallyImported.length > 0) {
          setInboxTracks((current) => {
            const existing = new Set(current.map((track) => track.id));
            return [...initiallyImported.filter((track) => !existing.has(track.id)), ...current];
          });
        }
        setPlaylists((current) =>
          current.map((item) =>
            item.id === playlist.id
              ? {
                  ...item,
                  trackIds: initialSync.trackIds,
                  sourceSyncError: initialSync.sourceSyncError ?? undefined,
                  lastSyncedAt: Math.floor(Date.now() / 1000),
                }
              : item,
          ),
        );
        playlist.trackIds = initialSync.trackIds;
        playlist.sourceSyncError = initialSync.sourceSyncError ?? undefined;
        playlist.lastSyncedAt = Math.floor(Date.now() / 1000);
      }

      const skipped = initialSync?.skipped ?? parsed.entries.length - trackIds.length;
      return { playlist, skipped };
    },
    [setInboxTracks, setPlaylists],
  );

  const importPlaylist = useCallback(
    async (filePath: string): Promise<string | null> => {
      const task = startTask({
        kind: "playlist",
        title: t("tasks.playlistImport.title", { name: taskItemName(filePath) }),
      });
      try {
        const result = await importPlaylistIntoStore(filePath);
        if (!result) {
          task.fail(t("toast.playlist.noAvailableFiles"));
          notify.error(t("toast.playlist.noAvailableFiles"));
          return null;
        }
        const message =
          result.skipped > 0
            ? t("toast.playlist.importedLinkedPartial", {
                name: result.playlist.name,
                count: String(result.playlist.trackIds.length),
                skipped: String(result.skipped),
              })
            : t("toast.playlist.importedLinked", {
                name: result.playlist.name,
                count: String(result.playlist.trackIds.length),
              });
        task.succeed(message);
        notify.success(message);
        return result.playlist.id;
      } catch (error) {
        task.update({ retry: () => void importPlaylistRef.current(filePath) });
        task.fail(taskErrorMessage(error));
        notify.error(t("toast.playlist.importFailed"), { action: taskDetailsAction() });
        return null;
      }
    },
    [importPlaylistIntoStore],
  );
  useEffect(() => {
    importPlaylistRef.current = importPlaylist;
  }, [importPlaylist]);

  const importPlaylistFolder = useCallback(
    async (directoryPath: string) => {
      const createdFolderIds: string[] = [];
      const cleanupFolders = async () => {
        if (createdFolderIds.length === 0) return;
        for (const folderId of [...createdFolderIds].reverse()) {
          await deletePlaylistFolder(folderId).catch(() => undefined);
        }
        const created = new Set(createdFolderIds);
        setPlaylistFolders((current) => current.filter((folder) => !created.has(folder.id)));
      };
      const task = startTask({
        kind: "playlist",
        title: t("tasks.playlistFolderImport.title", { name: taskItemName(directoryPath) }),
        // Stops between playlist files; playlists imported so far are kept.
        cancel: true,
      });
      try {
        const scan = await listPlaylistFiles(directoryPath);
        if (scan.files.length === 0) {
          task.fail(t("toast.playlist.noPlaylistsInFolder"));
          notify.error(t("toast.playlist.noPlaylistsInFolder"));
          return null;
        }
        task.progress(0, scan.entries.length);

        sequenceRef.current += 1;
        const rootFolder = {
          id: `playlist-folder-import-${Date.now()}-${sequenceRef.current}`,
          name: scan.name || "Imported Playlists",
          sortOrder:
            useLibraryStore
              .getState()
              .playlistFolders.filter((folder) => !folder.parentId)
              .reduce((highest, folder) => Math.max(highest, folder.sortOrder), -1) + 1,
        };
        await createPlaylistFolder(rootFolder.id, rootFolder.name, undefined, rootFolder.sortOrder);
        createdFolderIds.push(rootFolder.id);

        const folderIdByPath = new Map<string, string>([["", rootFolder.id]]);
        const nextSortOrderByParent = new Map<string, number>();
        const importedFolders = [rootFolder];
        for (const scannedFolder of scan.folders) {
          const parentId = folderIdByPath.get(scannedFolder.parentPath ?? "") ?? rootFolder.id;
          const sortOrder = nextSortOrderByParent.get(parentId) ?? 0;
          nextSortOrderByParent.set(parentId, sortOrder + 1);
          sequenceRef.current += 1;
          const folder = {
            id: `playlist-folder-import-${Date.now()}-${sequenceRef.current}`,
            name: scannedFolder.name,
            parentId,
            sortOrder,
          };
          await createPlaylistFolder(folder.id, folder.name, parentId, sortOrder);
          createdFolderIds.push(folder.id);
          folderIdByPath.set(scannedFolder.path, folder.id);
          importedFolders.push(folder);
        }
        setPlaylistFolders((current) => [...current, ...importedFolders]);

        notify.info(
          t("toast.playlist.importing", {
            count: String(scan.files.length),
            folder: rootFolder.name,
          }),
        );
        const playlistIds: string[] = [];
        let processed = 0;
        for (const entry of scan.entries) {
          if (task.cancelRequested) break;
          task.setDetail(entry.relativePath);
          try {
            const folderId = folderIdByPath.get(entry.folderPath ?? "") ?? rootFolder.id;
            const result = await importPlaylistIntoStore(entry.path, folderId);
            if (result) playlistIds.push(result.playlist.id);
          } catch (error) {
            // Keep importing the remaining files and summarize partial failures.
            task.addError(entry.relativePath, taskErrorMessage(error));
          }
          processed += 1;
          task.progress(processed, scan.entries.length);
        }

        if (playlistIds.length === 0) {
          await cleanupFolders();
          if (task.cancelRequested) {
            task.cancelled();
            return null;
          }
          task.fail(t("toast.playlist.importedNone", { count: String(scan.files.length) }));
          notify.error(t("toast.playlist.importedNone", { count: String(scan.files.length) }), {
            action: taskDetailsAction(),
          });
          return null;
        }

        const message = t("toast.playlistFolder.importedLinked", {
          imported: String(playlistIds.length),
          count: String(scan.files.length),
          folder: rootFolder.name,
        });
        task.finish(message);
        notify.success(message);
        return { folderId: rootFolder.id, playlistIds };
      } catch (error) {
        await cleanupFolders();
        task.fail(taskErrorMessage(error));
        notify.error(t("toast.playlistFolder.importFailed"), { action: taskDetailsAction() });
        return null;
      }
    },
    [importPlaylistIntoStore, setPlaylistFolders],
  );

  const exportPlaylist = useCallback(async (playlistId: string, filePath: string) => {
    try {
      const result = await exportPlaylistFile(playlistId, filePath);
      notify.success(t("toast.playlist.exported", { count: String(result.exported) }));
      return true;
    } catch {
      notify.error(t("toast.playlist.exportFailed"));
      return false;
    }
  }, []);

  const exportAllPlaylists = useCallback(async (destinationPath: string) => {
    const task = startTask({ kind: "playlist", title: t("tasks.playlistExport.title") });
    try {
      const result = await exportAllPlaylistFiles(destinationPath);
      const message =
        `Exported ${result.playlistsExported} playlists with ` +
        `${result.playlistEntriesExported} track entries`;
      task.succeed(message);
      notify.success(message);
      return result;
    } catch (error) {
      // Writing the same files again is harmless, so the whole export can be retried.
      task.update({ retry: () => void exportAllPlaylistsRef.current(destinationPath) });
      task.fail(taskErrorMessage(error));
      notify.error(t("toast.playlist.exportAllFailed"), { action: taskDetailsAction() });
      return null;
    }
  }, []);
  useEffect(() => {
    exportAllPlaylistsRef.current = exportAllPlaylists;
  }, [exportAllPlaylists]);

  return { importPlaylist, importPlaylistFolder, exportPlaylist, exportAllPlaylists };
};
