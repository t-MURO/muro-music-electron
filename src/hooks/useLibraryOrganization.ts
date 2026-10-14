import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { notify, startTask, useLibraryStore, useSettingsStore } from "../stores";
import {
  loadTracks,
  repairLibraryStructure,
  validateLibraryStructure,
  type LibraryStructureRepairResult,
  type LibraryStructureValidationResult,
} from "../utils/database";
import { isSafetyBackupError } from "../utils/backups";
import { importedTrackToTrack } from "../utils/importApi";
import { taskDetailsAction, taskErrorMessage, taskItemName } from "../utils/tasks";

export type LibraryStructureRepairOutcome = {
  repair: LibraryStructureRepairResult;
  validation: LibraryStructureValidationResult;
};

export const useLibraryOrganization = () => {
  const libraryRoot = useSettingsStore((state) => state.watchedFolder);
  const artistSeparatorExceptions = useSettingsStore((state) => state.artistSeparatorExceptions);
  const setTracks = useLibraryStore((state) => state.setTracks);
  const setInboxTracks = useLibraryStore((state) => state.setInboxTracks);
  const busyRef = useRef(false);
  // The task center's retry calls the latest repair.
  const repairRef = useRef<() => Promise<unknown>>(() => Promise.resolve(null));
  const [validating, setValidating] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [lastResult, setLastResult] = useState<LibraryStructureValidationResult | null>(null);

  useEffect(() => {
    setLastResult(null);
  }, [libraryRoot]);

  const reloadLibrary = useCallback(async () => {
    try {
      const snapshot = await loadTracks(libraryRoot, artistSeparatorExceptions);
      setTracks(snapshot.library.map(importedTrackToTrack));
      setInboxTracks(snapshot.inbox.map(importedTrackToTrack));
    } catch {
      // The next normal library refresh will pick up the repaired paths.
    }
  }, [artistSeparatorExceptions, libraryRoot, setInboxTracks, setTracks]);

  const validate = useCallback(async () => {
    if (!libraryRoot) {
      notify.info(t("structure.noRoot"));
      return null;
    }
    if (busyRef.current) return null;

    busyRef.current = true;
    setValidating(true);
    const task = startTask({ kind: "organize", title: t("tasks.structure.validate") });
    try {
      const result = await validateLibraryStructure(libraryRoot);
      setLastResult(result);
      if (result.misplaced.length === 0) {
        const message = t("structure.allCorrect", { checked: String(result.checked) });
        task.succeed(message);
        notify.success(message);
      } else {
        const message = t("structure.found", {
          misplaced: String(result.misplaced.length),
          checked: String(result.checked),
        });
        task.succeed(message);
        notify.info(message);
      }
      return result;
    } catch (error) {
      task.fail(taskErrorMessage(error));
      notify.error(t("structure.failed"), { action: taskDetailsAction() });
      return null;
    } finally {
      busyRef.current = false;
      setValidating(false);
    }
  }, [libraryRoot]);

  const repair = useCallback(async () => {
    const trackIds = lastResult?.misplaced.map((track) => track.trackId) ?? [];
    if (!libraryRoot || trackIds.length === 0 || busyRef.current) return null;

    busyRef.current = true;
    setRepairing(true);
    const task = startTask({
      kind: "organize",
      title: t("tasks.structure.repair"),
      total: trackIds.length,
    });
    try {
      const repairResult = await repairLibraryStructure(libraryRoot, trackIds);
      task.progress(repairResult.requested, trackIds.length);
      for (const failure of repairResult.failures) {
        task.addError(taskItemName(failure.sourcePath), failure.message);
      }
      // Repairs only what is still misplaced, so running it again retries the failures.
      if (repairResult.failures.length > 0) task.update({ retry: () => void repairRef.current() });
      await reloadLibrary();
      const validation = await validateLibraryStructure(libraryRoot);
      setLastResult(validation);
      task.finish(t("tasks.structure.repairSummary", { moved: String(repairResult.moved.length) }));

      if (repairResult.failures.length > 0) {
        notify.error(
          t("structure.repairPartial", {
            moved: String(repairResult.moved.length),
            failed: String(repairResult.failures.length),
          }),
          { action: taskDetailsAction() },
        );
      } else {
        notify.success(
          t("structure.repairDone", {
            moved: String(repairResult.moved.length),
          }),
        );
      }
      return { repair: repairResult, validation } satisfies LibraryStructureRepairOutcome;
    } catch (error) {
      task.fail(taskErrorMessage(error));
      notify.error(isSafetyBackupError(error) ? error.message : t("structure.repairFailed"), {
        action: taskDetailsAction(),
      });
      return null;
    } finally {
      busyRef.current = false;
      setRepairing(false);
    }
  }, [lastResult, libraryRoot, reloadLibrary]);

  useEffect(() => {
    repairRef.current = repair;
  }, [repair]);

  return {
    hasLibraryRoot: Boolean(libraryRoot),
    validating,
    repairing,
    lastResult,
    validate,
    repair,
  };
};
