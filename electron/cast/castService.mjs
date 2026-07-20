import fs from "node:fs";
import { createCastClientAdapter } from "./castClientAdapter.mjs";
import { createCastDiscovery } from "./castDiscovery.mjs";
import { createCastMediaServer } from "./castMediaServer.mjs";
import {
  CAST_ERROR_CODES,
  castContentTypeFor,
  createCastError,
  isFinishedTransition,
  normalizeMediaStatus,
  sessionStateForMediaStatus,
  toCastErrorPayload,
} from "./castState.mjs";

const STATUS_POLL_INTERVAL_MS = 1_000;

const IDLE_MEDIA_STATUS = {
  mediaSessionId: null,
  playerState: "idle",
  idleReason: null,
  position: 0,
  duration: null,
  contentId: null,
};

// Owns discovery, the receiver session, and the LAN media server, and maps
// everything onto the muro:invoke command surface. All dependencies are
// injectable so the service is testable without a physical device.
export const createCastService = ({
  emit,
  discoveryFactory = createCastDiscovery,
  adapterFactory = createCastClientAdapter,
  mediaServerFactory = createCastMediaServer,
} = {}) => {
  const mediaServer = mediaServerFactory();
  let discovery = null;
  let sender = null;
  let session = null;
  let sessionState = "idle";
  let lastError = null;

  const emitEvent = (name, payload) => {
    if (!sender || sender.isDestroyed?.()) return;
    try {
      emit?.(sender, name, payload);
    } catch {
      // A closing window must not take the cast session down with it.
    }
  };

  const discoverySnapshot = () =>
    discovery?.getDevices() ?? { devices: [], scanning: false, error: null };

  const publicState = () => ({
    state: sessionState,
    deviceId: session?.deviceId ?? null,
    deviceName: session?.deviceName ?? null,
    media: session?.lastStatus ?? null,
    track: session?.loadedTrack ?? null,
    lastError,
  });

  const setState = (nextState, errorPayload = null) => {
    sessionState = nextState;
    lastError = errorPayload;
    emitEvent("muro://cast-state", publicState());
  };

  const ensureDiscovery = () => {
    if (discovery) return discovery;
    discovery = discoveryFactory({
      onUpdate: (snapshot) => emitEvent("muro://cast-devices", snapshot),
    });
    return discovery;
  };

  const requireSession = () => {
    if (!session) {
      throw createCastError(CAST_ERROR_CODES.sessionEnded, "No active cast session");
    }
    return session;
  };

  const stopStatusPolling = () => {
    if (session?.statusTimer) clearInterval(session.statusTimer);
    if (session) session.statusTimer = null;
  };

  const cleanupSession = () => {
    stopStatusPolling();
    for (const unsubscribe of session?.unsubscribes ?? []) unsubscribe();
    session = null;
    mediaServer.endSession();
  };

  const handleMediaStatus = (rawStatus) => {
    if (!session) return;
    const previous = session.lastStatus;
    const next = normalizeMediaStatus(rawStatus) ?? IDLE_MEDIA_STATUS;
    const finished = isFinishedTransition(previous, next);
    session.lastStatus = next;
    if (!["connecting", "loading", "disconnecting", "error"].includes(sessionState)) {
      const derived = sessionStateForMediaStatus(next);
      if (derived !== sessionState) setState(derived);
    } else if (sessionState === "loading" && next.playerState !== "idle") {
      setState(sessionStateForMediaStatus(next));
    }
    emitEvent("muro://cast-media-status", { status: next, finished });
  };

  const handleSessionLost = (error) => {
    if (!session || sessionState === "disconnecting") return;
    session.adapter.close();
    cleanupSession();
    setState("error", {
      code: CAST_ERROR_CODES.sessionEnded,
      message: error instanceof Error && error.message
        ? error.message
        : "The cast session ended unexpectedly",
    });
  };

  const startStatusPolling = () => {
    stopStatusPolling();
    const activeSession = session;
    activeSession.statusTimer = setInterval(() => {
      if (!activeSession.adapter.hasMediaSession()) return;
      activeSession.adapter.getMediaStatus().catch(() => {
        // Poll failures are transient; a dead session surfaces via "close".
      });
    }, STATUS_POLL_INTERVAL_MS);
  };

  const doDisconnect = async ({ stopReceiver = true } = {}) => {
    if (!session) return { lastPositionSecs: null, trackId: null };
    setState("disconnecting");
    const lastPositionSecs = session.lastStatus?.position ?? null;
    const trackId = session.loadedTrack?.trackId ?? null;
    const { adapter } = session;
    stopStatusPolling();
    if (stopReceiver) await adapter.stopReceiverApp();
    adapter.close();
    cleanupSession();
    setState("idle");
    return { lastPositionSecs, trackId };
  };

  // ipcRenderer.invoke only preserves an error's message, so the stable code
  // is prefixed onto it for the renderer to parse back out.
  const withStableErrors = (handlers) =>
    Object.fromEntries(
      Object.entries(handlers).map(([name, handler]) => [
        name,
        async (args, invokeSender) => {
          try {
            return await handler(args, invokeSender);
          } catch (error) {
            const payload = toCastErrorPayload(error);
            throw createCastError(payload.code, `${payload.code}: ${payload.message}`);
          }
        },
      ]),
    );

  const commands = {
    async cast_start_discovery(_args, invokeSender) {
      sender = invokeSender ?? sender;
      return ensureDiscovery().start();
    },

    cast_stop_discovery() {
      discovery?.stop();
      return discoverySnapshot();
    },

    cast_get_devices() {
      return discoverySnapshot();
    },

    async cast_connect({ deviceId }, invokeSender) {
      sender = invokeSender ?? sender;
      const device = discoverySnapshot().devices.find((entry) => entry.id === deviceId);
      if (!device) {
        throw createCastError(
          CAST_ERROR_CODES.deviceNotFound,
          "The selected cast device is no longer visible on this network",
        );
      }
      if (session) await doDisconnect();

      setState("connecting");
      const adapter = adapterFactory();
      try {
        await adapter.connect({ host: device.host, port: device.port });
        await adapter.launchDefaultReceiver();
        await mediaServer.start();
        mediaServer.beginSession();
      } catch (error) {
        adapter.close();
        const payload = {
          code: error?.code === CAST_ERROR_CODES.connectTimeout
            ? CAST_ERROR_CODES.connectTimeout
            : CAST_ERROR_CODES.connectFailed,
          message: error instanceof Error ? error.message : String(error),
        };
        setState("error", payload);
        throw createCastError(payload.code, payload.message);
      }

      session = {
        deviceId: device.id,
        deviceName: device.name,
        host: device.host,
        adapter,
        lastStatus: null,
        loadedTrack: null,
        statusTimer: null,
        unsubscribes: [
          adapter.on("mediaStatus", handleMediaStatus),
          adapter.on("close", () => handleSessionLost()),
          adapter.on("error", (error) => handleSessionLost(error)),
        ],
      };
      startStatusPolling();
      setState("connected");
      return publicState();
    },

    async cast_disconnect() {
      return doDisconnect();
    },

    async cast_load_track({
      trackId,
      sourcePath,
      title,
      artist,
      album,
      durationSeconds,
      coverArtPath,
      startPositionSecs,
      autoplay,
    }) {
      const activeSession = requireSession();

      const contentType = castContentTypeFor(sourcePath);
      if (!contentType) {
        throw createCastError(
          CAST_ERROR_CODES.unsupportedFormat,
          "This format cannot be cast yet",
        );
      }
      try {
        const stats = await fs.promises.stat(String(sourcePath));
        if (!stats.isFile()) throw new Error("not a file");
      } catch {
        throw createCastError(
          CAST_ERROR_CODES.loadFailed,
          "The track file is missing or unreadable",
        );
      }

      mediaServer.revokeAuthorizations();
      const trackAuthorization = mediaServer.authorizeFile(String(sourcePath), "media");
      const trackUrl = mediaServer.urlFor(trackAuthorization.path, { preferHost: activeSession.host });
      if (!trackUrl) {
        throw createCastError(
          CAST_ERROR_CODES.mediaServerUnreachable,
          "No local network address is reachable by the cast device",
        );
      }
      let imageUrl = null;
      if (coverArtPath && fs.existsSync(String(coverArtPath))) {
        const artworkAuthorization = mediaServer.authorizeFile(String(coverArtPath), "artwork");
        imageUrl = mediaServer.urlFor(artworkAuthorization.path, { preferHost: activeSession.host });
      }

      setState("loading");
      try {
        const status = await activeSession.adapter.loadMedia({
          contentId: trackUrl,
          contentType,
          title,
          artist,
          album,
          imageUrl,
          duration: durationSeconds,
          currentTime: Math.max(0, Number(startPositionSecs) || 0),
          autoplay: autoplay !== false,
        });
        activeSession.loadedTrack = {
          trackId: trackId ?? null,
          title: title ?? "",
          artist: artist ?? "",
          album: album ?? "",
          durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        };
        handleMediaStatus(status);
        return publicState();
      } catch (error) {
        if (session === activeSession) {
          setState("connected", toCastErrorPayload(
            error?.code ? error : createCastError(CAST_ERROR_CODES.loadFailed, String(error?.message ?? error)),
          ));
        }
        throw error?.code
          ? error
          : createCastError(CAST_ERROR_CODES.loadFailed, String(error?.message ?? error));
      }
    },

    async cast_play() {
      const status = await requireSession().adapter.play();
      handleMediaStatus(status);
      return publicState();
    },

    async cast_pause() {
      const status = await requireSession().adapter.pause();
      handleMediaStatus(status);
      return publicState();
    },

    async cast_seek({ positionSecs }) {
      const status = await requireSession().adapter.seek(positionSecs);
      handleMediaStatus(status);
      return publicState();
    },

    async cast_set_volume({ volume }) {
      await requireSession().adapter.setVolume(volume);
      return publicState();
    },

    cast_get_state() {
      return { ...publicState(), discovery: discoverySnapshot() };
    },
  };

  return {
    commands: withStableErrors(commands),
    close: () => {
      stopStatusPolling();
      if (session) {
        void session.adapter.stopReceiverApp();
        session.adapter.close();
        cleanupSession();
      }
      sessionState = "idle";
      discovery?.stop();
      void mediaServer.stop();
    },
  };
};
