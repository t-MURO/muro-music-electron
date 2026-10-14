import { useEffect, useRef } from "react";
import { usePlaybackStore, useSleepTimerStore } from "../stores";
import { activeRemoteProtocol, isRemoteOutputActive } from "../stores/remoteOutputStore";
import { runSleepFade } from "../lib/sleepTimer";
import { playbackSetVolume } from "../utils/playbackApi";
import { remoteSetVolume } from "../utils/remoteOutputApi";

type UseSleepTimerArgs = {
  /** Output-aware pause (local element or the active Cast/DLNA device). */
  pause: () => Promise<void>;
};

const CHECK_INTERVAL_MS = 1_000;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// Routed like useAudioPlayback's setVolume, but failures propagate instead of
// raising a toast per fade step.
const setOutputVolume = async (volume: number) => {
  const protocol = activeRemoteProtocol();
  if (protocol && isRemoteOutputActive()) await remoteSetVolume(protocol, volume);
  else await playbackSetVolume(volume);
  usePlaybackStore.getState().setVolume(volume);
};

/**
 * Runs the timed sleep: once the deadline passes it fades the output to
 * silence, pauses, and puts the user's volume back so the next play is not
 * silent. Stop-after-this-track is handled at the track boundary instead.
 */
export const useSleepTimer = ({ pause }: UseSleepTimerArgs) => {
  const endsAt = useSleepTimerStore((s) => s.endsAt);

  const pauseRef = useRef(pause);
  useEffect(() => {
    pauseRef.current = pause;
  }, [pause]);

  useEffect(() => {
    if (endsAt === null) return;

    const expire = async () => {
      const sleep = useSleepTimerStore.getState();
      const playback = usePlaybackStore.getState();
      if (!playback.isPlaying) {
        // Already paused: nothing to fade, the timer simply runs out.
        sleep.clearTimer();
        return;
      }

      // Cancelling, or starting another timer, replaces endsAt.
      const isCancelled = () => useSleepTimerStore.getState().endsAt !== endsAt;
      const startVolume = playback.volume;
      sleep.setFading(true);

      let outcome: "completed" | "cancelled";
      try {
        outcome = await runSleepFade({
          startVolume,
          setVolume: setOutputVolume,
          wait,
          now: () => performance.now(),
          isCancelled,
        });
      } catch {
        // The output refused a volume step; still honour the timer.
        outcome = isCancelled() ? "cancelled" : "completed";
      }

      if (outcome === "completed") await pauseRef.current();
      await setOutputVolume(startVolume).catch(() => undefined);
      if (!isCancelled()) useSleepTimerStore.getState().clearTimer();
    };

    // Polling the wall clock (instead of one long timeout) stays correct
    // across system sleep and clock changes.
    let fired = false;
    const check = () => {
      if (fired || Date.now() < endsAt) return;
      fired = true;
      window.clearInterval(intervalId);
      void expire();
    };
    const intervalId = window.setInterval(check, CHECK_INTERVAL_MS);
    check();
    return () => window.clearInterval(intervalId);
  }, [endsAt]);
};
