import path from "node:path";

const WINDOWS_ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\)/i;

export const normalizeLibraryRoot = (value) => {
  const candidate = String(value ?? "").trim();
  return candidate ? path.resolve(candidate) : null;
};

export const isAbsoluteTrackPath = (value) => {
  const candidate = String(value ?? "");
  return path.isAbsolute(candidate) || WINDOWS_ABSOLUTE_PATH.test(candidate);
};

export const normalizePortableTrackPath = (value) => {
  const candidate = String(value ?? "").trim().replace(/\\/g, "/");
  if (!candidate || isAbsoluteTrackPath(candidate)) return null;

  const segments = candidate.split("/");
  if (
    segments.some((segment) => (
      !segment
      || segment === "."
      || segment === ".."
      || segment.includes("\0")
    ))
  ) {
    return null;
  }
  return segments.join("/");
};

export const isPathInsideLibraryRoot = (candidatePath, libraryRoot) => {
  const root = normalizeLibraryRoot(libraryRoot);
  if (!root) return false;
  const candidate = path.resolve(String(candidatePath ?? ""));
  const relative = path.relative(root, candidate);
  return relative !== ""
    ? relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    : true;
};

export const toStoredTrackPath = (filePath, libraryRoot) => {
  const portableInput = normalizePortableTrackPath(filePath);
  if (portableInput) return portableInput;

  const candidate = String(filePath ?? "").trim();
  if (!candidate) return "";

  // A foreign-platform absolute path cannot be resolved meaningfully on this
  // machine. Preserve it as a legacy absolute value so verification can report
  // it missing and the user can relink it.
  if (WINDOWS_ABSOLUTE_PATH.test(candidate) && process.platform !== "win32") {
    return candidate;
  }

  const absolutePath = path.resolve(candidate);
  const root = normalizeLibraryRoot(libraryRoot);
  if (!root || !isPathInsideLibraryRoot(absolutePath, root)) return absolutePath;

  const relative = path.relative(root, absolutePath).split(path.sep).join("/");
  return normalizePortableTrackPath(relative) ?? absolutePath;
};

export const resolveStoredTrackPath = (storedPath, libraryRoot) => {
  const candidate = String(storedPath ?? "").trim();
  if (!candidate) return "";

  const portable = normalizePortableTrackPath(candidate);
  if (!portable) {
    if (WINDOWS_ABSOLUTE_PATH.test(candidate) && process.platform !== "win32") {
      return candidate;
    }
    return path.normalize(candidate);
  }

  const root = normalizeLibraryRoot(libraryRoot);
  if (!root) return portable;

  const resolved = path.resolve(root, ...portable.split("/"));
  if (!isPathInsideLibraryRoot(resolved, root)) {
    throw new Error("Stored track path escapes the library root");
  }
  return resolved;
};

export const portablePathKey = (value) => {
  const normalized = String(value ?? "").replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
};
