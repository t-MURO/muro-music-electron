import { useCallback } from "react";
import { commandManager } from "../command-manager/commandManager";
import { useLibraryStore, useUIStore, notify } from "../stores";
import { useDbPath } from "./useDbPath";
import { acceptTracks, rejectTracks, unacceptTracks } from "../utils";

export const useInboxOperations = () => {
  // Get state and actions from stores
  const inboxTracks = useLibraryStore((s) => s.inboxTracks);
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const resolveDbPath = useDbPath();

  const handleAcceptTracks = useCallback(async () => {
    const selectedTrackIds = Array.from(selectedIds);
    if (selectedTrackIds.length === 0) {
      return;
    }

    const tracksToAccept = inboxTracks.filter((t) => selectedIds.has(t.id));
    const resolvedDbPath = await resolveDbPath();

    clearSelection();

    const command = {
      label: `Accept ${selectedTrackIds.length} tracks`,
      do: () => {
        setInboxTracks((current) =>
          current.filter((t) => !selectedTrackIds.includes(t.id))
        );
        setTracks((current) => [...tracksToAccept, ...current]);
        acceptTracks(resolvedDbPath, selectedTrackIds).catch(() => {
          notify.error("Failed to accept tracks");
        });
      },
      undo: () => {
        setTracks((current) =>
          current.filter((t) => !selectedTrackIds.includes(t.id))
        );
        setInboxTracks((current) => [...tracksToAccept, ...current]);
        unacceptTracks(resolvedDbPath, selectedTrackIds).catch(() => {
          notify.error("Failed to undo accept");
        });
      },
    };

    commandManager.execute(command);
  }, [
    clearSelection,
    resolveDbPath,
    inboxTracks,
    selectedIds,
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
          notify.error("Failed to reject tracks");
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
