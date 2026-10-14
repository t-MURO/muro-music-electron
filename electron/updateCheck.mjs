import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// Muro only tells the user that a newer release exists and, on request,
// downloads its installer to the Downloads folder. It never runs the
// installer, replaces itself or quits. The renderer names a version at most;
// every URL and file path used here comes from the release data this module
// fetched itself, and downloads are limited to this repository's release
// assets on github.com.

export const UPDATE_REPOSITORY = "t-MURO/muro-music-electron";
export const RELEASES_API_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=20`;
export const RELEASES_PAGE_URL = `https://github.com/${UPDATE_REPOSITORY}/releases`;
export const UPDATE_STATUS_EVENT = "muro://update-status";
const RELEASE_PAGE_PATH_PREFIX = `/${UPDATE_REPOSITORY}/releases/`;
const DOWNLOAD_PATH_PREFIX = `/${UPDATE_REPOSITORY}/releases/download/`;

const CHECK_TIMEOUT_MS = 15_000;
/** A download that receives nothing for this long is abandoned. */
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;
/**
 * Automatic checks within this window reuse the last result. GitHub allows 60
 * unauthenticated API requests per hour, shared by everything on the network.
 */
export const AUTOMATIC_CHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PROGRESS_EVENT_INTERVAL_MS = 250;
const PARTIAL_SUFFIX = ".partial";
const MAX_NAME_SEQUENCE = 99;

/** An update failure the renderer translates by its code. */
export class UpdateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UpdateError";
    this.code = code;
  }
}

// --- Versions -------------------------------------------------------------------

// Tags are not consistent ("v0.1.10", "0.1.5"), so a leading "v" and a missing
// minor or patch number are tolerated. Build metadata is ignored, as in semver.
const VERSION_PATTERN =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/i;

export const parseVersion = (value) => {
  if (typeof value !== "string") return null;
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: match[4] ? match[4].split(".") : [],
  };
};

export const formatVersion = (version) =>
  `${version.major}.${version.minor}.${version.patch}` +
  (version.prerelease.length > 0 ? `-${version.prerelease.join(".")}` : "");

const NUMERIC_IDENTIFIER = /^\d+$/;

const compareIdentifiers = (left, right) => {
  const leftNumeric = NUMERIC_IDENTIFIER.test(left);
  const rightNumeric = NUMERIC_IDENTIFIER.test(right);
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
};

const compareParsedVersions = (left, right) => {
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field]) return Math.sign(left[field] - right[field]);
  }
  // A release outranks any of its pre-releases (1.0.0 > 1.0.0-beta).
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length);
  }
  const length = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const result = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (result !== 0) return result;
  }
  return Math.sign(left.prerelease.length - right.prerelease.length);
};

/** -1, 0 or 1 by semver precedence; throws for something that is not a version. */
export const compareVersions = (left, right) => {
  const parsedLeft = typeof left === "string" ? parseVersion(left) : left;
  const parsedRight = typeof right === "string" ? parseVersion(right) : right;
  if (!parsedLeft || !parsedRight) {
    throw new Error(`Cannot compare versions ${String(left)} and ${String(right)}`);
  }
  return compareParsedVersions(parsedLeft, parsedRight);
};

export const isNewerVersion = (candidate, current) => {
  const parsedCandidate = parseVersion(candidate);
  const parsedCurrent = parseVersion(current);
  return Boolean(
    parsedCandidate && parsedCurrent && compareParsedVersions(parsedCandidate, parsedCurrent) > 0,
  );
};

// --- Release data ---------------------------------------------------------------

const githubUrl = (value, pathPrefix) => {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "https:" &&
    url.hostname === "github.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.startsWith(pathPrefix)
    ? url
    : null;
};

/** Only this repository's release assets on github.com may be downloaded. */
export const isAllowedDownloadUrl = (value) => githubUrl(value, DOWNLOAD_PATH_PREFIX) !== null;

export const isAllowedReleasePageUrl = (value) =>
  githubUrl(value, RELEASE_PAGE_PATH_PREFIX) !== null;

const normalizeAsset = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  if (!isAllowedDownloadUrl(raw.browser_download_url)) return null;
  // Assets still being uploaded are listed with state "starter".
  if (raw.state !== undefined && raw.state !== "uploaded") return null;
  return {
    name: raw.name,
    size: Number.isSafeInteger(raw.size) && raw.size > 0 ? raw.size : 0,
    digest: typeof raw.digest === "string" ? raw.digest : null,
    url: raw.browser_download_url,
  };
};

