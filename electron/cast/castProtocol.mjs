import tls from "node:tls";
import { EventEmitter } from "node:events";

// CastV2 wire protocol: 4-byte big-endian length prefix followed by one
// serialized CastMessage protobuf. The message schema is small and frozen
// (cast_channel.proto), so it is encoded by hand instead of pulling in an
// unmaintained protocol dependency.
//
// CastMessage fields:
//   1 protocol_version (varint, 0 = CASTV2_1_0)
//   2 source_id        (string)
//   3 destination_id   (string)
//   4 namespace        (string)
//   5 payload_type     (varint, 0 = STRING, 1 = BINARY)
//   6 payload_utf8     (string)
//   7 payload_binary   (bytes)

const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;
export const MAX_CAST_FRAME_BYTES = 1024 * 1024;

const encodeVarint = (value) => {
  const bytes = [];
  let remaining = value >>> 0;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
};

const encodeTag = (fieldNumber, wireType) => encodeVarint((fieldNumber << 3) | wireType);

const encodeStringField = (fieldNumber, value) => {
  const encoded = Buffer.from(String(value), "utf8");
  return Buffer.concat([
    encodeTag(fieldNumber, WIRE_LENGTH_DELIMITED),
    encodeVarint(encoded.length),
    encoded,
  ]);
};

const encodeVarintField = (fieldNumber, value) =>
  Buffer.concat([encodeTag(fieldNumber, WIRE_VARINT), encodeVarint(value)]);

export const encodeCastMessage = ({ sourceId, destinationId, namespace, payloadUtf8 }) =>
  Buffer.concat([
    encodeVarintField(1, 0),
    encodeStringField(2, sourceId),
    encodeStringField(3, destinationId),
    encodeStringField(4, namespace),
    encodeVarintField(5, 0),
    encodeStringField(6, payloadUtf8),
  ]);

const decodeVarint = (buffer, offset) => {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (;;) {
    if (cursor >= buffer.length) throw new Error("Truncated varint in cast message");
    const byte = buffer[cursor];
    cursor += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
    if (shift > 35) throw new Error("Varint too long in cast message");
  }
};

export const decodeCastMessage = (buffer) => {
  const message = {
    protocolVersion: 0,
    sourceId: "",
    destinationId: "",
    namespace: "",
    payloadType: 0,
    payloadUtf8: "",
  };
  let offset = 0;
  while (offset < buffer.length) {
    const tag = decodeVarint(buffer, offset);
    offset = tag.next;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (wireType === WIRE_VARINT) {
      const field = decodeVarint(buffer, offset);
      offset = field.next;
      if (fieldNumber === 1) message.protocolVersion = field.value;
      if (fieldNumber === 5) message.payloadType = field.value;
    } else if (wireType === WIRE_LENGTH_DELIMITED) {
      const length = decodeVarint(buffer, offset);
      offset = length.next;
      if (offset + length.value > buffer.length) {
        throw new Error("Truncated field in cast message");
      }
      const slice = buffer.subarray(offset, offset + length.value);
      offset += length.value;
      if (fieldNumber === 2) message.sourceId = slice.toString("utf8");
      if (fieldNumber === 3) message.destinationId = slice.toString("utf8");
      if (fieldNumber === 4) message.namespace = slice.toString("utf8");
      if (fieldNumber === 6) message.payloadUtf8 = slice.toString("utf8");
    } else {
      throw new Error(`Unsupported wire type ${wireType} in cast message`);
    }
  }
  return message;
};

export const frameCastMessage = (encodedMessage) => {
  const frame = Buffer.alloc(4 + encodedMessage.length);
  frame.writeUInt32BE(encodedMessage.length, 0);
  encodedMessage.copy(frame, 4);
  return frame;
};

// Incremental de-framer: feed arbitrary chunks, get complete message buffers.
export const createFrameReader = (onMessage) => {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const messageLength = pending.readUInt32BE(0);
      if (messageLength > MAX_CAST_FRAME_BYTES) {
        throw new Error("Cast message frame exceeds sane size");
      }
      if (pending.length < 4 + messageLength) return;
      const message = pending.subarray(4, 4 + messageLength);
      pending = pending.subarray(4 + messageLength);
      onMessage(message);
    }
  };
};

export const NAMESPACES = {
  connection: "urn:x-cast:com.google.cast.tp.connection",
  heartbeat: "urn:x-cast:com.google.cast.tp.heartbeat",
  receiver: "urn:x-cast:com.google.cast.receiver",
  media: "urn:x-cast:com.google.cast.media",
};

