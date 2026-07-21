import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCastClientAdapter } from "../electron/cast/castClientAdapter.mjs";

// A stand-in for a CastV2 connection so the adapter can be exercised without a
// real device. Records outbound requests and lets a test drive lifecycle
// events (message/close/error).
const makeFakeConnection = ({ openBehavior } = {}) => {
  const emitter = new EventEmitter();
  const requests = [];
  const responders = new Map();
  return {
    emitter,
    requests,
    respondWith: (type, factory) => responders.set(type, factory),
    handle: {
      open: () => (openBehavior ? openBehavior(emitter) : Promise.resolve()),
      request: (namespace, payload) => {
        requests.push({ namespace, ...payload });
        const responder = responders.get(payload.type);
        return Promise.resolve(responder ? responder(payload) : {});
      },
      send: () => {},
      on: (event, listener) => {
        emitter.on(event, listener);
        return () => emitter.off(event, listener);
      },
      close: () => emitter.emit("close"),
      isOpen: () => true,
    },
  };
};

// --- Blocker #1: a connection error during connect must not throw on a
// listener-less emitter (which would become an uncaughtException and crash the
// Electron main process). It must surface as a rejected connect() instead.
{
  const fake = makeFakeConnection({
    openBehavior: (emitter) => {
      // Mirror castProtocol.teardown(error): emit "error" on the connection
      // (which the adapter forwards) before rejecting open(). No consumer has
      // attached an adapter-level "error" listener yet at this point.
      const failure = new Error("ECONNREFUSED");
      emitter.emit("error", failure);
      return Promise.reject(failure);
    },
  });
  const adapter = createCastClientAdapter({ connectionFactory: () => fake.handle });
  await assert.rejects(
    () => adapter.connect({ host: "192.0.2.1", port: 8009 }),
    /ECONNREFUSED/,
    "connect() to an unreachable device should reject, not crash",
  );
  // Reaching here at all proves no uncaughtException tore the process down.
  adapter.close();
}

// A connection error mid-session (after the service subscribed) still reaches
// the service's handler.
{
  const fake = makeFakeConnection();
  const adapter = createCastClientAdapter({ connectionFactory: () => fake.handle });
  await adapter.connect({ host: "192.0.2.2", port: 8009 });
  let received = null;
  adapter.on("error", (error) => { received = error; });
  fake.emitter.emit("error", new Error("mid-session drop"));
  assert.equal(received?.message, "mid-session drop");
  adapter.close();
}

// --- #7: SEEK must not force a paused receiver to resume, i.e. it must omit
// resumeState so the receiver preserves its current play/pause state.
{
  const fake = makeFakeConnection();
  fake.respondWith("LAUNCH", () => ({
    type: "RECEIVER_STATUS",
    status: { applications: [{ appId: "CC1AD845", transportId: "transport-1", sessionId: "s1" }] },
  }));
  fake.respondWith("LOAD", () => ({ status: [{ mediaSessionId: 42, playerState: "PAUSED" }] }));
  fake.respondWith("SEEK", () => ({ status: [{ mediaSessionId: 42, playerState: "PAUSED", currentTime: 30 }] }));

  const adapter = createCastClientAdapter({ connectionFactory: () => fake.handle });
  await adapter.connect({ host: "192.0.2.3", port: 8009 });
  await adapter.launchDefaultReceiver();
  await adapter.loadMedia({ contentId: "http://x/y", contentType: "audio/mpeg", autoplay: false });
  await adapter.seek(30);

  const seekRequest = fake.requests.find((request) => request.type === "SEEK");
  assert.ok(seekRequest, "a SEEK request should have been sent");
  assert.equal(seekRequest.currentTime, 30);
  assert.equal("resumeState" in seekRequest, false, "SEEK must omit resumeState to preserve pause");
  adapter.close();
}

console.log("Cast adapter smoke test passed.");
