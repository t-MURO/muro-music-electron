import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ACOUSTID_LOOKUP_URL = "https://api.acoustid.org/v2/lookup";
const CLIENT_KEY_PATTERN = /^[a-z0-9_-]{6,128}$/i;
const LOOKUP_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const cleanText = (value) => String(value ?? "").trim();
const serviceErrorMessage = (payload, fallback) => {
  const message = cleanText(payload?.error?.message);
  if (/invalid api key/i.test(message)) {
    return "AcoustID rejected this application API key. The personal user API key from your profile cannot be used for lookups; create or copy a key from My Applications.";
  }
  return message || fallback;
};
const cleanId = (value) => /^[0-9a-f-]{36}$/i.test(cleanText(value)) ? cleanText(value) : null;
const normalized = (value) => cleanText(value).toLocaleLowerCase();
const artistCredit = (value) => (Array.isArray(value) ? value : [])
  .map((artist) => cleanText(artist?.name))
  .filter(Boolean)
  .join(", ");
const yearFromDate = (value) => {
  const year = Number(cleanText(value).slice(0, 4));
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null;
};

export const resolveFpcalcBinary = ({ directories = [], platform = process.platform } = {}) => {
  const executableName = platform === "win32" ? "fpcalc.exe" : "fpcalc";
  const candidates = [
    process.env.FPCALC_PATH,
    ...directories.map((directory) => path.join(directory, executableName)),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? executableName;
};

export const fingerprintAudioFile = async (sourcePath, {
  executablePath = resolveFpcalcBinary(),
  timeoutMs = 180_000,
} = {}) => {
  try {
    const { stdout } = await execFileAsync(
      executablePath,
      ["-json", "-length", "120", sourcePath],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: timeoutMs, windowsHide: true },
    );
    const payload = JSON.parse(stdout);
    const duration = Math.round(Number(payload.duration));
    const fingerprint = cleanText(payload.fingerprint);
    if (!Number.isFinite(duration) || duration <= 0 || !fingerprint) {
      throw new Error("fpcalc returned an empty fingerprint");
    }
    return { duration, fingerprint };
  } catch (error) {
    const code = error?.code === "ENOENT" ? " The fpcalc runtime is missing." : "";
    throw new Error(`Could not fingerprint ${path.basename(sourcePath)}.${code} ${error instanceof Error ? error.message : error}`.trim());
  }
};

const candidateFromRelease = ({ result, recording, release, releaseGroup, track }) => {
  const recordingId = cleanId(recording?.id);
  if (!recordingId) return null;
  const releaseId = cleanId(release?.id);
  const releaseGroupId = cleanId(release?.releasegroup?.id ?? releaseGroup?.id);
  const title = cleanText(recording?.title);
  const artist = artistCredit(recording?.artists);
  const album = cleanText(release?.title ?? releaseGroup?.title);
  const albumArtist = artistCredit(release?.artists ?? releaseGroup?.artists) || artist;
  if (!title && !artist) return null;
  return {
    id: `${cleanText(result?.id)}:${recordingId}:${releaseId ?? releaseGroupId ?? "recording"}`,
    acoustidId: cleanText(result?.id),
    score: Math.max(0, Math.min(1, Number(result?.score) || 0)),
    recordingId,
    releaseId,
    releaseGroupId,
    title,
    artist,
    album,
    albumArtist,
    year: yearFromDate(release?.date ?? releaseGroup?.firstreleasedate),
    country: cleanText(release?.country) || null,
    status: cleanText(release?.status) || null,
    genre: null,
    albumMatch: Boolean(album && normalized(album) === normalized(track.album)),
  };
};