export const PLATFORM_RECEIVER_ID = "receiver-0";
const SENDER_ID = "sender-0";
const HEARTBEAT_INTERVAL_MS = 5_000;
// If nothing at all arrives from the device for this long the connection is
// considered dead. A healthy receiver answers each 5 s PING with a PONG, so
// three silent intervals means the peer (or the network path) is gone. Without
// this, a black-holed connection (device power loss, Wi-Fi drop) is detected
// only when the OS abandons TCP retransmission — up to ~15 min on Linux.
const LIVENESS_TIMEOUT_MS = 3 * HEARTBEAT_INTERVAL_MS;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// A single authenticated TLS channel to one Cast device. Handles framing,
// JSON payloads, heartbeat, virtual connections, and request/response
// correlation by requestId. Emits: "message", "close", "error".
export const createCastConnection = ({
  host,
  port = 8009,
  connectTimeoutMs = 8_000,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}) => {
  const emitter = new EventEmitter();
  const pendingRequests = new Map();
  const connectedTransports = new Set();
  let socket = null;
  let heartbeatTimer = null;
  let nextRequestId = 1;
  let closed = false;
  let lastInboundAt = 0;

  const teardown = (error) => {
    if (closed) return;
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error ?? new Error("Cast connection closed"));
    }
    pendingRequests.clear();
    socket?.destroy();
    if (error) emitter.emit("error", error);
    emitter.emit("close");
  };

  const sendRaw = (namespace, payload, destinationId) => {
    if (closed || !socket) throw new Error("Cast connection is not open");
    const encoded = encodeCastMessage({
      sourceId: SENDER_ID,
      destinationId,
      namespace,
      payloadUtf8: JSON.stringify(payload),
    });
    socket.write(frameCastMessage(encoded));
  };

  const ensureTransport = (destinationId) => {
    if (destinationId === PLATFORM_RECEIVER_ID) return;
    if (connectedTransports.has(destinationId)) return;
    sendRaw(NAMESPACES.connection, { type: "CONNECT" }, destinationId);
    connectedTransports.add(destinationId);
  };

  const handleMessage = (rawMessage) => {
    let message;
    try {
      message = decodeCastMessage(rawMessage);
    } catch (error) {
      emitter.emit("error", error);
      return;
    }
    if (message.payloadType !== 0) return;
    let payload;
    try {
      payload = JSON.parse(message.payloadUtf8);
    } catch {
      return;
    }
    if (message.namespace === NAMESPACES.heartbeat) {
      if (payload.type === "PING") {
        sendRaw(NAMESPACES.heartbeat, { type: "PONG" }, PLATFORM_RECEIVER_ID);
      }
      return;
    }
    if (message.namespace === NAMESPACES.connection && payload.type === "CLOSE") {
      connectedTransports.delete(message.sourceId);
      emitter.emit("message", { namespace: message.namespace, sourceId: message.sourceId, payload });
      return;
    }
    const requestId = payload.requestId;
    if (requestId && pendingRequests.has(requestId)) {
      const pending = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);
      clearTimeout(pending.timeout);
      pending.resolve(payload);
    }
    emitter.emit("message", { namespace: message.namespace, sourceId: message.sourceId, payload });
  };

  const open = () =>
    new Promise((resolve, reject) => {
      const connectTimer = setTimeout(() => {
        const timeoutError = new Error(`Timed out connecting to cast device at ${host}:${port}`);
        timeoutError.code = "CAST_CONNECT_TIMEOUT";
        socket?.destroy();
        reject(timeoutError);
      }, connectTimeoutMs);

      // Cast devices present self-signed device certificates; the channel is
      // authenticated at the protocol layer, not the CA layer.
      socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
        clearTimeout(connectTimer);
        lastInboundAt = Date.now();
        const readFrames = createFrameReader(handleMessage);
        socket.on("data", (chunk) => {
          lastInboundAt = Date.now();
          try {
            readFrames(chunk);
          } catch (error) {
            teardown(error);
          }
        });
        sendRaw(NAMESPACES.connection, { type: "CONNECT" }, PLATFORM_RECEIVER_ID);
        heartbeatTimer = setInterval(() => {
          // A black-holed peer still accepts writes into the kernel buffer, so
          // silence — not a write failure — is what reveals a dead device.
          if (Date.now() - lastInboundAt > LIVENESS_TIMEOUT_MS) {
            const deadError = new Error(`Cast device at ${host}:${port} stopped responding`);
            deadError.code = "CAST_CONNECT_TIMEOUT";
            teardown(deadError);
            return;
          }
          try {
            sendRaw(NAMESPACES.heartbeat, { type: "PING" }, PLATFORM_RECEIVER_ID);
          } catch {
            // Socket write failures surface through the error handler.
          }
        }, HEARTBEAT_INTERVAL_MS);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(connectTimer);
        if (closed) return;
        reject(error);
        teardown(error);
      });
      socket.once("close", () => teardown());
    });

  const request = (namespace, payload, destinationId) => {
    ensureTransport(destinationId);
    const requestId = nextRequestId;
    nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        const timeoutError = new Error(`Cast request ${payload.type} timed out`);
        timeoutError.code = "CAST_REQUEST_TIMEOUT";
        reject(timeoutError);
      }, requestTimeoutMs);
      pendingRequests.set(requestId, { resolve, reject, timeout });
      try {
        sendRaw(namespace, { ...payload, requestId }, destinationId);
      } catch (error) {
        pendingRequests.delete(requestId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  };

  return {
    open,
    request,
    send: (namespace, payload, destinationId) => {
      ensureTransport(destinationId);
      sendRaw(namespace, payload, destinationId);
    },
    on: (event, listener) => {
      emitter.on(event, listener);
      return () => emitter.off(event, listener);
    },
    close: () => {
      if (closed) return;
      try {
        for (const transportId of connectedTransports) {
          sendRaw(NAMESPACES.connection, { type: "CLOSE" }, transportId);
        }
        sendRaw(NAMESPACES.connection, { type: "CLOSE" }, PLATFORM_RECEIVER_ID);
      } catch {
        // Best effort: the socket may already be gone.
      }
      teardown();
    },
    isOpen: () => !closed && socket !== null,
  };
};
