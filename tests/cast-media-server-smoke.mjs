import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLanMediaServer, selectLanAddress } from "../electron/lanMediaServer.mjs";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muro-cast-server-"));
const audioPath = path.join(tempDir, "sample.mp3");
fs.writeFileSync(audioPath, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

const server = createLanMediaServer({ bindHost: "127.0.0.1" });

try {
  // LAN address selection prefers the interface on the receiver's subnet.
  const interfaces = {
    "VPN": [{ address: "10.8.0.2", netmask: "255.255.255.0", family: "IPv4", internal: false }],
    "Wi-Fi": [{ address: "192.168.1.20", netmask: "255.255.255.0", family: "IPv4", internal: false }],
    "Loopback": [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true }],
  };
  assert.equal(selectLanAddress(interfaces, { preferHost: "192.168.1.55" }), "192.168.1.20");
  assert.equal(selectLanAddress(interfaces), "10.8.0.2");
  assert.equal(selectLanAddress({}), null);

  const { port } = await server.start();
  assert.ok(port > 0);
  const base = `http://127.0.0.1:${port}`;

  // Nothing resolves before a session begins.
  const beforeSession = await fetch(`${base}/media/none/none`);
  assert.equal(beforeSession.status, 404);
  assert.throws(() => server.authorizeFile(audioPath), /No active cast media session/);

  server.beginSession();
  const media = server.authorizeFile(audioPath, "media");

  const full = await fetch(`${base}${media.path}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mpeg");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.deepEqual([...new Uint8Array(await full.arrayBuffer())], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  const ranged = await fetch(`${base}${media.path}`, { headers: { Range: "bytes=2-5" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 2-5/10");
  assert.deepEqual([...new Uint8Array(await ranged.arrayBuffer())], [2, 3, 4, 5]);

  const suffix = await fetch(`${base}${media.path}`, { headers: { Range: "bytes=-3" } });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("content-range"), "bytes 7-9/10");

  const invalidRange = await fetch(`${base}${media.path}`, { headers: { Range: "bytes=40-50" } });
  assert.equal(invalidRange.status, 416);

  const head = await fetch(`${base}${media.path}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");

  const post = await fetch(`${base}${media.path}`, { method: "POST" });
  assert.equal(post.status, 405);

  // Tokens are the only lookup key: bad token, bad session, and traversal
  // shaped URLs all miss.
  const sessionToken = media.path.split("/")[2];
  const badToken = await fetch(`${base}/media/${sessionToken}/ffffffffffffffffffffffffffffffff`);
  assert.equal(badToken.status, 404);
  const badSession = await fetch(`${base}/media/ffffffffffffffffffffffffffffffff/${media.path.split("/")[3]}`);
  assert.equal(badSession.status, 404);
  const traversal = await fetch(`${base}/media/${sessionToken}/..%2F..%2Fsample.mp3`);
  assert.equal(traversal.status, 404);
  const rawPath = await fetch(`${base}/media/${sessionToken}/${encodeURIComponent(audioPath)}`);
  assert.equal(rawPath.status, 404);

  // Revocation invalidates existing URLs immediately.
  server.revokeAuthorizations();
  const afterRevoke = await fetch(`${base}${media.path}`);
  assert.equal(afterRevoke.status, 404);

  // A new session mints new tokens; old session URLs stay dead.
  const oldSessionPath = media.path;
  server.beginSession();
  const artwork = server.authorizeFile(audioPath, "artwork");
  assert.ok(artwork.path.startsWith("/artwork/"));
  const staleSession = await fetch(`${base}${oldSessionPath}`);
  assert.equal(staleSession.status, 404);
  const freshArtwork = await fetch(`${base}${artwork.path}`);
  assert.equal(freshArtwork.status, 200);

  server.endSession();
  const afterEnd = await fetch(`${base}${artwork.path}`);
  assert.equal(afterEnd.status, 404);

  console.log("Cast media server smoke test passed.");
} finally {
  await server.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
