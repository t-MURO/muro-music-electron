import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalFileResponse, parseByteRange } from "../electron/fileProtocol.mjs";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muro-file-protocol-"));
const audioPath = path.join(tempDir, "sample.mp3");

try {
  fs.writeFileSync(audioPath, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });

  const response = await createLocalFileResponse(
    new Request("https://local/sample.mp3", { headers: { Range: "bytes=2-5" } }),
    audioPath
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(response.headers.get("content-length"), "4");
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4, 5]);

  const invalid = await createLocalFileResponse(
    new Request("https://local/sample.mp3", { headers: { Range: "bytes=20-30" } }),
    audioPath
  );
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("access-control-allow-origin"), "*");
  assert.equal(invalid.headers.get("content-range"), "bytes */10");

  console.log("File protocol smoke test passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