/** The fields Muro uses from one GitHub release, or null for drafts and unversioned tags. */
export const normalizeRelease = (raw) => {
  if (!raw || typeof raw !== "object" || raw.draft === true) return null;
  const parsed = parseVersion(raw.tag_name) ?? parseVersion(raw.name);
  if (!parsed) return null;
  return {
    version: formatVersion(parsed),
    tagName: typeof raw.tag_name === "string" ? raw.tag_name : "",
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : formatVersion(parsed),
    prerelease: raw.prerelease === true,
    publishedAt: typeof raw.published_at === "string" ? raw.published_at : null,
    htmlUrl: isAllowedReleasePageUrl(raw.html_url) ? raw.html_url : RELEASES_PAGE_URL,
    assets: (Array.isArray(raw.assets) ? raw.assets : []).map(normalizeAsset).filter(Boolean),
  };
};

/**
 * The highest-versioned release that is not a draft. Pre-releases count:
 * every Muro release so far is marked as one, so /releases/latest finds none.
 */
export const selectLatestRelease = (releases) => {
  let latest = null;
  for (const raw of Array.isArray(releases) ? releases : []) {
    const release = normalizeRelease(raw);
    if (release && (!latest || compareVersions(release.version, latest.version) > 0)) {
      latest = release;
    }
  }
  return latest;
};

// --- Installer assets -----------------------------------------------------------

const INSTALLER_EXTENSIONS = { win32: ".exe", darwin: ".dmg", linux: ".appimage" };
const ARCH_TOKENS = {
  x64: ["x64", "x86_64", "amd64"],
  arm64: ["arm64", "aarch64"],
  ia32: ["ia32", "x86", "i386", "i686"],
  armv7l: ["armv7l", "armhf"],
  universal: ["universal"],
};
// electron-builder leaves the default x64 build without an architecture in
// its file name. Windows on Arm runs x64 installers under emulation.
const UNTAGGED_ARCHES = { win32: ["x64", "arm64"], darwin: ["x64"], linux: ["x64"] };

const assetArch = (name) => {
  const tokens = name.toLowerCase().split(/[-.\s]+/);
  for (const [arch, aliases] of Object.entries(ARCH_TOKENS)) {
    if (aliases.some((alias) => tokens.includes(alias))) return arch;
  }
  return null;
};

/**
 * The installer for this platform and architecture: an .exe on Windows, a
 * .dmg on macOS, an .AppImage on Linux. Null when the release has none, in
 * which case the release page is offered instead.
 */
export const selectInstallerAsset = (assets, platform, arch) => {
  const extension = INSTALLER_EXTENSIONS[platform];
  if (!extension) return null;
  const ranked = [];
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (!asset?.name?.toLowerCase().endsWith(extension)) continue;
    const tagged = assetArch(asset.name);
    const rank =
      tagged === arch
        ? 0
        : tagged === null && UNTAGGED_ARCHES[platform]?.includes(arch)
          ? 1
          : tagged === "universal" && platform === "darwin"
            ? 2
            : null;
    if (rank === null) continue;
    // Prefer the NSIS setup over a portable build when both are published.
    const setupPreference = /setup/i.test(asset.name) ? 0 : 1;
    ranked.push({ asset, rank, setupPreference });
  }
  ranked.sort(
    (left, right) =>
      left.rank - right.rank ||
      left.setupPreference - right.setupPreference ||
      left.asset.name.localeCompare(right.asset.name),
  );
  return ranked[0]?.asset ?? null;
};

// --- Integrity ------------------------------------------------------------------

/** The expected SHA-256 from GitHub's "sha256:<hex>" digest, or null if unusable. */
export const parseSha256Digest = (digest) => {
  const match = typeof digest === "string" ? /^sha256:([0-9a-f]{64})$/i.exec(digest.trim()) : null;
  return match ? match[1].toLowerCase() : null;
};

/** Null when a download matches its asset's size and digest, otherwise the failure code. */
export const integrityError = ({ bytes, sha256 }, asset) => {
  if (asset.size > 0 && bytes !== asset.size) return "size-mismatch";
  const expected = parseSha256Digest(asset.digest);
  if (expected && sha256 !== expected) return "digest-mismatch";
  return null;
};

