import { t } from "../i18n";
import { notify } from "../stores/notificationStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useRemoteOutputStore } from "../stores/remoteOutputStore";
import {
  isRemoteUnsupportedFormat,
  remoteConnect,
  remoteDisconnect,
  remoteLoadTrack,
  remoteStopDiscovery,
  type RemoteDevice,
} from "./remoteOutputApi";
import {
  playbackGetState,
  playbackPause,
  playbackPlayFile,
  playbackSeek,
} from "./playbackApi";

// Output-switching choreography shared by both remote protocols: exactly one
// output plays at a time, and switching never silently drops the listening
// position.

// Connect to a device and hand the current local track over to it. Local
// playback is paused first; if the remote load fails the local track stays
// paused at the captured position so nothing plays twice.
export const connectToRemoteDevice = async (device: RemoteDevice): Promise<void> => {
  const playback = usePlaybackStore.getState();
  const handoffTrack = playback.currentTrack;
  const handoffPosition = playback.currentPosition;

  if (playback.isPlaying) {
    await playbackPause();
    playback.setIsPlaying(false);
  }

  await remoteConnect(device);

  if (!handoffTrack) return;
  try {
    await remoteLoadTrack(device.protocol, {
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
      isRemoteUnsupportedFormat(error)
        ? t("player.output.unsupported")
        : t("player.output.loadFailed"),
    );
  }
};

// Disconnect and return to the local output, paused at the last remote
// position. If the queue advanced while remote, the remote track is loaded
// locally (paused) so pressing play continues the right song.
export const disconnectFromRemote = async (): Promise<void> => {
  const remoteState = useRemoteOutputStore.getState();
  const protocol = remoteState.protocol;
  const remoteTrackId = remoteState.remoteTrack?.trackId ?? null;
  if (!protocol) return;

  const { lastPositionSecs } = await remoteDisconnect(protocol);
  void remoteStopDiscovery().catch(() => undefined);

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
