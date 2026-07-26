import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const FLAC_MAGIC = Buffer.from("fLaC");
const FLAC_METADATA_HEADER_BYTES = 4;
const FLAC_STREAMINFO_BYTES = 34;
const MAX_FLAC_METADATA_BLOCKS = 128;
const MAX_FLAC_RECOVERY_SCAN_BYTES = 1024 * 1024;
const MAX_FLAC_FRAME_HEADER_BYTES = 32;
const MAX_RECOVERY_CACHE_ENTRIES = 512;

const recoveryCache = new Map();

const MIME_TYPES = new Map([
  [".aac", "audio/aac"],
  [".aif", "audio/aiff"],
  [".aiff", "audio/aiff"],
  [".alac", "audio/mp4"],
  [".flac", "audio/flac"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".mp4", "audio/mp4"],
  [".oga", "audio/ogg"],
  [".ogg", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".wav", "audio/wav"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const readAt = async (fileHandle, position, length) => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await fileHandle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
};

const flacHeaderCrc8 = (buffer, start, end) => {
  let crc = 0;
  for (let position = start; position < end; position += 1) {
    crc ^= buffer[position];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80) !== 0
        ? ((crc << 1) ^ 0x07) & 0xff
        : (crc << 1) & 0xff;
    }
  }
  return crc;
};

const utf8IntegerLength = (firstByte) => {
  if ((firstByte & 0x80) === 0) return 1;
  if ((firstByte & 0xe0) === 0xc0) return 2;
  if ((firstByte & 0xf0) === 0xe0) return 3;
  if ((firstByte & 0xf8) === 0xf0) return 4;
  if ((firstByte & 0xfc) === 0xf8) return 5;
  if ((firstByte & 0xfe) === 0xfc) return 6;
  if (firstByte === 0xfe) return 7;
  return 0;
};

const isValidFlacFrameHeader = (buffer, start) => {
  if (
    start < 0 ||
    start + 6 > buffer.length ||
    buffer[start] !== 0xff ||
    (buffer[start + 1] & 0xfe) !== 0xf8
  ) {
    return false;
  }

  const blockSizeCode = buffer[start + 2] >> 4;
  const sampleRateCode = buffer[start + 2] & 0x0f;
  const channelAssignment = buffer[start + 3] >> 4;
  if (
    blockSizeCode === 0 ||
    sampleRateCode === 0x0f ||
    channelAssignment > 10 ||
    (buffer[start + 3] & 0x01) !== 0
  ) {
    return false;
  }

  const numberLength = utf8IntegerLength(buffer[start + 4]);
  if (numberLength === 0) return false;
  for (let index = 1; index < numberLength; index += 1) {
    if ((buffer[start + 4 + index] & 0xc0) !== 0x80) return false;
  }

  const blockSizeBytes = blockSizeCode === 6 ? 1 : blockSizeCode === 7 ? 2 : 0;
  const sampleRateBytes = sampleRateCode === 12
    ? 1
    : sampleRateCode === 13 || sampleRateCode === 14
      ? 2
      : 0;
  const crcPosition = start + 4 + numberLength + blockSizeBytes + sampleRateBytes;
  if (crcPosition >= buffer.length) return false;

  return flacHeaderCrc8(buffer, start, crcPosition) === buffer[crcPosition];
};

const readFlacMetadataEnd = async (fileHandle, fileSize) => {
  if (fileSize < FLAC_MAGIC.length + FLAC_METADATA_HEADER_BYTES + FLAC_STREAMINFO_BYTES) {
    return null;
  }

  const magic = await readAt(fileHandle, 0, FLAC_MAGIC.length);
  if (!magic.equals(FLAC_MAGIC)) return null;

  let position = FLAC_MAGIC.length;
  for (let blockIndex = 0; blockIndex < MAX_FLAC_METADATA_BLOCKS; blockIndex += 1) {
    const header = await readAt(fileHandle, position, FLAC_METADATA_HEADER_BYTES);
    if (header.length !== FLAC_METADATA_HEADER_BYTES) return null;

    const blockType = header[0] & 0x7f;
    const blockLength = header.readUIntBE(1, 3);
    if (
      blockType === 0x7f ||
      (blockIndex === 0 && (blockType !== 0 || blockLength !== FLAC_STREAMINFO_BYTES))
    ) {
      return null;
    }

    const blockEnd = position + FLAC_METADATA_HEADER_BYTES + blockLength;
    if (blockEnd > fileSize) return null;
    position = blockEnd;
    if ((header[0] & 0x80) !== 0) return position;
  }

  return null;
};

