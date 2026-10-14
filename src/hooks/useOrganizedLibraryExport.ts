import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "../desktop/events";
import { notify, startTask, useLibraryStore, useSettingsStore, type TaskHandle } from "../stores";
import {
  exportOrganizedLibrary,
  importedTrackToTrack,
  loadTracks,
  type OrganizedLibraryExportResult,
} from "../utils";
import { t } from "../i18n";
import { taskDetailsAction, taskItemName } from "../utils/tasks";

type OrganizedLibraryExportProgress = {
  phase: "music" | "playlists";
  current: number;
  total: number;
  name?: string;
};

export const useOrganizedLibraryExport = () => {
  const setTracks = useLibraryStore((state) => state.setTracks);
  const setInboxTracks = useLibraryStore((state) => state.setInboxTracks);
  const setLibraryRoot = useSettingsStore((state) => state.setWatchedFolder);
  const artistSeparatorExceptions = useSettingsStore((state) => state.artistSeparatorExceptions);
  const pendingRef = useRef(false);
  const taskRef = useRef<TaskHandle | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void listen<OrganizedLibraryExportProgress>("muro://library-export-progress", ({ payload }) => {
      if (!active || !pendingRef.current || !payload) return;
      taskRef.current?.progress(
        payload.current,
        payload.total > 0 ? payload.total : null,
        t(payload.phase === "music" ? "tasks.export.music" : "tasks.export.playlists"),
      );
      const subject = payload.phase === "music" ? "music files" : "playlists";
      setStatus(
        payload.total > 0
          ? `Exporting ${subject}: ${payload.current.toLocaleString()} of ${payload.total.toLocaleString()}`
          : `Preparing ${subject}…`,
      );
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const exportLibrary = useCallback(
    async (
      destinationPath: string,
      useAsCurrentLibrary: boolean,
    ): Promise<OrganizedLibraryExportResult | null> => {
      pendingRef.current = true;
      setPending(true);
      setStatus("Preparing organized library export…");
      // Copying runs in the main process without a way to stop it, so no Cancel.
      const task = startTask({ kind: "export", title: t("tasks.export.title") });
      taskRef.current = task;
      try {
        const result = await exportOrganizedLibrary(destinationPath, useAsCurrentLibrary);
        for (const failure of result.failures) {
          task.addError(taskItemName(failure.sourcePath), failure.message);
        }
        if (result.librarySwitchRequested && !result.librarySwitched) {
          task.addError(
            result.exportRoot,
            result.librarySwitchError ?? t("toast.export.doneNotSwitched"),
          );
        }
        task.finish(
          t("tasks.export.summary", {
            files: result.filesCopied.toLocaleString(),
            playlists: result.playlistsExported.toLocaleString(),
          }),
        );
        let rendererReloadError: string | null = null;
        if (result.librarySwitched) {
          try {
            setLibraryRoot(result.exportRoot);
            const snapshot = await loadTracks(result.exportRoot, artistSeparatorExceptions);
            setTracks(snapshot.library.map(importedTrackToTrack));
            setInboxTracks(snapshot.inbox.map(importedTrackToTrack));
          } catch (error) {
            rendererReloadError = error instanceof Error ? error.message : String(error);
          }
        }
        const failureSuffix =
          result.tracksFailed > 0
            ? ` ${result.tracksFailed.toLocaleString()} unavailable files were skipped.`
            : "";
        const switchSuffix = result.librarySwitched
          ? rendererReloadError
            ? " The exported files are now the current library; restart Muro to refresh the view."
            : " Muro is now using the exported files as the current library."
          : result.librarySwitchRequested
            ? ` The current library was not switched${
                result.librarySwitchError ? `: ${result.librarySwitchError}` : "."
              }`
            : " The current library still uses the original files.";
        setStatus(
          `Copied ${result.filesCopied.toLocaleString()} music files and exported ` +
            `${result.playlistsExported.toLocaleString()} playlists.${failureSuffix} ` +
            `Saved to ${result.exportRoot}.${switchSuffix}`,
        );
        if (result.librarySwitchRequested && !result.librarySwitched) {
          notify.info(t("toast.export.doneNotSwitched"));
        } else if (rendererReloadError) {
          notify.info(t("toast.export.restartNeeded"));
        } else if (result.tracksFailed > 0) {
          notify.info(
            t("toast.export.completedWithSkips", { count: String(result.tracksFailed) }),
            { action: taskDetailsAction() },
          );
        } else if (result.librarySwitched) {
          notify.success(t("toast.export.doneSwitched"));
        } else {
          notify.success(t("toast.export.organizedDone"));
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to export the library";
        task.fail(message);
        setStatus(message);
        notify.error(message);
        return null;
      } finally {
        pendingRef.current = false;
        taskRef.current = null;
        setPending(false);
      }
    },
    [artistSeparatorExceptions, setInboxTracks, setLibraryRoot, setTracks],
  );

  return {
    organizedLibraryExportPending: pending,
    organizedLibraryExportStatus: status,
    exportOrganizedLibrary: exportLibrary,
  };
};
