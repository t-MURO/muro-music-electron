import { useEffect, useRef } from "react";
import { invoke } from "@muro/desktop/runtime";
import {
  useLibraryStore,
  usePlaybackStore,
  useRecentlyPlayedStore,
} from "../stores";
import type { Track } from "../types";
import {
  RECORD_PLAY_RETRY_DELAYS_MS,
  isPlayRestart,
  retryWithBackoff,
  revertRecentlyPlayed,
  revertRecordedPlay,
  type RecordedPlay,
} from "../utils/playTracking";

const PLAY_THRESHOLD_SECONDS = 30;
const SYNC_INTERVAL_SECONDS = 10;

type UsePlayTrackingArgs = {
  currentPosition: number;
  allTracks: Track[];
};

type ActiveSession = {
  trackId: string | null;
  accumulated: number;
  lastPosition: number;
  lastSynced: number;
  historyId: number | null;
  // Set once this play has been counted. It stays set while recording is
  // retried and after it fails, so position updates never count it again.
  counted: boolean;
};

const createSession = (trackId: string | null, position: number): ActiveSession => ({
  trackId,
  accumulated: 0,
  lastPosition: position,
  lastSynced: 0,
  historyId: null,
  counted: false,
});

export const usePlayTracking = ({
  currentPosition,
  allTracks,
}: UsePlayTrackingArgs) => {
  const currentTrack = usePlaybackStore((s) => s.currentTrack);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const setTracks = useLibraryStore((s) => s.setTracks);
  const setInboxTracks = useLibraryStore((s) => s.setInboxTracks);
  const startPlaySession = useRecentlyPlayedStore((s) => s.startPlaySession);
  const markPlayRecorded = useRecentlyPlayedStore((s) => s.markPlayRecorded);
  const addRecentlyPlayed = useRecentlyPlayedStore((s) => s.addRecentlyPlayed);
  const setRecentlyPlayedTracks = useRecentlyPlayedStore((s) => s.setRecentlyPlayedTracks);
  const sessionRef = useRef<ActiveSession>(createSession(null, 0));

  const flushSession = (session: ActiveSession) => {
    if (!session.historyId || session.accumulated <= session.lastSynced) return;
    session.lastSynced = session.accumulated;
    invoke("update_play_history", {
      historyId: session.historyId,
      listenedSeconds: session.accumulated,
    }).catch((error) => console.error("Failed to update listening history:", error));
  };

  useEffect(() => () => flushSession(sessionRef.current), []);

  useEffect(() => {
    const trackId = currentTrack?.id ?? null;
    const session = sessionRef.current;
    if (trackId !== session.trackId) {
      flushSession(session);
      sessionRef.current = createSession(trackId, currentPosition);
      if (trackId) startPlaySession(trackId);
      return;
    }
    session.lastPosition = currentPosition;
  }, [currentTrack?.id, startPlaySession]);

  useEffect(() => {
    let session = sessionRef.current;
    if (!currentTrack || currentTrack.id !== session.trackId) return;
    if (session.counted && isPlayRestart(session.lastPosition, currentPosition)) {
      // The same track started over after its play was counted: this is a
      // new play of it, not more listening time for the previous one.
      flushSession(session);
      session = createSession(session.trackId, currentPosition);
      sessionRef.current = session;
    }
    const delta = currentPosition - session.lastPosition;
    session.lastPosition = currentPosition;
    if (!isPlaying) return;
    if (delta > 0 && delta < 2) session.accumulated += delta;

    if (session.accumulated >= PLAY_THRESHOLD_SECONDS && !session.counted) {
      session.counted = true;
      markPlayRecorded();
      const track = allTracks.find((candidate) => candidate.id === currentTrack.id);
      const play: RecordedPlay = {
        trackId: currentTrack.id,
        playedAt: new Date().toISOString(),
        previousLastPlayedAt: track?.lastPlayedAt,
      };
      if (track) {
        const applyRecordedPlay = (candidate: Track): Track => candidate.id === track.id
          ? {
              ...candidate,
              lastPlayedAt: play.playedAt,
              playCount: (candidate.playCount || 0) + 1,
            }
          : candidate;
        addRecentlyPlayed(track, play.playedAt);
        setTracks((items) => items.map(applyRecordedPlay));
        setInboxTracks((items) => items.map(applyRecordedPlay));
      }
      retryWithBackoff(
        () => invoke<{ historyId: number }>("record_track_play", {
          trackId: play.trackId,
        }),
        RECORD_PLAY_RETRY_DELAYS_MS,
      ).then((result) => {
        session.historyId = result.historyId;
        session.lastSynced = PLAY_THRESHOLD_SECONDS;
        flushSession(session);
      }, (error) => {
        // Retries are exhausted: undo the optimistic update so the library
        // shows what the database actually stored.
        console.error("Failed to record track play:", error);
        if (!track) return;
        const revert = (candidate: Track) => revertRecordedPlay(candidate, play);
        setTracks((items) => items.map(revert));
        setInboxTracks((items) => items.map(revert));
        setRecentlyPlayedTracks(revertRecentlyPlayed(
          useRecentlyPlayedStore.getState().recentlyPlayedTracks,
          play,
        ));
      });
      return;
    }

    if (
      session.historyId
      && session.accumulated - session.lastSynced >= SYNC_INTERVAL_SECONDS
    ) flushSession(session);
  }, [
    addRecentlyPlayed,
    allTracks,
    currentPosition,
    currentTrack,
    isPlaying,
    markPlayRecorded,
    setInboxTracks,
    setRecentlyPlayedTracks,
    setTracks,
  ]);
};
