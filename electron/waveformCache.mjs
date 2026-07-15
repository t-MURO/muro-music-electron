import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const cacheVersion = 1;

export const normalizeWaveformPoints = (points) =>
  Math.max(32, Math.min(1024, Number(points) || 512));

const normalizeSourcePath = (sourcePath) => {
  const resolved = path.resolve(String(sourcePath));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const sourceKey = (sourcePath) => crypto
  .createHash("sha256")
  .update(normalizeSourcePath(sourcePath))
  .digest("hex");

const isValidPeaks = (peaks) =>
  Array.isArray(peaks) && peaks.every((peak) => Number.isFinite(peak));

const matchesSource = (record, metadata, points) =>
  record?.version === cacheVersion &&
  record.points === points &&
  record.sourceSize === metadata.size &&
  record.sourceMtimeMs === metadata.mtimeMs &&
  isValidPeaks(record.peaks);

export const createWaveformCache = ({ cacheDir }) => {
  const inFlight = new Map();

  const cachePath = (sourcePath, points) =>
    path.join(cacheDir, `${sourceKey(sourcePath)}-${points}.json`);

  const read = async (filePath, metadata, points) => {
    try {
      const record = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
      return matchesSource(record, metadata, points) ? { peaks: record.peaks } : null;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        console.warn(`Could not read waveform cache ${filePath}:`, error);
      }
      return null;
    }
  };

  const write = async (filePath, record) => {
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.writeFile(temporaryPath, JSON.stringify(record));
      await fs.promises.rm(filePath, { force: true });
      await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
      console.warn(`Could not write waveform cache ${filePath}:`, error);
    }
  };

  return {
    async getOrCreate(sourcePath, requestedPoints, generate) {
      const points = normalizeWaveformPoints(requestedPoints);
      const metadata = await fs.promises.stat(sourcePath);
      if (!metadata.isFile()) throw new Error(`Waveform source is not a file: ${sourcePath}`);

      const filePath = cachePath(sourcePath, points);
      const cached = await read(filePath, metadata, points);
      if (cached) return cached;

      const requestKey = `${filePath}:${metadata.size}:${metadata.mtimeMs}`;
      if (inFlight.has(requestKey)) return inFlight.get(requestKey);

      const pending = (async () => {
        const result = await generate(points);
        const peaks = result?.peaks;
        if (!isValidPeaks(peaks)) throw new Error("Waveform generator returned invalid peaks");
        await write(filePath, {
          version: cacheVersion,
          points,
          sourceSize: metadata.size,
          sourceMtimeMs: metadata.mtimeMs,
          peaks,
        });
        return { peaks };
      })();
      inFlight.set(requestKey, pending);
      try {
        return await pending;
      } finally {
        inFlight.delete(requestKey);
      }
    },

    async invalidateSource(sourcePath) {
      const prefix = `${sourceKey(sourcePath)}-`;
      let entries;
      try {
        entries = await fs.promises.readdir(cacheDir);
      } catch (error) {
        if (error?.code === "ENOENT") return;
        throw error;
      }
      await Promise.all(entries
        .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".json"))
        .map((entry) => fs.promises.rm(path.join(cacheDir, entry), { force: true })));
    },

    async clear() {
      await fs.promises.rm(cacheDir, { recursive: true, force: true });
    },
  };
};
