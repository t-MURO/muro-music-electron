import { useCallback, useState } from "react";
import { invoke } from "@muro/desktop/runtime";
import { open } from "@muro/desktop/dialogs";
import { notify, useLibraryStore, useSettingsStore } from "../stores";
import { importedTrackToTrack, loadTracks } from "../utils";
import { t } from "../i18n";

export type MissingTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  source_path: string;
  filename: string;
  duration_seconds: number;
};

type VerifyResult = {
  checked: number;
  newlyMissing: number;
  restored: number;
  missing: number;
};

type AutoRelinkResult = {
  matched: number;
  relinked: number;
  matches: { trackId: string; sourcePath: string }[];
};

/**
 * Finds library entries whose audio file has moved or been deleted, and puts
 * them back together with their files.
 *
 * Nothing here removes a track: a missing file is usually an unplugged drive or
 * a reorganized folder, so the entry (with its rating, play count and playlist
 * membership) is kept until the user says otherwise.
 */
export const useLibraryVerification = () => {
  const [verifying, setVerifying] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [lastResult, setLastResult] = useState<VerifyResult | null>(null);
  const [missingTracks, setMissingTracks] = useState<MissingTrack[]>([]);
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const artistSeparatorExceptions = useSettingsStore(
    (state) => state.artistSeparatorExceptions,
  );

  const reloadLibrary = useCallback(async () => {
    try {
      const snapshot = await loadTracks(undefined, artistSeparatorExceptions);
      setTracks(snapshot.library.map(importedTrackToTrack));
      setInboxTracks(snapshot.inbox.map(importedTrackToTrack));
    } catch {
      // The next library load picks the change up.
    }
  }, [artistSeparatorExceptions, setInboxTracks, setTracks]);

  const refreshMissing = useCallback(async () => {
    const tracks = await invoke<MissingTrack[]>("list_missing_tracks");
    setMissingTracks(tracks);
    return tracks;
  }, []);

  const verify = useCallback(async () => {
    if (verifying) return;
    setVerifying(true);
    try {
      const result = await invoke<VerifyResult>("verify_library_files");
      setLastResult(result);
      await refreshMissing();
      await reloadLibrary();

      if (result.missing === 0) {
        notify.success(t("verify.allPresent", { checked: String(result.checked) }));
      } else {
        notify.info(
          t("verify.foundMissing", {
            missing: String(result.missing),
            checked: String(result.checked),
          })
        );
      }
    } catch {
      notify.error(t("verify.failed"));
    } finally {
      setVerifying(false);
    }
  }, [refreshMissing, reloadLibrary, verifying]);

  /** Point one track at a replacement file the user picks. */
  const relinkTrack = useCallback(async (trackId: string) => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Audio",
          extensions: ["mp3", "flac", "wav", "m4a", "aac", "ogg", "aiff", "aif", "alac"],
        },
      ],
    });
    if (typeof selected !== "string") return;

    try {
      await invoke("relink_track", { trackId, newPath: selected });
      await refreshMissing();
      await reloadLibrary();
      notify.success(t("verify.relinked"));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : t("verify.relinkFailed"));
    }
  }, [refreshMissing, reloadLibrary]);

  /** Search a folder and reconnect everything that matches by name and length. */
  const autoRelink = useCallback(async () => {
    if (relinking) return;
    const directory = await open({ directory: true, multiple: false });
    if (typeof directory !== "string") return;

    setRelinking(true);
    try {
      const result = await invoke<AutoRelinkResult>("auto_relink_missing", {
        searchDir: directory,
        dryRun: false,
      });
      await refreshMissing();
      await reloadLibrary();

      if (result.relinked === 0) {
        notify.info(t("verify.autoRelink.none"));
      } else {
        notify.success(t("verify.autoRelink.done", { count: String(result.relinked) }));
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : t("verify.relinkFailed"));
    } finally {
      setRelinking(false);
    }
  }, [refreshMissing, reloadLibrary, relinking]);

  return {
    verifying,
    relinking,
    lastResult,
    missingTracks,
    verify,
    refreshMissing,
    relinkTrack,
    autoRelink,
  };
};
