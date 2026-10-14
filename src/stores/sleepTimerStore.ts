import { create } from "zustand";
import { sleepTimerEndsAt } from "../lib/sleepTimer";

// Session-only by design: a sleep timer surviving a restart would pause
// playback the user started fresh.
type SleepTimerState = {
  /** Epoch ms at which the timed sleep fires; null when no timer runs. */
  endsAt: number | null;
  /** Preset the running timer was started from, for highlighting. */
  minutes: number | null;
  /** True while the expiry fade-out is in progress. */
  isFading: boolean;
  /** Pause when the current track ends instead of advancing. */
  stopAfterCurrent: boolean;
};

type SleepTimerActions = {
  startTimer: (minutes: number) => void;
  /** "End of current track" sleep option: reuses stop-after-this-track. */
  sleepAtEndOfTrack: () => void;
  setStopAfterCurrent: (enabled: boolean) => void;
  toggleStopAfterCurrent: () => void;
  setFading: (isFading: boolean) => void;
  /** Ends the timed sleep only; a stop-after-this-track request stays armed. */
  clearTimer: () => void;
  /** Turns off everything: the timer, a running fade and stop-after-this-track. */
  cancelAll: () => void;
  /** Disarms stop-after-this-track and reports whether it was armed. */
  consumeStopAfterCurrent: () => boolean;
};

export type SleepTimerStore = SleepTimerState & SleepTimerActions;

const initialState: SleepTimerState = {
  endsAt: null,
  minutes: null,
  isFading: false,
  stopAfterCurrent: false,
};

export const useSleepTimerStore = create<SleepTimerStore>()((set, get) => ({
  ...initialState,

  startTimer: (minutes) =>
    set({ endsAt: sleepTimerEndsAt(Date.now(), minutes), minutes, isFading: false }),
  sleepAtEndOfTrack: () =>
    set({ endsAt: null, minutes: null, isFading: false, stopAfterCurrent: true }),
  setStopAfterCurrent: (stopAfterCurrent) => set({ stopAfterCurrent }),
  toggleStopAfterCurrent: () => set((state) => ({ stopAfterCurrent: !state.stopAfterCurrent })),
  setFading: (isFading) => set({ isFading }),
  clearTimer: () => set({ endsAt: null, minutes: null, isFading: false }),
  cancelAll: () => set(initialState),
  consumeStopAfterCurrent: () => {
    if (!get().stopAfterCurrent) return false;
    set({ stopAfterCurrent: false });
    return true;
  },
}));

export const selectSleepTimerActive = (state: SleepTimerState): boolean =>
  state.endsAt !== null || state.stopAfterCurrent;
