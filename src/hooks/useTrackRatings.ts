import { useCallback } from "react";
import { invoke } from "@muro/desktop/runtime";
import { useLibraryStore } from "../stores";
import { useDbPath } from "./useDbPath";

export const useTrackRatings = () => {
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const resolveDbPath = useDbPath();

  const clampRating = (value: number) =>
    Math.max(0, Math.min(5, Math.round(value * 2) / 2));

  const handleRatingChange = useCallback(
    (id: string, rating: number) => {
      const nextRating = clampRating(rating);
      setTracks((current) =>
        current.map((track) =>
          track.id === id ? { ...track, rating: nextRating } : track
        )
      );
      setInboxTracks((current) =>
        current.map((track) =>
          track.id === id ? { ...track, rating: nextRating } : track
        )
      );

      resolveDbPath()
        .then((dbPath) =>
          invoke("update_track_metadata", {
            dbPath,
            trackIds: [id],
            updates: { rating: nextRating },
          })
        )
        .catch((err) => console.error("Failed to persist rating:", err));
    },
    [resolveDbPath, setInboxTracks, setTracks]
  );

  return { handleRatingChange };
};