export const parseAcoustIdCandidates = (payload, track = {}) => {
  if (payload?.status !== "ok") {
    throw new Error(serviceErrorMessage(payload, "AcoustID returned an invalid response"));
  }
  const candidates = [];
  for (const result of Array.isArray(payload.results) ? payload.results : []) {
    for (const recording of Array.isArray(result?.recordings) ? result.recordings : []) {
      const releases = Array.isArray(recording?.releases) ? recording.releases : [];
      const releaseGroups = Array.isArray(recording?.releasegroups) ? recording.releasegroups : [];
      if (releases.length > 0) {
        for (const release of releases) {
          const candidate = candidateFromRelease({ result, recording, release, releaseGroup: null, track });
          if (candidate) candidates.push(candidate);
        }
      } else if (releaseGroups.length > 0) {
        for (const releaseGroup of releaseGroups) {
          const candidate = candidateFromRelease({ result, recording, release: null, releaseGroup, track });
          if (candidate) candidates.push(candidate);
        }
      } else {
        const candidate = candidateFromRelease({ result, recording, release: null, releaseGroup: null, track });
        if (candidate) candidates.push(candidate);
      }
    }
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.recordingId}:${candidate.releaseId ?? candidate.releaseGroupId ?? ""}`;
    const existing = unique.get(key);
    if (!existing || candidate.score > existing.score) unique.set(key, candidate);
  }
  return [...unique.values()].sort((left, right) => (
    Number(right.albumMatch) - Number(left.albumMatch)
    || right.score - left.score
    || left.title.localeCompare(right.title)
  ));
};

export const createAcoustIdService = ({
  binaryDirectories = [],
  fetchImpl = globalThis.fetch,
  fingerprintFileImpl,
  now = () => Date.now(),
  requestIntervalMs = 350,
} = {}) => {
  const executablePath = resolveFpcalcBinary({ directories: binaryDirectories });
  const createFingerprint = fingerprintFileImpl
    ?? ((sourcePath) => fingerprintAudioFile(sourcePath, { executablePath }));
  let requestQueue = Promise.resolve();
  let nextRequestAt = 0;

  const lookup = (clientKey, fingerprint) => {
    const run = requestQueue.then(async () => {
      const waitMs = Math.max(0, nextRequestAt - now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      nextRequestAt = now() + requestIntervalMs;
      const body = new URLSearchParams({
        client: clientKey,
        duration: String(fingerprint.duration),
        fingerprint: fingerprint.fingerprint,
        meta: "recordings releases releasegroups",
        format: "json",
      });
      let response;
      try {
        response = await fetchImpl(ACOUSTID_LOOKUP_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "MuroMusicElectron/0.1.0",
          },
          body,
          signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
            ? AbortSignal.timeout(20_000)
            : undefined,
        });
      } catch (error) {
        throw new Error(`AcoustID is temporarily unreachable. ${error instanceof Error ? error.message : error}`);
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(serviceErrorMessage(payload, `AcoustID lookup failed (${response.status})`));
      }
      return payload;
    });
    requestQueue = run.catch(() => undefined);
    return run;
  };

  return {
    async identifyTrack(db, { trackId, clientKey, force = false } = {}) {
      const normalizedClientKey = cleanText(clientKey);
      if (!CLIENT_KEY_PATTERN.test(normalizedClientKey)) {
        throw new Error("Add a valid AcoustID application key in Settings first");
      }
      const track = db.prepare(`
        SELECT id, source_path, title, artist, album FROM tracks WHERE id = ?
      `).get(cleanText(trackId));
      if (!track) throw new Error("Track was not found in the library");
      const stat = await fs.promises.stat(track.source_path);
      const cached = db.prepare(`
        SELECT source_mtime_ms, source_size, duration_seconds, fingerprint,
          result_json, looked_up_at
        FROM acoustid_fingerprints WHERE track_id = ?
      `).get(track.id);
      const sourceMatches = cached
        && Number(cached.source_mtime_ms) === stat.mtimeMs
        && Number(cached.source_size) === stat.size;
      const cacheFresh = sourceMatches
        && cached.result_json != null
        && Number(cached.looked_up_at || 0) * 1_000 >= now() - LOOKUP_CACHE_TTL_MS;
      if (!force && cacheFresh) {
        return {
          trackId: track.id,
          cached: true,
          duration: Number(cached.duration_seconds),
          candidates: JSON.parse(cached.result_json),
        };
      }

      const fingerprint = sourceMatches && cached.fingerprint
        ? { duration: Number(cached.duration_seconds), fingerprint: cached.fingerprint }
        : await createFingerprint(track.source_path);
      const timestamp = Math.floor(now() / 1_000);
      db.prepare(`
        INSERT INTO acoustid_fingerprints(
          track_id, source_mtime_ms, source_size, duration_seconds, fingerprint,
          result_json, looked_up_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(track_id) DO UPDATE SET
          source_mtime_ms = excluded.source_mtime_ms,
          source_size = excluded.source_size,
          duration_seconds = excluded.duration_seconds,
          fingerprint = excluded.fingerprint,
          result_json = CASE
            WHEN acoustid_fingerprints.source_mtime_ms = excluded.source_mtime_ms
              AND acoustid_fingerprints.source_size = excluded.source_size
            THEN acoustid_fingerprints.result_json ELSE NULL END,
          looked_up_at = CASE
            WHEN acoustid_fingerprints.source_mtime_ms = excluded.source_mtime_ms
              AND acoustid_fingerprints.source_size = excluded.source_size
            THEN acoustid_fingerprints.looked_up_at ELSE NULL END,
          updated_at = excluded.updated_at
      `).run(track.id, stat.mtimeMs, stat.size, fingerprint.duration, fingerprint.fingerprint, timestamp);

      const payload = await lookup(normalizedClientKey, fingerprint);
      const candidates = parseAcoustIdCandidates(payload, track);
      db.prepare(`
        UPDATE acoustid_fingerprints
        SET result_json = ?, looked_up_at = ?, updated_at = ?
        WHERE track_id = ?
      `).run(JSON.stringify(candidates), timestamp, timestamp, track.id);
      return { trackId: track.id, cached: false, duration: fingerprint.duration, candidates };
    },
  };
};
