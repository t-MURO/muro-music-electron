import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKeyFinderService } from "../electron/keyfinder.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const binaryDirectory = path.resolve(
  here,
  "../../neo-key-finder/neo-keyfinder/src-tauri/binaries",
);
let finish;
const finished = new Promise((resolve) => { finish = resolve; });
const events = [];
const sender = {
  isDestroyed: () => false,
  send: (_channel, name, payload) => {
    assert.equal(name, "muro://keyfinder-analysis");
    events.push(payload);
    if (payload.event === "jobFinished") finish(payload);
  },
};
const service = createKeyFinderService({
  binaryDirectories: [binaryDirectory],
  emit: (target, name, payload) => target.send("muro:event", name, payload),
});

try {
  const health = await service.health();
  assert.equal(health.service, "keyfinder-native");
  assert.equal(health.protocolVersion, 1);

  const started = await service.startAnalysis([{
    id: "missing-track",
    title: "Missing",
    artist: "",
    album: "",
    sourcePath: path.join(here, "does-not-exist.wav"),
    durationSeconds: 60,
  }], sender);
  assert.match(started.jobId, /^job-/);

  const completed = await Promise.race([
    finished,
    new Promise((_, reject) => setTimeout(() => reject(new Error("KeyFinder job timed out")), 10_000)),
  ]);
  assert.equal(completed.payload.total, 1);
  assert.ok(events.some((event) =>
    event.event === "trackUpdated" && event.payload.track.status === "failed"));
} finally {
  service.close();
}

console.log("KeyFinder integration smoke test passed");
