import fs from "node:fs";
import { buildDidlMetadata, createDlnaClient } from "./dlnaClient.mjs";
import { createDlnaDiscovery } from "./dlnaDiscovery.mjs";
import { createLanMediaServer } from "../lanMediaServer.mjs";
import {
  DLNA_ERROR_CODES,
  createDlnaError,
  dlnaContentTypeFor,
  dlnaSessionStateForStatus,
  isDlnaFinishedTransition,
  normalizeTransportStatus,
  toDlnaErrorPayload,
} from "./dlnaState.mjs";

const STATUS_POLL_INTERVAL_MS = 1_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

// DLNA/UPnP session service exposing dlna_* commands, structured exactly like
// electron/cast/castService.mjs: one session, a normalized state machine,
// events over muro://dlna-*, and injectable dependencies for tests.
export const createDlnaService = ({
  emit,
  discoveryFactory = createDlnaDiscovery,
  clientFactory = createDlnaClient,
  mediaServerFactory = createLanMediaServer,
} = {}) => {
  const mediaServer = mediaServerFactory();
  let discovery = null;
  let sender = null;
  let session = null;
  let sessionState = "idle";
  let lastError = null;

  // Connect, disconnect, and load each mutate the session across several SOAP
  // round-trips. Serializing them keeps concurrent IPC invocations from
  // interleaving — e.g. a disconnect landing mid-load, or two loads racing on
  // the shared media server. (A poll-failure teardown is not on this chain, so
  // load's success path still re-checks the session below.)
  let sessionOpChain = Promise.resolve();
  const runSessionOp = (operation) => {
    const result = sessionOpChain.then(operation, operation);
    sessionOpChain = result.then(() => undefined, () => undefined);
    return result;
  };

  const emitEvent = (name, payload) => {
    if (!sender || sender.isDestroyed?.()) return;
    try {
      emit?.(sender, name, payload);
    } catch {
      // A closing window must not take the session down with it.
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
    emitEvent("muro://dlna-state", publicState());
  };

  const ensureDiscovery = () => {
    if (discovery) return discovery;
    discovery = discoveryFactory({
      onUpdate: (snapshot) => emitEvent("muro://dlna-devices", snapshot),
    });
    return discovery;
  };

  const requireSession = () => {
    if (!session) {
      throw createDlnaError(DLNA_ERROR_CODES.sessionEnded, "No active playback session");
    }
    return session;
  };

  const stopStatusPolling = () => {
    if (session?.statusTimer) clearInterval(session.statusTimer);
    if (session) session.statusTimer = null;
  };

  const cleanupSession = () => {
    stopStatusPolling();
    session = null;
    mediaServer.endSession();
  };

  const handleStatus = (nextStatus) => {
    if (!session) return;
    const previous = session.lastStatus;
    // While loading, the renderer legitimately passes through STOPPED between
    // SetAVTransportURI and Play, and the synthetic post-load status is pushed
    // here too. Neither is a real end-of-track, so never advance the queue
    // from a sample taken during a load.
    const finished = sessionState === "loading" || session.suppressFinished
      ? false
      : isDlnaFinishedTransition(previous, nextStatus);
    session.lastStatus = nextStatus;
    if (!["connecting", "loading", "disconnecting", "error"].includes(sessionState)) {
      const derived = dlnaSessionStateForStatus(nextStatus);
      if (derived !== sessionState) setState(derived);
    } else if (sessionState === "loading" && nextStatus.playerState !== "idle") {
      setState(dlnaSessionStateForStatus(nextStatus));
    }
    emitEvent("muro://dlna-media-status", { status: nextStatus, finished });
  };

  const handleSessionLost = (error) => {
    if (!session || sessionState === "disconnecting") return;
    cleanupSession();
    setState("error", {
      code: DLNA_ERROR_CODES.sessionEnded,
      message: error instanceof Error && error.message
        ? error.message
        : "The device stopped responding",
    });
  };

  const pollStatusOnce = async () => {
    const activeSession = session;
    if (!activeSession) return;
    // Each poll is two sequential SOAP round-trips; a slow renderer can make
    // one outlast the 1 s tick. Without this guard, overlapping polls can
    // complete out of order and re-apply a stale sample — which can re-arm and
    // double-fire the finished transition, skipping a queued track.
    if (activeSession.polling) return;
    activeSession.polling = true;
    try {
      const position = await activeSession.client.getPositionInfo();
      const transport = await activeSession.client.getTransportInfo();
      if (session !== activeSession) return;
      activeSession.pollFailures = 0;
      // Busy renderers answer with an empty transport state while probing a
      // stream (observed on the Denon AVR-S760H); skip the transient sample.
      if (!transport.transportState) return;
      handleStatus(normalizeTransportStatus({
        transportState: transport.transportState,
        positionSecs: position.positionSecs,
        durationSecs: position.durationSecs ?? activeSession.loadedTrack?.durationSeconds,
      }));
    } catch (error) {
      if (session !== activeSession) return;
      activeSession.pollFailures = (activeSession.pollFailures ?? 0) + 1;
      if (activeSession.pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        handleSessionLost(error);
      }
    } finally {
      activeSession.polling = false;
    }
  };

  const startStatusPolling = () => {
    stopStatusPolling();
    session.statusTimer = setInterval(() => void pollStatusOnce(), STATUS_POLL_INTERVAL_MS);
  };

  const doDisconnect = async () => {
    if (!session) return { lastPositionSecs: null, trackId: null };
    setState("disconnecting");
    const lastPositionSecs = session.lastStatus?.position ?? null;
    const trackId = session.loadedTrack?.trackId ?? null;
    const { client } = session;
    stopStatusPolling();
    try {
      await client.stop();
    } catch {
      // Stopping the renderer is best effort during teardown.
    }
    cleanupSession();
    setState("idle");
    return { lastPositionSecs, trackId };
  };

  const withStableErrors = (handlers) =>
    Object.fromEntries(
      Object.entries(handlers).map(([name, handler]) => [
        name,
        async (args, invokeSender) => {
          try {
            return await handler(args, invokeSender);
          } catch (error) {
            const payload = toDlnaErrorPayload(error);
            throw createDlnaError(payload.code, `${payload.code}: ${payload.message}`);
          }
        },
      ]),
    );

  const commands = {
    async dlna_start_discovery(_args, invokeSender) {
      sender = invokeSender ?? sender;
      return ensureDiscovery().start();
    },

    dlna_stop_discovery() {
      discovery?.stop();
      return discoverySnapshot();
    },

    dlna_get_devices() {
      return discoverySnapshot();
    },

    dlna_connect({ deviceId }, invokeSender) {
      sender = invokeSender ?? sender;
      return runSessionOp(async () => {
        const record = ensureDiscovery().getDeviceRecord(deviceId);
        if (!record) {
          throw createDlnaError(
            DLNA_ERROR_CODES.deviceNotFound,
            "The selected device is no longer visible on this network",
          );
        }
        if (session) await doDisconnect();

        setState("connecting");
        const client = clientFactory({
          avTransportUrl: record.avTransportUrl,
          renderingControlUrl: record.renderingControlUrl,
        });
        try {
          await client.getTransportInfo(); // proves the control endpoint answers
          await mediaServer.start();
          mediaServer.beginSession();
        } catch (error) {
          const payload = {
            code: DLNA_ERROR_CODES.connectFailed,
            message: error instanceof Error ? error.message : String(error),
          };
          setState("error", payload);
          throw createDlnaError(payload.code, payload.message);
        }

        session = {
          deviceId: record.id,
          deviceName: record.name,
          host: record.host,
          client,
          lastStatus: null,
          loadedTrack: null,
          statusTimer: null,
          pollFailures: 0,
          suppressFinished: false,
        };
        startStatusPolling();
        setState("connected");
        return publicState();
      });
    },

    dlna_disconnect() {
      return runSessionOp(() => doDisconnect());
    },

    dlna_load_track({
      trackId,
      sourcePath,
      title,
      artist,
      album,
      durationSeconds,
      coverArtPath,
      startPositionSecs,
    }) {
      return runSessionOp(async () => {
      const activeSession = requireSession();

      const contentType = dlnaContentTypeFor(sourcePath);
      if (!contentType) {
        throw createDlnaError(
          DLNA_ERROR_CODES.unsupportedFormat,
          "This format cannot be played on this device yet",
        );
      }
      try {
        const stats = await fs.promises.stat(String(sourcePath));
        if (!stats.isFile()) throw new Error("not a file");
      } catch {
        throw createDlnaError(
          DLNA_ERROR_CODES.loadFailed,
          "The track file is missing or unreadable",
        );
      }

      mediaServer.revokeAuthorizations();
      const trackAuthorization = mediaServer.authorizeFile(String(sourcePath), "media");
      const trackUrl = mediaServer.urlFor(trackAuthorization.path, { preferHost: activeSession.host });
      if (!trackUrl) {
        throw createDlnaError(
          DLNA_ERROR_CODES.mediaServerUnreachable,
          "No local network address is reachable by the device",
        );
      }
      let artUrl = null;
      if (coverArtPath && fs.existsSync(String(coverArtPath))) {
        const artworkAuthorization = mediaServer.authorizeFile(String(coverArtPath), "artwork");
        artUrl = mediaServer.urlFor(artworkAuthorization.path, { preferHost: activeSession.host });
      }

      setState("loading");
      try {
        await activeSession.client.setUri({
          url: trackUrl,
          metadata: buildDidlMetadata({
            url: trackUrl,
            contentType,
            title,
            artist,
            album,
            artUrl,
            durationSeconds,
          }),
        });
        // Play issued before the renderer registers the URI silently drops
        // back to STOPPED (observed on the Denon AVR-S760H) — wait for the
        // media to be registered first.
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const mediaInfo = await activeSession.client.getMediaInfo().catch(() => null);
          if (mediaInfo?.currentUri) break;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        await activeSession.client.play();
        const startAt = Math.max(0, Number(startPositionSecs) || 0);
        if (startAt > 0) {
          await activeSession.client.seek(startAt).catch(() => {
            // Some renderers reject seeks while still transitioning; the
            // track then simply starts from the beginning.
          });
        }
        if (session !== activeSession) {
          // A concurrent teardown (poll-failure or a superseding op) ended
          // this session while the SOAP calls were in flight. Do not resurrect
          // it with a "playing" state that has no device behind it.
          throw createDlnaError(
            DLNA_ERROR_CODES.sessionEnded,
            "The playback session ended during load",
          );
        }
        activeSession.loadedTrack = {
          trackId: trackId ?? null,
          title: title ?? "",
          artist: artist ?? "",
          album: album ?? "",
          durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        };
        handleStatus(normalizeTransportStatus({
          transportState: "TRANSITIONING",
          positionSecs: startAt,
          durationSecs: durationSeconds,
        }));
        setState("playing");
        return publicState();
      } catch (error) {
        if (session === activeSession) {
          setState("connected", toDlnaErrorPayload(
            error?.code ? error : createDlnaError(DLNA_ERROR_CODES.loadFailed, String(error?.message ?? error)),
          ));
        }
        throw error?.code
          ? error
          : createDlnaError(DLNA_ERROR_CODES.loadFailed, String(error?.message ?? error));
      }
      });
    },

    dlna_play() {
      return runSessionOp(async () => {
        const activeSession = requireSession();
        activeSession.suppressFinished = true;
        try {
          await activeSession.client.play();
          await pollStatusOnce();
          return publicState();
        } finally {
          activeSession.suppressFinished = false;
        }
      });
    },

    dlna_pause() {
      return runSessionOp(async () => {
        const activeSession = requireSession();
        activeSession.suppressFinished = true;
        try {
          await activeSession.client.pause();
          await pollStatusOnce();
          return publicState();
        } finally {
          activeSession.suppressFinished = false;
        }
      });
    },

    dlna_seek({ positionSecs }) {
      return runSessionOp(async () => {
        const activeSession = requireSession();
        activeSession.suppressFinished = true;
        try {
          await activeSession.client.seek(positionSecs);
          await pollStatusOnce();
          return publicState();
        } finally {
          activeSession.suppressFinished = false;
        }
      });
    },

    async dlna_set_volume({ volume }) {
      const activeSession = requireSession();
      if (activeSession.client.hasVolumeControl()) {
        await activeSession.client.setVolume(volume);
      }
      return publicState();
    },

    dlna_get_state() {
      return { ...publicState(), discovery: discoverySnapshot() };
    },
  };

  return {
    commands: withStableErrors(commands),
    close: () => {
      stopStatusPolling();
      if (session) {
        void session.client.stop().catch(() => undefined);
        cleanupSession();
      }
      sessionState = "idle";
      discovery?.stop();
      void mediaServer.stop();
    },
  };
};
