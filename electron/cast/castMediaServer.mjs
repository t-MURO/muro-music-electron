import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import { Readable } from "node:stream";
import { createLocalFileResponse } from "../fileProtocol.mjs";

// Temporary LAN HTTP server that exposes exactly the files a Cast session has
// authorized, addressed by random tokens. The request URL is never decoded
// into a filesystem path: unknown tokens simply do not resolve.
//
//   http://<lan-ip>:<port>/media/<session-token>/<media-token>
//   http://<lan-ip>:<port>/artwork/<session-token>/<artwork-token>

const newToken = () => crypto.randomBytes(16).toString("hex");

const ipv4ToInt = (address) =>
  address.split(".").reduce((value, octet) => (value << 8) + (Number(octet) & 0xff), 0) >>> 0;

const sameSubnet = (left, right, netmask) => {
  try {
    const mask = ipv4ToInt(netmask);
    return (ipv4ToInt(left) & mask) === (ipv4ToInt(right) & mask);
  } catch {
    return false;
  }
};

// Pick the local IPv4 address a Cast receiver can reach. When the receiver's
// address is known, prefer the interface sharing its subnet so multi-homed
// machines (VPN adapters, virtual switches) advertise a routable URL.
export const selectLanAddress = (interfaces, { preferHost } = {}) => {
  const candidates = [];
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" && entry.family !== 4) continue;
      if (entry.internal) continue;
      candidates.push(entry);
    }
  }
  if (candidates.length === 0) return null;
  if (preferHost) {
    const match = candidates.find((entry) => sameSubnet(entry.address, preferHost, entry.netmask));
    if (match) return match.address;
  }
  return candidates[0].address;
};

export const createCastMediaServer = ({ bindHost = "0.0.0.0" } = {}) => {
  // token -> { filePath } — the only way a request resolves to a file.
  const authorizedFiles = new Map();
  let sessionToken = null;
  let server = null;
  let port = 0;

  const handleRequest = async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const segments = (request.url ?? "").split("?")[0].split("/").filter(Boolean);
    const [kind, requestSession, token] = segments;
    const entry =
      segments.length === 3 &&
      (kind === "media" || kind === "artwork") &&
      sessionToken !== null &&
      requestSession === sessionToken
        ? authorizedFiles.get(token)
        : undefined;
    if (!entry) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }

    try {
      const fileResponse = await createLocalFileResponse(
        new Request(`http://cast.local${request.url}`, {
          method: request.method,
          headers: request.headers.range ? { Range: request.headers.range } : {},
        }),
        entry.filePath,
      );
      response.writeHead(fileResponse.status, Object.fromEntries(fileResponse.headers.entries()));
      if (request.method === "HEAD" || !fileResponse.body) {
        response.end();
        return;
      }
      const stream = Readable.fromWeb(fileResponse.body);
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(500, { "Cache-Control": "no-store" });
      response.end();
    }
  };

  const start = () =>
    new Promise((resolve, reject) => {
      if (server) {
        resolve({ port });
        return;
      }
      const created = http.createServer(handleRequest);
      created.on("error", (error) => {
        if (!server) reject(new Error(`Cast media server could not start: ${error.message}`));
      });
      created.listen(0, bindHost, () => {
        server = created;
        port = created.address().port;
        resolve({ port });
      });
    });

  const stop = () =>
    new Promise((resolve) => {
      authorizedFiles.clear();
      sessionToken = null;
      if (!server) {
        resolve();
        return;
      }
      const closing = server;
      server = null;
      port = 0;
      closing.close(() => resolve());
      closing.closeAllConnections?.();
    });

  return {
    start,
    stop,
    isRunning: () => server !== null,
    getPort: () => port,
    getLanAddress: ({ preferHost } = {}) => selectLanAddress(os.networkInterfaces(), { preferHost }),

    // One session token per Cast connection; rotating it invalidates every
    // URL from the previous session.
    beginSession: () => {
      sessionToken = newToken();
      authorizedFiles.clear();
      return sessionToken;
    },
    endSession: () => {
      sessionToken = null;
      authorizedFiles.clear();
    },
    revokeAuthorizations: () => {
      authorizedFiles.clear();
    },
    authorizeFile: (filePath, kind = "media") => {
      if (sessionToken === null) throw new Error("No active cast media session");
      const token = newToken();
      authorizedFiles.set(token, { filePath });
      return { token, path: `/${kind}/${sessionToken}/${token}` };
    },
    urlFor: (pathname, { preferHost } = {}) => {
      const address = selectLanAddress(os.networkInterfaces(), { preferHost });
      if (!address || !server) return null;
      return `http://${address}:${port}${pathname}`;
    },
  };
};
