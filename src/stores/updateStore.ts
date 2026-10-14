import { create } from "zustand";
import type { UpdateStatus } from "../utils/updates";

type UpdateState = {
  /** Latest status from the main process; null until the first report arrives. */
  status: UpdateStatus | null;
};

type UpdateActions = {
  setStatus: (status: UpdateStatus) => void;
};

export type UpdateStore = UpdateState & UpdateActions;

export const useUpdateStore = create<UpdateStore>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));
