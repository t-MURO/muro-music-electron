import { useCallback } from "react";
import { commandManager } from "../command-manager/commandManager";
import { useLibraryStore, useSettingsStore, useUIStore, notify } from "../stores";
import { useDbPath } from "./useDbPath";
import { acceptTracks, rejectTracks, unacceptTracks } from "../utils";
import { t } from "../i18n";

export const useInboxOperations = () => {
  // Get state and actions from stores
  const inboxTracks = useLibraryStore((s) => s.inboxTracks);
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const organizeAcceptedTracks = useSettingsStore((s) => s.organizeAcceptedTracks);
  const watchedFolders = useSettingsStore((s) => s.watchedFolders);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const resolveDbPath = useDbPath();

  const handleAcceptTracks = useCallback(async () => {
    const selectedTrackIds = Array.from(selectedIds);
    if (selectedTrackIds.length === 0) {
      return;
    }

    let tracksToAccept = inboxTracks.filter((t) => selectedIds.has(t.id));
    const resolvedDbPath = await resolveDbPath();

    clearSelection();

    const command = {
      label: `Accept ${selectedTrackIds.length} tracks`,
      do: () => {
        setInboxTracks((current) =>
          current.filter((t) => !selectedTrackIds.includes(t.id))
        );
        setTracks((current) => [...tracksToAccept, ...current]);
        acceptTracks(resolvedDbPath, selectedTrackIds, {
          organize: organizeAcceptedTracks,
          watchedFolders,
        }).then((result) => {
          const movedPaths = new Map(
            result.moved.map((entry) => [entry.trackId, entry.sourcePath]),
          );
          const applyMovedPaths = (track: typeof tracksToAccept[number]) => {
            const sourcePath = movedPaths.get(track.id);
            return sourcePath ? { ...track, sourcePath } : track;
          };
          tracksToAccept = tracksToAccept.map(applyMovedPaths);
          setTracks((current) => current.map(applyMovedPaths));
          setInboxTracks((current) => current.map(applyMovedPaths));
          if (result.failures.length > 0) {
            notify.error(t("toast.inbox.organizeFailed", {
              count: String(result.failures.length),
            }));
          }
        }).catch(() => {
          notify.error(t("toast.inbox.acceptFailed"));
        });
      },
      undo: () => {
        setTracks((current) =>
          current.filter((t) => !selectedTrackIds.includes(t.id))
        );
        setInboxTracks((current) => [...tracksToAccept, ...current]);
        unacceptTracks(resolvedDbPath, selectedTrackIds).catch(() => {
          notify.error(t("toast.inbox.undoAcceptFailed"));
        });
      },
    };

    commandManager.execute(command);
  }, [
    clearSelection,
    resolveDbPath,
    inboxTracks,
    selectedIds,
    organizeAcceptedTracks,
    watchedFolders,
    setInboxTracks,
    setTracks,
  ]);

  const handleRejectTracks = useCallback(async () => {
    const selectedTrackIds = Array.from(selectedIds);
    if (selectedTrackIds.length === 0) {
      return;
    }

    const tracksToReject = inboxTracks.filter((t) => selectedIds.has(t.id));
    const resolvedDbPath = await resolveDbPath();

    clearSelection();

    const command = {
      label: `Reject ${selectedTrackIds.length} tracks`,
      do: () => {
        setInboxTracks((current) =>
          current.filter((t) => !selectedTrackIds.includes(t.id))
        );
        rejectTracks(resolvedDbPath, selectedTrackIds).catch(() => {
          notify.error(t("toast.inbox.rejectFailed"));
        });
      },
      undo: () => {
        // Note: DB deletion is permanent, this only restores frontend state
        setInboxTracks((current) => [...tracksToReject, ...current]);
      },
    };

    commandManager.execute(command);
  }, [clearSelection, resolveDbPath, inboxTracks, selectedIds, setInboxTracks]);

  return {
    handleAcceptTracks,
    handleRejectTracks,
  };
};
