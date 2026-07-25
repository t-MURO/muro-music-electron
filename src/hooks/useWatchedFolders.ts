import { useCallback, useEffect, useState } from "react";
import { invoke } from "@muro/desktop/runtime";
import { listen } from "@muro/desktop/events";
import { open } from "@muro/desktop/dialogs";
import { notify, useLibraryStore, useSettingsStore } from "../stores";
import { importedTrackToTrack, type ImportedTrack } from "../utils";
import { t } from "../i18n";
import { useDbPath } from "./useDbPath";

type WatchedImportPayload = {
  track: ImportedTrack;
  sourcePath: string;
};

/**
 * Keeps the main process watching the configured folders and folds anything it
 * imports into the Inbox list without a full library reload.
 */
export const useWatchedFolders = () => {
  const [scanning, setScanning] = useState(false);
  const watchFoldersEnabled = useSettingsStore((s) => s.watchFoldersEnabled);
  const watchedFolders = useSettingsStore((s) => s.watchedFolders);
  const setWatchFoldersEnabled = useSettingsStore((s) => s.setWatchFoldersEnabled);
  const addWatchedFolder = useSettingsStore((s) => s.addWatchedFolder);
  const removeWatchedFolder = useSettingsStore((s) => s.removeWatchedFolder);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const resolveDbPath = useDbPath();

  // Push the watch set to the main process whenever it changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const dbPath = await resolveDbPath();
        if (cancelled) return;
        await invoke("set_watched_folders", {
          dbPath,
          folders: watchedFolders,
          isEnabled: watchFoldersEnabled,
        });
      } catch {
        // Watching is best-effort; manual import still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveDbPath, watchFoldersEnabled, watchedFolders]);

  // Newly watched-in tracks arrive one at a time.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void listen<WatchedImportPayload>("muro://watched-folder-import", (event) => {
      const imported = event.payload?.track;
      if (!imported) return;
      const track = importedTrackToTrack(imported);
      setInboxTracks((current) =>
        current.some((entry) => entry.id === track.id) ? current : [track, ...current]
      );
    }).then((remove) => {
      if (cancelled) remove();
      else unlisten = remove;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setInboxTracks]);

  const addFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    addWatchedFolder(selected);
    if (!watchFoldersEnabled) setWatchFoldersEnabled(true);
  }, [addWatchedFolder, setWatchFoldersEnabled, watchFoldersEnabled]);

  /**
   * fs.watch only reports changes made while it is running, so a manual sweep
   * covers anything that appeared while the app was closed.
   */
  const scanNow = useCallback(async () => {
    if (scanning || watchedFolders.length === 0) return;
    setScanning(true);
    try {
      const dbPath = await resolveDbPath();
      const result = await invoke<{ imported: number; scanned: number }>(
        "scan_watched_folders",
        { dbPath, folders: watchedFolders }
      );
      if (result.imported > 0) {
        notify.success(t("watch.scan.imported", { count: String(result.imported) }));
      } else {
        notify.info(t("watch.scan.nothingNew"));
      }
    } catch {
      notify.error(t("watch.scan.failed"));
    } finally {
      setScanning(false);
    }
  }, [resolveDbPath, scanning, watchedFolders]);

  return {
    scanning,
    watchFoldersEnabled,
    watchedFolders,
    setWatchFoldersEnabled,
    addFolder,
    removeFolder: removeWatchedFolder,
    scanNow,
  };
};
