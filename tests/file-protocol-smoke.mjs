import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createLocalFileResponse,
  createMediaProtocolHandler,
  detectFlacPrefixRecovery,
  parseByteRange,
} from "../electron/fileProtocol.mjs";
import { createPathAccess } from "../electron/pathAccess.mjs";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muro-file-protocol-"));
const audioPath = path.join(tempDir, "sample.mp3");
const recoveredFlacPath = path.join(tempDir, "recovered.flac");
const validFlacPath = path.join(tempDir, "valid.flac");
const privateTextPath = path.join(tempDir, "private.txt");

const streamInfo = Buffer.concat([
  Buffer.from("664c6143", "hex"),
  Buffer.from([0x80, 0x00, 0x00, 0x22]),
  Buffer.alloc(34),
]);
const invalidPrefix = Buffer.from([0x3a, 0x7e, 0xff, 0xf8, 0x00, 0x00, 0x00, 0xaa]);
// CRC-8 byte 0xc2 makes this a valid fixed-block FLAC frame header.
const validFrame = Buffer.from("fff8c91800c2400102030405", "hex");

try {
  fs.writeFileSync(audioPath, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  fs.writeFileSync(recoveredFlacPath, Buffer.concat([streamInfo, invalidPrefix, validFrame]));
  fs.writeFileSync(validFlacPath, Buffer.concat([streamInfo, validFrame]));
  fs.writeFileSync(privateTextPath, "must not be exposed through the media protocol");

  const blockedNonMedia = await createLocalFileResponse(
    new Request("https://local/private.txt"),
    privateTextPath,
  );
  assert.equal(blockedNonMedia.status, 415);

  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });

  const response = await createLocalFileResponse(
    new Request("https://local/sample.mp3", { headers: { Range: "bytes=2-5" } }),
    audioPath
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cross-origin-resource-policy"), null);
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
  assert.equal(invalid.headers.get("access-control-allow-origin"), null);
  assert.equal(invalid.headers.get("content-range"), "bytes */10");

  const recovery = await detectFlacPrefixRecovery(recoveredFlacPath);
  assert.deepEqual(recovery, {
    skipStart: streamInfo.length,
    skipEnd: streamInfo.length + invalidPrefix.length,
    skippedBytes: invalidPrefix.length,
    virtualSize: streamInfo.length + validFrame.length,
  });

  const recovered = await createLocalFileResponse(
    new Request("https://local/recovered.flac"),
    recoveredFlacPath,
  );
  assert.equal(recovered.status, 200);
  assert.equal(recovered.headers.get("content-type"), "audio/flac");
  assert.equal(recovered.headers.get("content-length"), String(streamInfo.length + validFrame.length));
  assert.equal(recovered.headers.get("x-muro-recovered-media"), "flac-frame-resync");
  assert.deepEqual(
    Buffer.from(await recovered.arrayBuffer()),
    Buffer.concat([streamInfo, validFrame]),
  );

  const crossingRangeStart = streamInfo.length - 2;
  const crossingRangeEnd = streamInfo.length + 3;
  const crossingRange = await createLocalFileResponse(
    new Request("https://local/recovered.flac", {
      headers: { Range: `bytes=${crossingRangeStart}-${crossingRangeEnd}` },
    }),
    recoveredFlacPath,
  );
  assert.equal(crossingRange.status, 206);
  assert.equal(
    crossingRange.headers.get("content-range"),
    `bytes ${crossingRangeStart}-${crossingRangeEnd}/${streamInfo.length + validFrame.length}`,
  );
  assert.deepEqual(
    Buffer.from(await crossingRange.arrayBuffer()),
    Buffer.concat([streamInfo.subarray(-2), validFrame.subarray(0, 4)]),
  );

  const frameRange = await createLocalFileResponse(
    new Request("https://local/recovered.flac", {
      headers: { Range: `bytes=${streamInfo.length}-${streamInfo.length + 5}` },
    }),
    recoveredFlacPath,
  );
  assert.deepEqual(Buffer.from(await frameRange.arrayBuffer()), validFrame.subarray(0, 6));

  const head = await createLocalFileResponse(
    new Request("https://local/recovered.flac", { method: "HEAD" }),
    recoveredFlacPath,
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(streamInfo.length + validFrame.length));
  assert.equal(await head.text(), "");

  assert.equal(await detectFlacPrefixRecovery(validFlacPath), null);
  const valid = await createLocalFileResponse(
    new Request("https://local/valid.flac"),
    validFlacPath,
  );
  assert.equal(valid.headers.get("x-muro-recovered-media"), null);
  assert.deepEqual(Buffer.from(await valid.arrayBuffer()), Buffer.concat([streamInfo, validFrame]));

  // The protocol handler only serves paths the main process can account for.
  const libraryRoot = path.join(tempDir, "library");
  const coverCache = path.join(tempDir, "covers");
  const outsideRoot = path.join(tempDir, "elsewhere");
  for (const directory of [libraryRoot, coverCache, outsideRoot]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const libraryTrack = path.join(libraryRoot, "Artist", "track.mp3");
  const cachedCover = path.join(coverCache, "cover.jpg");
  const outsideTrack = path.join(outsideRoot, "secret.mp3");
  const outsideImage = path.join(outsideRoot, "secret.png");
  const inboxTrack = path.join(outsideRoot, "inbox.mp3");
  fs.mkdirSync(path.dirname(libraryTrack), { recursive: true });
  for (const filePath of [libraryTrack, cachedCover, outsideTrack, outsideImage, inboxTrack]) {
    fs.writeFileSync(filePath, Buffer.from([1, 2, 3, 4]));
  }
  const pathAccess = createPathAccess({
    trustedRoots: () => [libraryRoot, coverCache],
    isTrustedFile: (filePath) => filePath === inboxTrack,
  });
  const handler = createMediaProtocolHandler({ isPathAllowed: pathAccess.canRead });
  const urlFor = (filePath) => `muro-file://local/${encodeURIComponent(filePath)}`;
  const fetchStatus = async (url, init) => (await handler(new Request(url, init))).status;

  assert.equal(await fetchStatus(urlFor(libraryTrack)), 200, "library files are served");
  assert.equal(await fetchStatus(urlFor(cachedCover)), 200, "cached artwork is served");
  assert.equal(await fetchStatus(urlFor(inboxTrack)), 200, "database-referenced files are served");
  assert.equal(await fetchStatus(urlFor(outsideTrack)), 403, "files outside the library are refused");
  assert.equal(await fetchStatus(urlFor(outsideImage)), 403, "images outside the caches are refused");
  assert.equal(
    await fetchStatus(urlFor(path.join(outsideRoot, "missing.mp3"))),
    403,
    "refusal happens before the file is stat'ed",
  );
  assert.equal(
    await fetchStatus(urlFor(`${libraryRoot}${path.sep}..${path.sep}elsewhere${path.sep}secret.mp3`)),
    403,
    "dot segments cannot escape the library root",
  );
  assert.equal(
    await fetchStatus(urlFor(`${libraryRoot}-sibling${path.sep}track.mp3`)),
    403,
    "a sibling folder sharing the root prefix is not inside the root",
  );
  assert.equal(await fetchStatus(urlFor("relative/track.mp3")), 415);
  assert.equal(await fetchStatus(urlFor(privateTextPath)), 415);
  assert.equal(await fetchStatus(`muro-file://elsewhere/${encodeURIComponent(libraryTrack)}`), 400);
  assert.equal(await fetchStatus(urlFor(libraryTrack), { method: "POST", body: "x" }), 405);
  const forbidden = await handler(new Request(urlFor(outsideTrack)));
  assert.equal(forbidden.headers.get("access-control-allow-origin"), null);
  assert.equal(await forbidden.text(), "Forbidden");

  // A file the user picked in a dialog becomes servable, nothing next to it.
  pathAccess.grantDialogSelection({ paths: [outsideTrack] });
  assert.equal(await fetchStatus(urlFor(outsideTrack)), 200);
  assert.equal(await fetchStatus(urlFor(outsideImage)), 403);
  pathAccess.grantDialogSelection({ paths: [outsideRoot], directory: true });
  assert.equal(await fetchStatus(urlFor(outsideImage)), 200);

  const throwingHandler = createMediaProtocolHandler({
    isPathAllowed: () => {
      throw new Error("database unavailable");
    },
  });
  assert.equal((await throwingHandler(new Request(urlFor(libraryTrack)))).status, 403);

  console.log("File protocol smoke test passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
