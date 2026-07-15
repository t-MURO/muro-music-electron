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

export type MediaControlPayload = {
  action: "play" | "pause" | "toggle" | "next" | "previous";
  source: "media-session" | "global-shortcut" | string;
};

let audio: HTMLAudioElement | null = null;
let currentTrack: CurrentTrack | null = null;
let durationHint = 0;
let seekMode = "accurate";
let mediaSessionConfigured = false;
let playbackOperationChain: Promise<unknown> = Promise.resolve();

const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "stop",
  "nexttrack",
  "previoustrack",
  "seekbackward",
  "seekforward",
  "seekto",
];

const state = (): PlaybackState => ({
  is_playing: Boolean(audio && !audio.paused && !audio.ended),
  current_position: audio?.currentTime ?? 0,
  duration: Number.isFinite(audio?.duration) ? audio!.duration : durationHint,
  volume: audio?.volume ?? 1,
  current_track: currentTrack,
});

const syncMediaSessionState = () => {
  if (!("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.playbackState = audio && !audio.paused && !audio.ended
      ? "playing"
      : "paused";
  } catch {
    // Media-session state can be unavailable during device hand-off.
  }

  const duration = Number.isFinite(audio?.duration) ? audio!.duration : durationHint;
  if (!audio || !Number.isFinite(duration) || duration <= 0) return;

  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.max(0, Math.min(audio.currentTime || 0, duration)),
    });
  } catch {
    // Some platforms expose Media Session without position-state support.
  }
};

const emitState = () => {
  syncMediaSessionState();
  emitLocal("muro://playback-state", state());
};

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

const setMediaSessionMetadata = (track: CurrentTrack | null) => {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }

  const coverPath = track.cover_art_thumb_path || track.cover_art_path;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: coverPath ? [{ src: convertFileSrc(coverPath) }] : undefined,
  });
};

const emitMediaSessionControl = (action: MediaControlPayload["action"]) => {
  emitLocal("muro://media-control", { action, source: "media-session" } satisfies MediaControlPayload);
};

const configureMediaSession = (player: HTMLAudioElement) => {
  if (!("mediaSession" in navigator) || mediaSessionConfigured) return;
  mediaSessionConfigured = true;

  const setHandler = (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler,
  ) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Action support varies by operating system and Electron version.
    }
  };

  setHandler("play", () => emitMediaSessionControl("play"));
  setHandler("pause", () => emitMediaSessionControl("pause"));
  setHandler("stop", () => {
    void queuePlaybackInvoke("playback_stop", {}).catch(() => {
      emitLocal("muro://playback-error", "Failed to stop playback");
    });
  });
  setHandler("nexttrack", () => emitMediaSessionControl("next"));
  setHandler("previoustrack", () => emitMediaSessionControl("previous"));
  setHandler("seekbackward", (details) => {
    void queuePlaybackInvoke("playback_seek", {
      positionSecs: player.currentTime - (details.seekOffset ?? 10),
    }).catch(() => {
      emitLocal("muro://playback-error", "Failed to seek backward");
    });
  });
  setHandler("seekforward", (details) => {
    void queuePlaybackInvoke("playback_seek", {
      positionSecs: player.currentTime + (details.seekOffset ?? 10),
    }).catch(() => {
      emitLocal("muro://playback-error", "Failed to seek forward");
    });
  });
  setHandler("seekto", (details) => {
    if (typeof details.seekTime === "number") {
      void queuePlaybackInvoke("playback_seek", { positionSecs: details.seekTime }).catch(() => {
        emitLocal("muro://playback-error", "Failed to seek");
      });
    }
  });
};

const ensureAudio = (): HTMLAudioElement => {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "metadata";
  audio.addEventListener("timeupdate", () => {
    emitLocal("muro://playback-position", audio?.currentTime ?? 0);
    syncMediaSessionState();
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
  configureMediaSession(audio);
  return audio;
};

const playbackInvoke = async <T>(
  command: string,
  args: Record<string, unknown>
): Promise<T> => {
  const player = ensureAudio();
  switch (command) {
    case "playback_play_file": {
      // Stop the previous source before changing tracks. This also makes
      // repeated/rapid play requests deterministic on Windows.
      player.pause();
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
      setMediaSessionMetadata(currentTrack);
      player.src = convertFileSrc(currentTrack.source_path);
      player.currentTime = 0;
      emitState();
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
      if (!player.paused) player.pause();
      emitState();
      return undefined as T;
    case "playback_stop":
      player.pause();
      player.currentTime = 0;
      currentTrack = null;
      setMediaSessionMetadata(null);
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

const queuePlaybackInvoke = <T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> => {
  const operation = playbackOperationChain.then(
    () => playbackInvoke<T>(command, args),
    () => playbackInvoke<T>(command, args),
  );
  playbackOperationChain = operation.catch(() => undefined);
  return operation;
};

export const invoke = <T>(
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> => {
  if (command.startsWith("playback_")) return queuePlaybackInvoke<T>(command, args);
  return bridge().invoke<T>(command, args);
};

export const convertFileSrc = (filePath: string): string =>
  `muro-file://local/${encodeURIComponent(filePath)}`;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // A Vite hot reload must never leave the previous module's Audio element
    // playing invisibly alongside the replacement runtime.
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if ("mediaSession" in navigator) {
      for (const action of MEDIA_SESSION_ACTIONS) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore actions unsupported by the host OS.
        }
      }
      navigator.mediaSession.metadata = null;
    }
    audio = null;
    currentTrack = null;
    durationHint = 0;
    mediaSessionConfigured = false;
    playbackOperationChain = Promise.resolve();
  });
}
