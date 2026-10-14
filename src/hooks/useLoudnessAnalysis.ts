import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@muro/desktop/runtime";
import { analyzeAndStoreLoudness } from "../lib/loudness/service";
import { notify, startTask, useLibraryStore, useSettingsStore } from "../stores";
import { loadTracks, importedTrackToTrack } from "../utils";
import { taskDetailsAction, taskErrorMessage, taskItemName } from "../utils/tasks";
import { t } from "../i18n";

type PendingTrack = { id: string; source_path: string };

export type LoudnessScanState = {
  running: boolean;
  analyzed: number;
  total: number;
  failed: number;
};

const IDLE_STATE: LoudnessScanState = {
  running: false,
  analyzed: 0,
  total: 0,
  failed: 0,
};

/**
 * Measures loudness for library tracks that have no ReplayGain value yet.
 *
 * Decoding happens in the renderer (the same route beat-grid analysis takes),
 * one track at a time, so a long scan does not compete with playback for
 * memory. Tracks that already carried ReplayGain tags are skipped by the
 * backend query.
 */
export const useLoudnessAnalysis = () => {
  const [state, setState] = useState<LoudnessScanState>(IDLE_STATE);
  const cancelRef = useRef(false);
  // The task center's retry outlives this component (it lives in Settings).
  const runRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const artistSeparatorExceptions = useSettingsStore(
    (settings) => settings.artistSeparatorExceptions,
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const run = useCallback(async () => {
    if (cancelRef.current) cancelRef.current = false;

    const referenceLufs = useSettingsStore.getState().replayGainReferenceLufs;

    let pending: PendingTrack[];
    try {
      pending = await invoke<PendingTrack[]>("list_tracks_needing_loudness", {
        limit: 2000,
      });
    } catch {
      notify.error(t("loudness.scan.failed"));
      return;
    }

    if (pending.length === 0) {
      notify.info(t("loudness.scan.upToDate"));
      return;
    }

    setState({ running: true, analyzed: 0, total: pending.length, failed: 0 });
    const task = startTask({
      kind: "loudness",
      title: t("tasks.loudness.title"),
      total: pending.length,
      cancel: () => {
        cancelRef.current = true;
      },
    });

    let analyzed = 0;
    let failed = 0;
    for (const track of pending) {
      if (cancelRef.current) break;
      task.setDetail(taskItemName(track.source_path));
      try {
        await analyzeAndStoreLoudness(
          { id: track.id, sourcePath: track.source_path },
          referenceLufs,
        );
        analyzed += 1;
      } catch (error) {
        // A single undecodable file must not end the scan.
        failed += 1;
        task.addError(taskItemName(track.source_path), taskErrorMessage(error));
      }
      setState({ running: true, analyzed, total: pending.length, failed });
      task.progress(analyzed + failed, pending.length);
    }

    // Album gain needs every track on a release, so it is derived once at the
    // end rather than after each file.
    if (analyzed > 0) {
      try {
        await invoke("recompute_album_gain", { referenceLufs });
      } catch {
        // Track gain is still usable without it.
      }
      try {
        const snapshot = await loadTracks(undefined, artistSeparatorExceptions);
        setTracks(snapshot.library.map(importedTrackToTrack));
        setInboxTracks(snapshot.inbox.map(importedTrackToTrack));
      } catch {
        // The next library load picks the new values up.
      }
    }

    setState({ running: false, analyzed, total: pending.length, failed });
    const summary = t("tasks.loudness.summary", {
      analyzed: String(analyzed),
      failed: String(failed),
    });
    if (failed > 0) task.update({ retry: () => void runRef.current() });
    if (cancelRef.current) task.cancelled(summary);
    else task.finish(summary);
    cancelRef.current = false;

    if (failed > 0) {
      notify.info(
        t("loudness.scan.finishedWithFailures", {
          analyzed: String(analyzed),
          failed: String(failed),
        }),
        { action: taskDetailsAction() },
      );
    } else {
      notify.success(t("loudness.scan.finished", { analyzed: String(analyzed) }));
    }
  }, [artistSeparatorExceptions, setInboxTracks, setTracks]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  return { ...state, run, cancel };
};
