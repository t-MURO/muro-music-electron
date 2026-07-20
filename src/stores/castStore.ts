import { create } from "zustand";
import type {
  CastDevice,
  CastErrorPayload,
  CastLoadedTrack,
  CastMediaStatus,
  CastDiscoverySnapshot,
  CastSessionState,
  CastSessionStateName,
} from "../utils/castApi";

type CastState = {
  devices: CastDevice[];
  scanning: boolean;
  discoveryError: string | null;
  sessionState: CastSessionStateName;
  deviceId: string | null;
  deviceName: string | null;
  remoteMedia: CastMediaStatus | null;
  remoteTrack: CastLoadedTrack | null;
  lastError: CastErrorPayload | null;
};

type CastActions = {
  applyDiscovery: (snapshot: CastDiscoverySnapshot) => void;
  applySessionState: (payload: CastSessionState) => void;
  applyMediaStatus: (status: CastMediaStatus) => void;
  reset: () => void;
};

export type CastStore = CastState & CastActions;

const initialState: CastState = {
  devices: [],
  scanning: false,
  discoveryError: null,
  sessionState: "idle",
  deviceId: null,
  deviceName: null,
  remoteMedia: null,
  remoteTrack: null,
  lastError: null,
};

export const useCastStore = create<CastStore>()((set) => ({
  ...initialState,

  applyDiscovery: (snapshot) =>
    set({
      devices: snapshot.devices,
      scanning: snapshot.scanning,
      discoveryError: snapshot.error,
    }),

  applySessionState: (payload) =>
    set({
      sessionState: payload.state,
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
      remoteMedia: payload.media,
      remoteTrack: payload.track,
      lastError: payload.lastError,
    }),

  applyMediaStatus: (status) => set({ remoteMedia: status }),

  reset: () => set(initialState),
}));

// The cast output owns playback commands whenever a session is being set up,
// active, or winding down. "idle" and "error" mean the local output owns them.
export const selectCastOutputActive = (state: Pick<CastStore, "sessionState">): boolean =>
  state.sessionState !== "idle" && state.sessionState !== "error";

export const isCastOutputActive = (): boolean =>
  selectCastOutputActive(useCastStore.getState());
