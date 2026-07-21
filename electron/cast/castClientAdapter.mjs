import { EventEmitter } from "node:events";
import {
  createCastConnection,
  NAMESPACES,
  PLATFORM_RECEIVER_ID,
} from "./castProtocol.mjs";

const DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845";

// Session-level wrapper around the CastV2 channel. This is the only module
// allowed to import the protocol layer; everything above it talks in terms of
// connect / launch / loadMedia / transport controls, which keeps the protocol
// implementation swappable.
//
// Emits: "mediaStatus" (normalized-ready raw status object), "receiverStatus",
// "close", "error".
export const createCastClientAdapter = ({ connectionFactory = createCastConnection } = {}) => {
  const emitter = new EventEmitter();
  let connection = null;
  let transportId = null;
  let sessionId = null;
  let mediaSessionId = null;
  let closed = false;

  const requireConnection = () => {
    if (!connection || closed) throw new Error("Cast session is not connected");
    return connection;
  };

  const requireTransport = () => {
    requireConnection();
    if (!transportId) throw new Error("No receiver application is running");
    return transportId;
  };

  const handleMessage = ({ namespace, sourceId, payload }) => {
    if (namespace === NAMESPACES.media && payload.type === "MEDIA_STATUS") {
      const status = Array.isArray(payload.status) ? payload.status[0] : null;
      if (status?.mediaSessionId != null) mediaSessionId = status.mediaSessionId;
      emitter.emit("mediaStatus", status ?? null);
      return;
    }
    if (namespace === NAMESPACES.receiver && payload.type === "RECEIVER_STATUS") {
      emitter.emit("receiverStatus", payload.status ?? null);
      return;
    }
    if (namespace === NAMESPACES.connection && payload.type === "CLOSE" && sourceId === transportId) {
      // The receiver application went away underneath the session.
      transportId = null;
      mediaSessionId = null;
      emitter.emit("close");
    }
  };

  const connect = async ({ host, port }) => {
    connection = connectionFactory({ host, port });
    connection.on("message", handleMessage);
    connection.on("close", () => {
      if (!closed) emitter.emit("close");
    });
    // A connection error before the service has attached its own "error"
    // listener (i.e. still inside this connect/launch call) would, if
    // re-emitted on a listener-less emitter, throw ERR_UNHANDLED_ERROR and
    // crash the Electron main process. Such errors already surface through
    // the rejected open()/request promise, so only forward when someone is
    // actually listening.
    connection.on("error", (error) => {
      if (emitter.listenerCount("error") > 0) emitter.emit("error", error);
    });
    await connection.open();
  };

  const launchDefaultReceiver = async () => {
    const response = await requireConnection().request(
      NAMESPACES.receiver,
      { type: "LAUNCH", appId: DEFAULT_MEDIA_RECEIVER_APP_ID },
      PLATFORM_RECEIVER_ID,
    );
    if (response.type === "LAUNCH_ERROR") {
      throw new Error(`Receiver refused to launch: ${response.reason ?? "unknown reason"}`);
    }
    const applications = response.status?.applications ?? [];
    const application = applications.find((entry) => entry.appId === DEFAULT_MEDIA_RECEIVER_APP_ID)
      ?? applications[0];
    if (!application?.transportId) {
      throw new Error("Receiver did not report a media application transport");
    }
    transportId = application.transportId;
    sessionId = application.sessionId ?? null;
    return { transportId, sessionId };
  };

  const loadMedia = async ({
    contentId,
    contentType,
    title,
    artist,
    album,
    imageUrl,
    duration,
    currentTime = 0,
    autoplay = true,
  }) => {
    const response = await requireConnection().request(
      NAMESPACES.media,
      {
        type: "LOAD",
        autoplay,
        currentTime,
        media: {
          contentId,
          contentType,
          streamType: "BUFFERED",
          duration: Number.isFinite(duration) ? duration : undefined,
          metadata: {
            metadataType: 3, // MusicTrackMediaMetadata
            title: title ?? "",
            artist: artist ?? "",
            albumName: album ?? "",
            images: imageUrl ? [{ url: imageUrl }] : [],
          },
        },
      },
      requireTransport(),
    );
    if (response.type === "LOAD_FAILED" || response.type === "LOAD_CANCELLED" || response.type === "ERROR") {
      const failure = new Error(`Receiver could not load the track (${response.type})`);
      failure.code = "CAST_LOAD_FAILED";
      throw failure;
    }
    const status = Array.isArray(response.status) ? response.status[0] : null;
    if (status?.mediaSessionId != null) mediaSessionId = status.mediaSessionId;
    return status ?? null;
  };

  const mediaCommand = async (type, extra = {}) => {
    if (mediaSessionId == null) throw new Error("No media is loaded on the receiver");
    const response = await requireConnection().request(
      NAMESPACES.media,
      { type, mediaSessionId, ...extra },
      requireTransport(),
    );
    const status = Array.isArray(response.status) ? response.status[0] : null;
    return status ?? null;
  };

  return {
    connect,
    launchDefaultReceiver,
    loadMedia,
    play: () => mediaCommand("PLAY"),
    pause: () => mediaCommand("PAUSE"),
    // resumeState is intentionally omitted: PLAYBACK_START would force a
    // paused receiver to resume on every scrub. Omitting it preserves the
    // current play/pause state across the seek.
    seek: (positionSecs) => mediaCommand("SEEK", {
      currentTime: Math.max(0, Number(positionSecs) || 0),
    }),
    getMediaStatus: async () => {
      const response = await requireConnection().request(
        NAMESPACES.media,
        { type: "GET_STATUS" },
        requireTransport(),
      );
      const status = Array.isArray(response.status) ? response.status[0] : null;
      if (status?.mediaSessionId != null) mediaSessionId = status.mediaSessionId;
      return status ?? null;
    },
    setVolume: (level) => requireConnection().request(
      NAMESPACES.receiver,
      { type: "SET_VOLUME", volume: { level: Math.max(0, Math.min(1, Number(level) || 0)) } },
      PLATFORM_RECEIVER_ID,
    ),
    stopReceiverApp: async () => {
      if (!connection || closed || !sessionId) return;
      try {
        await connection.request(
          NAMESPACES.receiver,
          { type: "STOP", sessionId },
          PLATFORM_RECEIVER_ID,
        );
      } catch {
        // Stopping is best effort during teardown.
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      connection?.close();
      connection = null;
      transportId = null;
      sessionId = null;
      mediaSessionId = null;
    },
    hasMediaSession: () => mediaSessionId != null,
    on: (event, listener) => {
      emitter.on(event, listener);
      return () => emitter.off(event, listener);
    },
  };
};
