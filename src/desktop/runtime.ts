import { bridge } from "./bridge";
import { emitLocal } from "./events";

type CurrentTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  source_path: string;
  cover_art_path?: string;
  cover_art_thumb_path?: string;
};

type PlaybackState = {
  is_playing: boolean;
  current_position: number;
  duration: number;
  volume: number;
  current_track: CurrentTrack | null;
};

let audio: HTMLAudioElement | null = null;
let currentTrack: CurrentTrack | null = null;
let durationHint = 0;
let seekMode = "accurate";

const state = (): PlaybackState => ({
  is_playing: Boolean(audio && !audio.paused && !audio.ended),
  current_position: audio?.currentTime ?? 0,
  duration: Number.isFinite(audio?.duration) ? audio!.duration : durationHint,
  volume: audio?.volume ?? 1,
  current_track: currentTrack,
});

const emitState = () => emitLocal("muro://playback-state", state());

const waitForMediaEvent = (
  player: HTMLAudioElement,
  successEvent: "loadedmetadata" | "seeked",
  timeoutMs: number
) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      player.removeEventListener(successEvent, handleSuccess);
      player.removeEventListener("error", handleError);
    };
    const handleSuccess = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(player.error?.message ?? "Media operation failed"));
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${successEvent} timed out`));
    }, timeoutMs);

    player.addEventListener(successEvent, handleSuccess, { once: true });
    player.addEventListener("error", handleError, { once: true });
  });

const seekPlayer = async (player: HTMLAudioElement, requestedPosition: number) => {
  if (player.readyState === HTMLMediaElement.HAVE_NOTHING) {
    const metadataLoaded = waitForMediaEvent(player, "loadedmetadata", 5_000);
    player.load();
    await metadataLoaded;
  }

  const knownDuration = Number.isFinite(player.duration) ? player.duration : durationHint;
  const position = Math.max(
    0,
    knownDuration > 0 ? Math.min(requestedPosition, knownDuration) : requestedPosition
  );

  if (Math.abs(player.currentTime - position) < 0.01) {
    emitLocal("muro://playback-position", player.currentTime);
    return;
  }

  const seekFinished = waitForMediaEvent(player, "seeked", 5_000);
  const fastSeek = (player as HTMLAudioElement & { fastSeek?: (time: number) => void }).fastSeek;
  try {
    if (seekMode === "fast" && typeof fastSeek === "function") {
      fastSeek.call(player, position);
    } else {
      player.currentTime = position;
    }
  } catch (error) {
    void seekFinished.catch(() => undefined);
    throw error;
  }
  await seekFinished;
  emitLocal("muro://playback-position", player.currentTime);
  emitState();
};

const ensureAudio = (): HTMLAudioElement => {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "metadata";
  audio.addEventListener("timeupdate", () => {
    emitLocal("muro://playback-position", audio?.currentTime ?? 0);
  });
  audio.addEventListener("play", emitState);
  audio.addEventListener("pause", emitState);
  audio.addEventListener("loadedmetadata", emitState);
  audio.addEventListener("ended", () => {
    emitState();
    emitLocal("muro://track-ended", null);
  });
  audio.addEventListener("error", () => {
    emitLocal("muro://playback-error", audio?.error?.message ?? "Playback failed");
  });
  return audio;
};

const playbackInvoke = async <T>(
  command: string,
  args: Record<string, unknown>
): Promise<T> => {
  const player = ensureAudio();
  switch (command) {
    case "playback_play_file": {
      currentTrack = {
        id: String(args.id),
        title: String(args.title),
        artist: String(args.artist),
        album: String(args.album),
        source_path: String(args.sourcePath),
        cover_art_path: args.coverArtPath as string | undefined,
        cover_art_thumb_path: args.coverArtThumbPath as string | undefined,
      };
      durationHint = Number(args.durationHint) || 0;
      player.src = convertFileSrc(currentTrack.source_path);
      player.currentTime = 0;
      await player.play();
      return undefined as T;
    }
    case "playback_toggle":
      if (player.paused) await player.play();
      else player.pause();
      return (!player.paused) as T;
    case "playback_play":
      await player.play();
      return undefined as T;
    case "playback_pause":
      player.pause();
      return undefined as T;
    case "playback_stop":
      player.pause();
      player.currentTime = 0;
      currentTrack = null;
      emitState();
      return undefined as T;
    case "playback_seek":
      await seekPlayer(player, Math.max(0, Number(args.positionSecs) || 0));
      return undefined as T;
    case "playback_set_volume":
      player.volume = Math.max(0, Math.min(1, Number(args.volume)));
      emitState();
      return undefined as T;
    case "playback_set_seek_mode":
      seekMode = String(args.mode || "accurate");
      return undefined as T;
    case "playback_get_state":
      return state() as T;
    case "playback_is_finished":
      return Boolean(player.ended) as T;
    default:
      throw new Error(`Unknown playback command: ${command}`);
  }
};

export const invoke = <T>(
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> => {
  if (command.startsWith("playback_")) return playbackInvoke<T>(command, args);
  return bridge().invoke<T>(command, args);
};

export const convertFileSrc = (filePath: string): string =>
  `muro-file://local/${encodeURIComponent(filePath)}`;
