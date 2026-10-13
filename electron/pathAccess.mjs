import path from "node:path";
import { isPathInsideLibraryRoot } from "./libraryPaths.mjs";

// The renderer shows remote content (Wikipedia, Last.fm, Brave), so it is not
// trusted to name arbitrary filesystem paths. A path is only usable when the
// main process can account for it: the user picked it in a native dialog or
// dropped it on the window, it lives under an app-owned directory or the
// configured library root, or the database already references it.

const MAX_GRANTS = 4_096;
const WINDOWS_NAMESPACE_PATH = /^[\\/]{2}[?.][\\/]/;

export const PATH_ACCESS_DENIED = "PATH_ACCESS_DENIED";

const comparableKey = (value) => (process.platform === "win32" ? value.toLocaleLowerCase() : value);

/**
 * An absolute, normalized path, or null for anything the policy refuses to
 * reason about (relative paths, NUL bytes, Windows device namespaces).
 */
export const normalizeAccessPath = (value) => {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.includes("\0") ||
    WINDOWS_NAMESPACE_PATH.test(candidate) ||
    !path.isAbsolute(candidate)
  ) {
    return null;
  }
  return path.resolve(candidate);
};

export const createPathAccessError = (description = "path") =>
  Object.assign(
    new Error(`Access to this ${description} was not granted. Choose it again in the file dialog.`),
    { code: PATH_ACCESS_DENIED },
  );

export const createPathAccess = ({ trustedRoots = () => [], isTrustedFile = () => false } = {}) => {
  const fileGrants = new Map();
  const directoryGrants = new Map();

  const remember = (grants, filePath, access) => {
    const key = comparableKey(filePath);
    const existing = grants.get(key);
    grants.delete(key);
    grants.set(key, {
      path: filePath,
      read: Boolean(existing?.read || access.read),
      write: Boolean(existing?.write || access.write),
    });
    while (grants.size > MAX_GRANTS) grants.delete(grants.keys().next().value);
  };

  const grantFile = (value, { read = true, write = false } = {}) => {
    const filePath = normalizeAccessPath(value);
    if (filePath) remember(fileGrants, filePath, { read, write });
    return filePath;
  };

  const grantDirectory = (value, { read = true, write = true } = {}) => {
    const directoryPath = normalizeAccessPath(value);
    if (directoryPath) remember(directoryGrants, directoryPath, { read, write });
    return directoryPath;
  };

  const isGranted = (value, access) => {
    const filePath = normalizeAccessPath(value);
    if (!filePath) return false;
    if (fileGrants.get(comparableKey(filePath))?.[access]) return true;
    for (const grant of directoryGrants.values()) {
      if (grant[access] && isPathInsideLibraryRoot(filePath, grant.path)) return true;
    }
    return false;
  };

  const isInsideTrustedRoot = (filePath) => {
    for (const root of trustedRoots()) {
      if (root && isPathInsideLibraryRoot(filePath, root)) return true;
    }
    return false;
  };

  const canRead = (value) => {
    const filePath = normalizeAccessPath(value);
    if (!filePath) return false;
    if (isGranted(filePath, "read") || isInsideTrustedRoot(filePath)) return true;
    try {
      return Boolean(isTrustedFile(filePath));
    } catch {
      return false;
    }
  };

  const canWrite = (value) => isGranted(value, "write");

  return {
    grantFile,
    grantDirectory,
    /** Record what a native open/save dialog returned. */
    grantDialogSelection({ paths, directory = false, save = false }) {
      for (const selected of Array.isArray(paths) ? paths : [paths]) {
        if (save) grantFile(selected, { read: true, write: true });
        else if (directory) grantDirectory(selected, { read: true, write: true });
        else grantFile(selected, { read: true, write: false });
      }
    },
    isGranted,
    canRead,
    canWrite,
    assertReadable(value, description) {
      if (!canRead(value)) throw createPathAccessError(description);
      return normalizeAccessPath(value);
    },
    assertWritable(value, description) {
      if (!canWrite(value)) throw createPathAccessError(description);
      return normalizeAccessPath(value);
    },
    clear() {
      fileGrants.clear();
      directoryGrants.clear();
    },
  };
};
