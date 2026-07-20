import { useEffect, useRef } from "react";
import { invoke } from "@muro/desktop/runtime";
import { useLibraryStore, usePlaybackStore, useRecentlyPlayedStore, useSettingsStore } from "../stores";
import type { Track } from "../types";

const PLAY_THRESHOLD_SECONDS = 30;

type UsePlayTrackingArgs = {
  currentPosition: number;
  allTracks: Track[];
};

export const usePlayTracking = ({
  currentPosition,
  allTracks,
}: UsePlayTrackingArgs) => {
  const currentTrack = usePlaybackStore((s) => s.currentTrack);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const dbPath = useSettingsStore((s) => s.dbPath);
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);

  const playSessionTrackId = useRecentlyPlayedStore((s) => s.playSessionTrackId);
  const hasRecordedPlay = useRecentlyPlayedStore((s) => s.hasRecordedPlay);
  const startPlaySession = useRecentlyPlayedStore((s) => s.startPlaySession);
  const markPlayRecorded = useRecentlyPlayedStore((s) => s.markPlayRecorded);
  const addRecentlyPlayed = useRecentlyPlayedStore((s) => s.addRecentlyPlayed);

  // Track accumulated play time using refs to handle seeks correctly
  const accumulatedTimeRef = useRef(0);
  const lastPositionRef = useRef(0);
  const lastTrackIdRef = useRef<string | null>(null);

  // Reset tracking when track changes
  useEffect(() => {
    if (!currentTrack) {
      lastTrackIdRef.current = null;
      accumulatedTimeRef.current = 0;
      lastPositionRef.current = 0;
      return;
    }

    if (currentTrack.id !== lastTrackIdRef.current) {
      lastTrackIdRef.current = currentTrack.id;
      accumulatedTimeRef.current = 0;
      lastPositionRef.current = currentPosition;
      startPlaySession(currentTrack.id);
    }
  }, [currentTrack, currentPosition, startPlaySession]);

  // Track play time
  useEffect(() => {
    if (!currentTrack || !isPlaying || hasRecordedPlay) {
      return;
    }

    // Calculate time delta since last update
    const delta = currentPosition - lastPositionRef.current;
    lastPositionRef.current = currentPosition;

    // Only count small positive deltas (normal playback, not seeks)
    // A seek would result in a large positive or negative delta
    if (delta > 0 && delta < 2) {
      accumulatedTimeRef.current += delta;
    }

    // Check if we've hit the threshold
    if (
      accumulatedTimeRef.current >= PLAY_THRESHOLD_SECONDS &&
      currentTrack.id === playSessionTrackId &&
      !hasRecordedPlay
    ) {
      // Record the play
      markPlayRecorded();

      // Find the full track data to add to recently played
      const track = allTracks.find((t) => t.id === currentTrack.id);
      if (track) {
        const playedAt = new Date().toISOString();
        const applyRecordedPlay = (candidate: Track): Track => candidate.id === track.id
          ? {
              ...candidate,
              lastPlayedAt: playedAt,
              playCount: (candidate.playCount || 0) + 1,
            }
          : candidate;
        addRecentlyPlayed(track, playedAt);
        setTracks((current) => current.map(applyRecordedPlay));
        setInboxTracks((current) => current.map(applyRecordedPlay));
      }

      // Update database
      invoke("record_track_play", {
        dbPath,
        trackId: currentTrack.id,
      }).catch((error) => {
        console.error("Failed to record track play:", error);
      });
    }
  }, [
    currentTrack,
    currentPosition,
    isPlaying,
    hasRecordedPlay,
    playSessionTrackId,
    dbPath,
    markPlayRecorded,
    addRecentlyPlayed,
    setTracks,
    setInboxTracks,
    allTracks,
  ]);
};