export const hashFile = async (filePath) => {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
};

// --- Network --------------------------------------------------------------------

const timeoutSignal = (milliseconds) =>
  typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(milliseconds)
    : undefined;

/** The newest release on GitHub, or null when the repository has none. */
export const fetchLatestRelease = async ({
  fetchImpl = globalThis.fetch,
  userAgent,
  timeoutMs = CHECK_TIMEOUT_MS,
} = {}) => {
  let response;
  try {
    response = await fetchImpl(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": userAgent,
      },
      signal: timeoutSignal(timeoutMs),
    });
  } catch (error) {
    throw new UpdateError(
      error?.name === "TimeoutError" ? "timeout" : "network",
      `Could not reach GitHub: ${error?.message ?? error}`,
    );
  }
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  ) {
    throw new UpdateError("rate-limited", "GitHub's rate limit for update checks was reached");
  }
  if (!response.ok) {
    throw new UpdateError("http", `GitHub answered the update check with HTTP ${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    if (error?.name === "TimeoutError") throw new UpdateError("timeout", "GitHub timed out");
    throw new UpdateError("invalid-response", "GitHub sent an unreadable release list");
  }
  if (!Array.isArray(body)) {
    throw new UpdateError("invalid-response", "GitHub sent an unexpected release list");
  }
  return selectLatestRelease(body);
};

const SAFE_FILE_NAME = /^[^\\/:*?"<>|\0]+$/;

const installerFileName = (name) => {
  const base = path.basename(String(name ?? ""));
  if (base !== name || !SAFE_FILE_NAME.test(base) || base.startsWith(".") || base.length > 200) {
    throw new UpdateError("invalid-response", "The installer has an unusable file name");
  }
  return base;
};

const exists = (filePath) =>
  fs.promises.access(filePath).then(
    () => true,
    () => false,
  );

/**
 * Where to save the installer: its own name, or "name (n).ext" when a
 * different file already has that name. An identical earlier download (same
 * size and digest) is reused instead of fetched again.
 */
const resolveDestination = async (destinationDir, asset) => {
  const fileName = installerFileName(asset.name);
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  for (let sequence = 0; sequence <= MAX_NAME_SEQUENCE; sequence += 1) {
    const candidate = path.join(
      destinationDir,
      sequence === 0 ? fileName : `${stem} (${sequence})${extension}`,
    );
    if (!(await exists(candidate))) return { filePath: candidate, reused: false };
    if (parseSha256Digest(asset.digest)) {
      try {
        const stat = await fs.promises.stat(candidate);
        if (stat.isFile() && stat.size === asset.size) {
          if (integrityError(await hashFile(candidate), asset) === null) {
            return { filePath: candidate, reused: true };
          }
        }
      } catch {
        // An unreadable file is simply not reused.
      }
    }
  }
  throw new UpdateError("write-failed", "Too many files with the installer's name already exist");
};

const WRITE_ERROR_CODES = new Set(["ENOSPC", "EACCES", "EPERM", "EROFS", "EBUSY", "EISDIR"]);

/**
 * Stream one release asset into destinationDir through a ".partial" file,
 * hashing as it goes, and rename it only once its size and digest check out.
 */
export const downloadAsset = async (
  asset,
  {
    fetchImpl = globalThis.fetch,
    userAgent,
    destinationDir,
    signal,
    onProgress,
    stallTimeoutMs = DOWNLOAD_STALL_TIMEOUT_MS,
  },
) => {
  if (!isAllowedDownloadUrl(asset?.url)) {
    throw new UpdateError("not-available", "The installer is not a release asset of Muro Music");
  }
  await fs.promises.mkdir(destinationDir, { recursive: true });
  const destination = await resolveDestination(destinationDir, asset);
  if (destination.reused)
    return { filePath: destination.filePath, bytes: asset.size, reused: true };

  const partialPath = `${destination.filePath}${PARTIAL_SUFFIX}`;
  const stall = new AbortController();
  let stallTimer = null;
  const armStallTimer = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => stall.abort(), stallTimeoutMs);
  };
  const combinedSignal = signal ? AbortSignal.any([signal, stall.signal]) : stall.signal;
  let partialCreated = false;
  try {
    armStallTimer();
    const response = await fetchImpl(asset.url, {
      headers: { Accept: "application/octet-stream", "User-Agent": userAgent },
      redirect: "follow",
      signal: combinedSignal,
    });
    // github.com redirects to its download CDN; never accept a downgrade to http.
    if (response.url && new URL(response.url).protocol !== "https:") {
      throw new UpdateError("network", "The installer download was redirected to plain HTTP");
    }
    if (!response.ok || !response.body) {
      throw new UpdateError("http", `GitHub answered the download with HTTP ${response.status}`);
    }
    const announced = Number(response.headers.get("content-length"));
    if (asset.size > 0 && announced > 0 && announced !== asset.size) {
      throw new UpdateError("size-mismatch", "The installer has a different size than announced");
    }
    const totalBytes = asset.size || (announced > 0 ? announced : 0);
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (asset.size > 0 && bytes > asset.size) {
          callback(new UpdateError("size-mismatch", "The installer is larger than announced"));
          return;
        }
        hash.update(chunk);
        armStallTimer();
        onProgress?.(bytes, totalBytes);
        callback(null, chunk);
      },
    });
    partialCreated = true;
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partialPath), {
      signal: combinedSignal,
    });
    const failure = integrityError({ bytes, sha256: hash.digest("hex") }, asset);
    if (failure === "size-mismatch") {
      throw new UpdateError(failure, "The installer download is incomplete");
    }
    if (failure) {
      throw new UpdateError(failure, "The installer does not match the checksum GitHub published");
    }
    await fs.promises.rename(partialPath, destination.filePath);
    partialCreated = false;
    return { filePath: destination.filePath, bytes, reused: false };
  } catch (error) {
    if (signal?.aborted) throw new UpdateError("cancelled", "The download was cancelled");
    if (stall.signal.aborted) throw new UpdateError("timeout", "The download stalled");
    if (error instanceof UpdateError) throw error;
    if (WRITE_ERROR_CODES.has(error?.code)) {
      throw new UpdateError("write-failed", `The installer could not be saved: ${error.message}`);
    }
    throw new UpdateError("network", `The download failed: ${error?.message ?? error}`);
  } finally {
    clearTimeout(stallTimer);
    if (partialCreated) {
      // Windows may hold the handle a moment after the stream is destroyed.
      await fs.promises
        .rm(partialPath, { force: true, maxRetries: 5, retryDelay: 50 })
        .catch(() => undefined);
    }
  }
};

// --- Service --------------------------------------------------------------------

const idleDownload = (error = null) => ({
  state: "idle",
  version: null,
  fileName: null,
  receivedBytes: 0,
  totalBytes: 0,
  error,
});

/**
 * Update checks and installer downloads for the main process. The status is
 * kept in memory and pushed to the renderer whenever it changes.
 */
export const createUpdateService = ({
  currentVersion,
  isPackaged = false,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  downloadsDir,
  emit = () => undefined,
  openPath,
  showItemInFolder,
  openExternal,
  now = () => Date.now(),
  logger = console,
}) => {
  const userAgent = `MuroMusic/${currentVersion} (+https://github.com/${UPDATE_REPOSITORY})`;
  let latest = null;
  let lastCheckedAt = null;
  let lastError = null;
  let checkTask = null;
  let download = idleDownload();
  let downloadController = null;
  let downloadedFile = null;
  let lastProgressEmit = 0;

  const installerFor = (release) =>
    release ? selectInstallerAsset(release.assets, platform, arch) : null;

  const status = () => {
    const installer = installerFor(latest);
    return {
      currentVersion,
      automaticChecks: isPackaged,
      checking: checkTask !== null,
      lastCheckedAt: lastCheckedAt === null ? null : new Date(lastCheckedAt).toISOString(),
      error: lastError,
      latest: latest
        ? {
            version: latest.version,
            name: latest.name,
            prerelease: latest.prerelease,
            publishedAt: latest.publishedAt,
            hasInstaller: installer !== null,
            installerName: installer?.name ?? null,
            installerSize: installer?.size ?? null,
          }
        : null,
      updateAvailable: Boolean(latest && isNewerVersion(latest.version, currentVersion)),
      download: { ...download },
    };
  };

  const publish = () => {
    try {
      emit(UPDATE_STATUS_EVENT, status());
    } catch (error) {
      logger.warn?.("Could not report the update status:", error);
    }
  };

  /**
   * Ask GitHub for the newest release. Automatic checks only run in packaged
   * builds and reuse a recent result; failures are reported in the status,
   * never thrown, so the caller decides whether to surface them.
   */
  const check = ({ manual = false } = {}) => {
    if (checkTask) return checkTask;
    if (!manual) {
      if (!isPackaged) return Promise.resolve(status());
      if (lastCheckedAt !== null && !lastError) {
        if (now() - lastCheckedAt < AUTOMATIC_CHECK_MIN_INTERVAL_MS) {
          return Promise.resolve(status());
        }
      }
    }
    checkTask = (async () => {
      try {
        latest = await fetchLatestRelease({ fetchImpl, userAgent });
        lastError = null;
      } catch (error) {
        lastError = error instanceof UpdateError ? error.code : "network";
        logger.warn?.(`Update check failed (${manual ? "manual" : "automatic"}):`, error?.message);
      }
      lastCheckedAt = now();
      checkTask = null;
      publish();
      return status();
    })();
    // Report "checking" right away; the task above is pending until GitHub answers.
    publish();
    return checkTask;
  };

  const reportProgress = (receivedBytes, totalBytes) => {
    download = { ...download, receivedBytes, totalBytes };
    const time = now();
    if (time - lastProgressEmit >= PROGRESS_EVENT_INTERVAL_MS) {
      lastProgressEmit = time;
      publish();
    }
  };

  /**
   * Download the installer of `version`, which must be the release this
   * service last found. Returns once the download has started; progress and
   * the outcome arrive as status events. Without an installer for this
   * platform, the release page is opened instead.
   */
  const startDownload = async (version) => {
    if (download.state === "downloading") return status();
    const release =
      latest && latest.version === String(version) && isNewerVersion(latest.version, currentVersion)
        ? latest
        : null;
    if (!release) {
      download = {
        ...idleDownload(),
        state: "failed",
        version: String(version),
        error: "not-available",
      };
      publish();
      return status();
    }
    const asset = installerFor(release);
    if (!asset) {
      await openExternal(release.htmlUrl);
      return status();
    }
    const controller = new AbortController();
    downloadController = controller;
    downloadedFile = null;
    lastProgressEmit = 0;
    download = {
      state: "downloading",
      version: release.version,
      fileName: asset.name,
      receivedBytes: 0,
      totalBytes: asset.size,
      error: null,
    };
    publish();
    void Promise.resolve()
      .then(() =>
        downloadAsset(asset, {
          fetchImpl,
          userAgent,
          destinationDir: downloadsDir(),
          signal: controller.signal,
          onProgress: reportProgress,
        }),
      )
      .then(({ filePath, bytes }) => {
        downloadedFile = filePath;
        download = {
          ...download,
          state: "completed",
          fileName: path.basename(filePath),
          receivedBytes: bytes,
          totalBytes: bytes,
        };
      })
      .catch((error) => {
        const code = error instanceof UpdateError ? error.code : "network";
        if (code === "cancelled") {
          download = idleDownload();
          return;
        }
        logger.warn?.("Update download failed:", error?.message);
        download = { ...download, state: "failed", error: code };
      })
      .finally(() => {
        if (downloadController === controller) downloadController = null;
        publish();
      });
    return status();
  };

  const cancelDownload = () => {
    downloadController?.abort();
    return status();
  };

  /** The installer this service downloaded, if it is still where it was saved. */
  const downloadedInstaller = async () => {
    if (download.state !== "completed" || !downloadedFile) {
      throw new Error("No update installer has been downloaded");
    }
    if (!(await exists(downloadedFile))) {
      downloadedFile = null;
      download = idleDownload("missing-file");
      publish();
      throw new Error("The downloaded installer was moved or deleted");
    }
    return downloadedFile;
  };

  const openInstaller = async () => {
    const error = await openPath(await downloadedInstaller());
    if (error) throw new Error(error);
  };

  const showInstaller = async () => {
    showItemInFolder(await downloadedInstaller());
  };

  const openReleasePage = async () => {
    await openExternal(latest?.htmlUrl ?? RELEASES_PAGE_URL);
  };

  const dispose = () => {
    downloadController?.abort();
  };

  return {
    status,
    check,
    download: startDownload,
    cancelDownload,
    openInstaller,
    showInstaller,
    openReleasePage,
    dispose,
  };
};
