import fs from "node:fs";
import path from "node:path";
import {
  configureLibraryRoot,
  openDatabase,
  resolveTrackPath,
} from "./database.mjs";
import { AUDIO_EXTENSIONS, collectAudioPaths, importAudioFile } from "./metadata.mjs";

/**
 * How long a path must sit quiet before it is considered ready. A file copied
 * onto the disk generates a burst of change events while it is still partial,
 * and importing it mid-copy would read truncated tags.
 */
const SETTLE_DELAY_MS = 1_500;
/** Upper bound on waiting for a large file to finish copying. */
const MAX_SETTLE_MS = 120_000;
const SETTLE_POLL_MS = 500;

const isAudioPath = (candidate) =>
  AUDIO_EXTENSIONS.has(path.extname(candidate).toLowerCase());

const comparablePath = (candidate) => {
  const resolved = path.resolve(String(candidate));
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
};

/**
 * Resolve once the file has stopped growing, or null if it never settles,
 * disappears again, or is not readable.
 */
const waitForStableFile = async (filePath, { signal } = {}) => {
  const deadline = Date.now() + MAX_SETTLE_MS;
  let lastSize = -1;
  let lastMtime = -1;
  let stableFor = 0;

  while (Date.now() < deadline) {
    if (signal?.aborted) return null;

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return null; // Removed again before it settled.
    }
    if (!stat.isFile()) return null;

    if (stat.size === lastSize && stat.mtimeMs === lastMtime && stat.size > 0) {
      stableFor += SETTLE_POLL_MS;
      if (stableFor >= SETTLE_DELAY_MS) return filePath;
    } else {
      stableFor = 0;
      lastSize = stat.size;
      lastMtime = stat.mtimeMs;
    }

    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
  return null;
};

/**
 * Watches folders and stages any new audio that appears into the Inbox.
 *
 * Imports land in the Inbox rather than the library proper: a watcher firing on
 * a half-organized download folder should not silently reshape the collection.
 */
export const createLibraryWatcher = ({
  cacheDir,
  emit,
  getSender,
  watch = fs.watch,
}) => {
  /** directory -> fs.FSWatcher */
  const watchers = new Map();
  /** Paths seen but not yet imported, so a burst of events imports once. */
  const pendingPaths = new Set();
  let currentDbPath = null;
  let enabled = false;
  let abortController = new AbortController();

  const notify = (name, payload) => {
    const sender = getSender?.();
    if (sender && !sender.isDestroyed?.()) {
      emit(sender, name, payload);
    }
  };

  const importSettledPath = async (filePath) => {
    if (!currentDbPath) return;
    try {
      const settled = await waitForStableFile(filePath, { signal: abortController.signal });
      if (!settled || abortController.signal.aborted) return;

      // importAudioFile returns null when the path is already known, so a
      // re-fired event on an existing track is a no-op.
      const imported = await importAudioFile(currentDbPath, settled, cacheDir);
      if (imported) {
        notify("muro://watched-folder-import", { track: imported, sourcePath: settled });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Watched-folder import failed for ${filePath}:`, message);
      notify("muro://watched-folder-error", { sourcePath: filePath, message });
    } finally {
      pendingPaths.delete(filePath);
    }
  };

  const queuePath = (filePath) => {
    if (!enabled || pendingPaths.has(filePath) || !isAudioPath(filePath)) return;
    pendingPaths.add(filePath);
    void importSettledPath(filePath);
  };

  const queueDirectory = async (directory) => {
    const dbPath = currentDbPath;
    if (!enabled || !dbPath || !watchers.has(directory)) return;
    try {
      const paths = await collectAudioPaths([directory]);
      if (!enabled || currentDbPath !== dbPath || !watchers.has(directory)) return;
      const knownPaths = new Set(
        openDatabase(dbPath).prepare("SELECT source_path FROM tracks").all()
          .flatMap((row) => {
            try {
              return [comparablePath(resolveTrackPath(dbPath, row.source_path))];
            } catch {
              return [];
            }
          }),
      );
      paths
        .filter((filePath) => !knownPaths.has(comparablePath(filePath)))
        .forEach(queuePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not rescan watched folder ${directory}:`, message);
      notify("muro://watched-folder-error", { sourcePath: directory, message });
    }
  };

  const watchDirectory = (directory) => {
    if (watchers.has(directory)) return;
    try {
      const watcher = watch(directory, { recursive: true }, (_eventType, filename) => {
        if (!filename) {
          void queueDirectory(directory);
          return;
        }
        queuePath(path.resolve(directory, filename.toString()));
      });
      watcher.on("error", (error) => {
        // A vanished or unreadable folder should drop out quietly rather than
        // crash the main process.
        console.warn(`Stopped watching ${directory}:`, error.message);
        watchers.delete(directory);
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
      });
      watchers.set(directory, watcher);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not watch ${directory}:`, message);
      notify("muro://watched-folder-error", { sourcePath: directory, message });
    }
  };

  const stopAll = () => {
    abortController.abort();
    abortController = new AbortController();
    for (const watcher of watchers.values()) {
      try {
        watcher.close();
      } catch {
        // Already closed.
      }
    }
    watchers.clear();
    pendingPaths.clear();
  };

  return {
    /**
     * Replace the watched set. Folders that are already watched keep their
     * existing watcher so an unrelated settings change does not restart them.
     */
    setFolders({ dbPath, folders, isEnabled }) {
      currentDbPath = dbPath ?? currentDbPath;
      const requestedRoot = Array.isArray(folders) ? folders[0] : null;
      if (currentDbPath && requestedRoot) {
        configureLibraryRoot(currentDbPath, requestedRoot);
      }
      enabled = Boolean(isEnabled);

      if (!enabled) {
        stopAll();
        return { watching: [] };
      }

      const wanted = new Set(
        (Array.isArray(folders) ? folders : [])
          .map((folder) => path.resolve(String(folder)))
          .filter((folder) => {
            try {
              return fs.statSync(folder).isDirectory();
            } catch {
              return false;
            }
          }),
      );

      for (const [directory, watcher] of watchers) {
        if (wanted.has(directory)) continue;
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
        watchers.delete(directory);
      }
      for (const directory of wanted) watchDirectory(directory);

      return { watching: [...watchers.keys()] };
    },

    /**
     * One-off sweep of the watched folders. fs.watch only reports changes made
     * while it is running, so anything added while the app was closed is picked
     * up here.
     */
    async scanNow({ dbPath, folders }) {
      const target = dbPath ?? currentDbPath;
      if (!target) return { imported: 0, scanned: 0 };

      const directories = (Array.isArray(folders) ? folders : [...watchers.keys()])
        .map((folder) => path.resolve(String(folder)));
      if (directories.length === 0) return { imported: 0, scanned: 0 };
      configureLibraryRoot(target, directories[0]);

      const paths = await collectAudioPaths(directories);
      let imported = 0;
      for (const filePath of paths) {
        try {
          const track = await importAudioFile(target, filePath, cacheDir);
          if (track) {
            imported += 1;
            notify("muro://watched-folder-import", { track, sourcePath: filePath });
          }
        } catch (error) {
          console.warn(`Watched-folder scan failed for ${filePath}:`, error);
        }
      }
      return { imported, scanned: paths.length };
    },

    status() {
      return { enabled, watching: [...watchers.keys()], pending: pendingPaths.size };
    },

    close: stopAll,
  };
};
