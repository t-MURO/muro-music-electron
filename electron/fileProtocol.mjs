import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

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

const responseHeaders = (filePath, contentLength) =>
  new Headers({
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Length": String(contentLength),
    "Content-Type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

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

  const size = fileStats.size;
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
  const headers = responseHeaders(filePath, contentLength);
  const status = range ? 206 : 200;

  if (range) {
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }

  if (request.method === "HEAD" || size === 0) {
    return new Response(null, { status, headers });
  }

  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream), { status, headers });
};