export const detectFlacPrefixRecovery = async (filePath, providedStats) => {
  const fileStats = providedStats ?? await fs.promises.stat(filePath);
  if (!fileStats.isFile()) return null;

  const fileHandle = await fs.promises.open(filePath, "r");
  try {
    const metadataEnd = await readFlacMetadataEnd(fileHandle, fileStats.size);
    if (metadataEnd === null || metadataEnd >= fileStats.size) return null;

    // Healthy FLACs take the fast path: only a frame header is read after the
    // metadata chain. The larger recovery scan is reserved for malformed files.
    const initialHeader = await readAt(
      fileHandle,
      metadataEnd,
      Math.min(MAX_FLAC_FRAME_HEADER_BYTES, fileStats.size - metadataEnd),
    );
    if (isValidFlacFrameHeader(initialHeader, 0)) return null;

    const availableBytes = fileStats.size - metadataEnd;
    const scanLength = Math.min(
      availableBytes,
      MAX_FLAC_RECOVERY_SCAN_BYTES + MAX_FLAC_FRAME_HEADER_BYTES,
    );
    const scanBuffer = await readAt(fileHandle, metadataEnd, scanLength);
    const finalCandidate = Math.min(
      MAX_FLAC_RECOVERY_SCAN_BYTES,
      scanBuffer.length - 6,
    );

    for (let relativeOffset = 0; relativeOffset <= finalCandidate; relativeOffset += 1) {
      if (!isValidFlacFrameHeader(scanBuffer, relativeOffset)) continue;
      if (relativeOffset === 0) return null;
      return {
        skipStart: metadataEnd,
        skipEnd: metadataEnd + relativeOffset,
        skippedBytes: relativeOffset,
        virtualSize: fileStats.size - relativeOffset,
      };
    }
    return null;
  } finally {
    await fileHandle.close();
  }
};

const recoveryFingerprint = (fileStats) =>
  `${fileStats.size}:${fileStats.mtimeMs}:${fileStats.ctimeMs}`;

const getFlacPrefixRecovery = async (filePath, fileStats) => {
  if (path.extname(filePath).toLowerCase() !== ".flac") return null;

  const cacheKey = path.resolve(filePath);
  const fingerprint = recoveryFingerprint(fileStats);
  const cached = recoveryCache.get(cacheKey);
  if (cached?.fingerprint === fingerprint) {
    recoveryCache.delete(cacheKey);
    recoveryCache.set(cacheKey, cached);
    return cached.recovery;
  }

  const recovery = await detectFlacPrefixRecovery(filePath, fileStats);
  recoveryCache.set(cacheKey, { fingerprint, recovery });
  while (recoveryCache.size > MAX_RECOVERY_CACHE_ENTRIES) {
    recoveryCache.delete(recoveryCache.keys().next().value);
  }
  return recovery;
};

export const parseByteRange = (value, size) => {
  if (!value) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) {
    throw new RangeError("Invalid byte range");
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeError("Invalid byte range");
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    throw new RangeError("Invalid byte range");
  }

  return { start, end: Math.min(end, size - 1) };
};

const responseHeaders = (filePath, contentLength, recovered) => {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Length": String(contentLength),
    "Content-Type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  if (recovered) headers.set("X-Muro-Recovered-Media", "flac-frame-resync");
  return headers;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

const originalSegmentsForVirtualRange = (start, end, recovery) => {
  if (!recovery) return [{ start, end }];

  const segments = [];
  if (start < recovery.skipStart) {
    segments.push({
      start,
      end: Math.min(end, recovery.skipStart - 1),
    });
  }
  if (end >= recovery.skipStart) {
    segments.push({
      start: Math.max(start, recovery.skipStart) + recovery.skippedBytes,
      end: end + recovery.skippedBytes,
    });
  }
  return segments.filter((segment) => segment.start <= segment.end);
};

const createSegmentedReadStream = (filePath, segments) => Readable.from((async function* read() {
  for (const segment of segments) {
    const stream = fs.createReadStream(filePath, segment);
    try {
      for await (const chunk of stream) yield chunk;
    } finally {
      stream.destroy();
    }
  }
})());

export const createLocalFileResponse = async (request, filePath) => {
  let fileStats;
  try {
    fileStats = await fs.promises.stat(filePath);
  } catch {
    return new Response("File not found", { status: 404, headers: corsHeaders });
  }

  if (!fileStats.isFile()) {
    return new Response("File not found", { status: 404, headers: corsHeaders });
  }

  const recovery = await getFlacPrefixRecovery(filePath, fileStats);
  const size = recovery?.virtualSize ?? fileStats.size;
  let range = null;
  try {
    range = parseByteRange(request.headers.get("range"), size);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return new Response(null, {
      status: 416,
      headers: {
        ...corsHeaders,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, size - 1);
  const contentLength = size === 0 ? 0 : end - start + 1;
  const headers = responseHeaders(filePath, contentLength, recovery !== null);
  const status = range ? 206 : 200;

  if (range) {
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }

  if (request.method === "HEAD" || size === 0) {
    return new Response(null, { status, headers });
  }

  const stream = createSegmentedReadStream(
    filePath,
    originalSegmentsForVirtualRange(start, end, recovery),
  );
  return new Response(Readable.toWeb(stream), { status, headers });
};
