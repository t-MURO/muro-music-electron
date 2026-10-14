import { create } from "zustand";
import type { ScrobbleStatus } from "../utils/scrobblingApi";

type ScrobbleState = {
  /** Latest status from the main process; null until the first report arrives. */
  status: ScrobbleStatus | null;
};

type ScrobbleActions = {
  setStatus: (status: ScrobbleStatus) => void;
};

export type ScrobbleStore = ScrobbleState & ScrobbleActions;

export const useScrobbleStore = create<ScrobbleStore>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));
