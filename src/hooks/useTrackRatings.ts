import { useCallback } from "react";
import { invoke } from "@muro/desktop/runtime";
import { useLibraryStore } from "../stores";
import {
  recordMetadataWrite,
  showTagWriteFailures,
  type MetadataWriteResult,
} from "../utils/tagWriteFailures";

export const useTrackRatings = () => {
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);

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

      const updates = { rating: nextRating };
      invoke<MetadataWriteResult>("update_track_metadata", {
        trackIds: [id],
        updates,
      })
        .then((result) => {
          recordMetadataWrite([id], updates, result);
          showTagWriteFailures();
        })
        .catch((err) => console.error("Failed to persist rating:", err));
    },
    [setInboxTracks, setTracks]
  );

  return { handleRatingChange };
};
