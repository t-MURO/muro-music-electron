import assert from "node:assert/strict";
import { KeyFinderClient } from "@neo-keyfinder/engine-client";

// Fake engines are plain Node scripts, so this runs without the native binary.
const fakeEngine = (source) =>
  new KeyFinderClient({
    executablePath: process.execPath,
    args: ["-e", source],
  });

const waitForExit = (client) => new Promise((resolve) => client.once("exit", resolve));

const withTimeout = (promise, label, timeoutMs = 5_000) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
};

// Attach the rejection check immediately so a request that fails before it is
// awaited is not reported as an unhandled rejection.
const expectRejection = (promise, label, pattern) =>
  assert.rejects(withTimeout(promise, label), pattern);

// An engine that dies at once rejects in-flight and later requests instead of
// crashing the process with an unhandled EPIPE.
{
  const client = fakeEngine("process.exit(3)");
  const exited = waitForExit(client);
  const requests = Array.from({ length: 20 }, (_, index) =>
    expectRejection(
      client.request("health", { padding: "x".repeat(64 * 1024), index }, { timeoutMs: 10_000 }),
      "Request to an exited engine",
    ),
  );
  await Promise.all(requests);
  const exit = await withTimeout(exited, "Exit event");
  assert.equal(exit.code, 3);
  await expectRejection(client.request("health"), "Request after exit", /KeyFinder engine/);
  client.close();
}

// Closing a busy engine rejects its pending requests, and writes racing the
// closed pipe fail their request rather than the process.
{
  const client = fakeEngine("setInterval(() => {}, 1_000);");
  const exited = waitForExit(client);
  const requests = Array.from({ length: 5 }, () =>
    expectRejection(
      client.request("health", { padding: "x".repeat(64 * 1024) }, { timeoutMs: 10_000 }),
      "Request to a closed engine",
    ),
  );
  client.close();
  requests.push(
    expectRejection(
      client.request("health", {}, { timeoutMs: 10_000 }),
      "Request after close",
      /KeyFinder engine was closed/,
    ),
  );
  await Promise.all(requests);
  await withTimeout(exited, "Exit after close");
}

// An engine that crashes mid-request fails the pending request with the exit
// reason, after answering earlier requests normally.
{
  const client = fakeEngine(`
    const lines = require("node:readline").createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const request = JSON.parse(line);
      if (request.method === "crash") process.exit(7);
      process.stdout.write(JSON.stringify({
        version: 1,
        requestId: request.requestId,
        result: { service: "fake-keyfinder" },
      }) + "\\n");
    });
  `);
  const exited = waitForExit(client);
  assert.deepEqual(await withTimeout(client.health(), "Health"), { service: "fake-keyfinder" });
  await expectRejection(
    client.request("crash", {}, { timeoutMs: 10_000 }),
    "Crashing request",
    /KeyFinder engine exited \(7\)/,
  );
  await withTimeout(exited, "Exit after crash");
  await expectRejection(client.health(), "Health after crash", /KeyFinder engine exited \(7\)/);
}

console.log("KeyFinder client smoke test passed");
