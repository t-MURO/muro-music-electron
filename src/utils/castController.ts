import { t } from "../i18n";
import { notify } from "../stores/notificationStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useCastStore } from "../stores/castStore";
import {
  castConnect,
  castDisconnect,
  castErrorCode,
  castLoadTrack,
  castStopDiscovery,
} from "./castApi";
import {
  playbackGetState,
  playbackPause,
  playbackPlayFile,
  playbackSeek,
} from "./playbackApi";

// Output-switching choreography from CHROMECAST_FEATURE.md: exactly one
// output plays at a time, and switching never silently drops the listening
// position.

// Connect to a device and hand the current local track over to it. Local
// playback is paused first; if the remote load fails the local track stays
// paused at the captured position so nothing plays twice.
export const connectToCastDevice = async (deviceId: string): Promise<void> => {
  const playback = usePlaybackStore.getState();
  const handoffTrack = playback.currentTrack;
  const handoffPosition = playback.currentPosition;

  if (playback.isPlaying) {
    await playbackPause();
    playback.setIsPlaying(false);
  }

  await castConnect(deviceId);

  if (!handoffTrack) return;
  try {
    await castLoadTrack({
      trackId: handoffTrack.id,
      sourcePath: handoffTrack.sourcePath,
      title: handoffTrack.title,
      artist: handoffTrack.artist,
      album: handoffTrack.album,
      durationSeconds: handoffTrack.durationSeconds,
      coverArtPath: handoffTrack.coverArtPath,
      startPositionSecs: handoffPosition,
      autoplay: true,
    });
    playback.setIsPlaying(true);
  } catch (error) {
    notify.error(
      castErrorCode(error) === "CAST_UNSUPPORTED_FORMAT"
        ? t("player.cast.unsupported")
        : t("player.cast.loadFailed"),
    );
  }
};

// Disconnect and return to the local output, paused at the last remote
// position. If the queue advanced while casting, the cast track is loaded
// locally (paused) so pressing play continues the right song.
export const disconnectFromCast = async (): Promise<void> => {
  const remoteTrackId = useCastStore.getState().remoteTrack?.trackId ?? null;
  const { lastPositionSecs } = await castDisconnect();
  void castStopDiscovery().catch(() => undefined);

  const playback = usePlaybackStore.getState();
  try {
    const localState = await playbackGetState();
    const localTrackId = localState.current_track?.id ?? null;

    if (remoteTrackId && localTrackId !== remoteTrackId) {
      const library = useLibraryStore.getState();
      const track = [...library.tracks, ...library.inboxTracks]
        .find((entry) => entry.id === remoteTrackId);
      if (track) {
        await playbackPlayFile(
          track.id,
          track.title,
          track.artist,
          track.album,
          track.sourcePath,
          track.durationSeconds,
          track.coverArtPath,
          track.coverArtThumbPath,
        );
        await playbackPause();
      }
    }
    if (lastPositionSecs != null) {
      await playbackSeek(lastPositionSecs);
      playback.setCurrentPosition(lastPositionSecs);
    }
    const refreshed = await playbackGetState();
    playback.setIsPlaying(false);
    playback.setVolume(refreshed.volume);
    playback.setDuration(refreshed.duration);
  } catch {
    // Returning to local output must never fail the disconnect itself.
    playback.setIsPlaying(false);
  }
};
