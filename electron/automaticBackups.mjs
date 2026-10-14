import fs from "node:fs";
import path from "node:path";
import { createLibraryBackup } from "./dataArchive.mjs";

// Automatic and pre-maintenance backups go to a folder the main process owns:
// <userData>/backups unless the user picked another one in a main-process
// dialog. The schedule and folder are persisted here, never taken from the
// renderer per call. Retention only ever deletes files whose names match the
// patterns below, so manual backups and unrelated files in the same folder
// are left alone.

export const BACKUP_CONFIG_FILE_NAME = "muro-backups.json";
export const DEFAULT_BACKUP_FOLDER_NAME = "backups";
export const DEFAULT_BACKUP_FREQUENCY = "weekly";
export const DEFAULT_BACKUP_RETENTION = 5;
export const MAX_BACKUP_RETENTION = 50;
/** Safety snapshots are taken often, so they get their own small cap. */
export const PRE_MAINTENANCE_RETENTION = 3;
export const PRE_MAINTENANCE_ACTIONS = ["restore", "organize", "delete"];
export const SAFETY_BACKUP_FAILED = "SAFETY_BACKUP_FAILED";

const CONFIG_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
export const BACKUP_INTERVALS_MS = { off: 0, daily: DAY_MS, weekly: 7 * DAY_MS };
const MAX_NAME_SEQUENCE = 999;
const BACKUP_EXTENSION = ".murobackup";
const PARTIAL_SUFFIX = ".partial";

// Timestamps in file names are UTC so they sort and parse the same way on
// every machine and across daylight-saving changes.
const AUTOMATIC_BACKUP_PATTERN = /^muro-auto-(\d{8})-(\d{6})(?:-(\d{1,3}))?\.murobackup$/;
const PRE_MAINTENANCE_PATTERN = new RegExp(
  `^muro-pre-(${PRE_MAINTENANCE_ACTIONS.join("|")})-(\\d{8})-(\\d{6})(?:-(\\d{1,3}))?\\.murobackup$`,
);

const pad = (value, length = 2) => String(value).padStart(length, "0");

const formatTimestamp = (date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
  `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;

const parseTimestamp = (day, time) => {
  const parts = [
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  ];
  const value = Date.UTC(...parts);
  // Reject names like 20261340 that Date.UTC would silently roll over.
  return Number.isFinite(value) && formatTimestamp(new Date(value)) === `${day}-${time}`
    ? value
    : null;
};

const withSequence = (base, sequence) =>
  `${base}${sequence > 0 ? `-${sequence}` : ""}${BACKUP_EXTENSION}`;

export const automaticBackupFileName = (date, sequence = 0) =>
  withSequence(`muro-auto-${formatTimestamp(date)}`, sequence);

export const preMaintenanceBackupFileName = (action, date, sequence = 0) => {
  if (!PRE_MAINTENANCE_ACTIONS.includes(action)) {
    throw new Error(`Unknown maintenance action: ${action}`);
  }
  return withSequence(`muro-pre-${action}-${formatTimestamp(date)}`, sequence);
};

/** The kind and creation time of an app-created backup, or null for anything else. */
export const parseBackupFileName = (name) => {
  if (typeof name !== "string") return null;
  const automatic = AUTOMATIC_BACKUP_PATTERN.exec(name);
  if (automatic) {
    const createdAt = parseTimestamp(automatic[1], automatic[2]);
    return createdAt === null
      ? null
      : { kind: "automatic", action: null, createdAt, sequence: Number(automatic[3] ?? 0) };
  }
  const pre = PRE_MAINTENANCE_PATTERN.exec(name);
  if (pre) {
    const createdAt = parseTimestamp(pre[2], pre[3]);
    return createdAt === null
      ? null
      : { kind: "pre-maintenance", action: pre[1], createdAt, sequence: Number(pre[4] ?? 0) };
  }
  return null;
};

export const normalizeBackupFrequency = (value) =>
  Object.hasOwn(BACKUP_INTERVALS_MS, value) ? value : DEFAULT_BACKUP_FREQUENCY;

export const normalizeBackupRetention = (value) => {
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count) || count < 1) return DEFAULT_BACKUP_RETENTION;
  return Math.min(count, MAX_BACKUP_RETENTION);
};

/**
 * Whether an automatic backup should be written now. A newest backup far in
 * the future means the clock was turned back; backing up again is safer than
 * waiting for the clock to catch up.
 */
export const isBackupDue = ({ frequency, lastBackupAt, now }) => {
  const interval = BACKUP_INTERVALS_MS[normalizeBackupFrequency(frequency)];
  if (!interval) return false;
  if (lastBackupAt == null) return true;
  const elapsed = now - lastBackupAt;
  return elapsed >= interval || elapsed < -interval;
};

/** App-created backups directly inside a folder, newest first. */
export const listBackupFiles = async (folder) => {
  let entries;
  try {
    entries = await fs.promises.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const parsed = parseBackupFileName(entry.name);
      return parsed ? { ...parsed, name: entry.name, path: path.join(folder, entry.name) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.createdAt - left.createdAt || right.sequence - left.sequence);
};

/**
 * Delete the oldest backups of one kind beyond `keep` (at least one is always
 * kept, so the backup just written survives). Returns the deleted names.
 */
export const pruneBackups = async (folder, { kind, keep }) => {
  const matching = (await listBackupFiles(folder)).filter((backup) => backup.kind === kind);
  const deleted = [];
  for (const backup of matching.slice(Math.max(1, Math.trunc(Number(keep)) || 1))) {
    try {
      await fs.promises.unlink(backup.path);
      deleted.push(backup.name);
    } catch (error) {
      if (error?.code !== "ENOENT")
        console.warn(`Failed to remove old backup ${backup.path}`, error);
    }
  }
  return deleted;
};

export const createAutomaticBackups = ({
  userDataDir,
  getDbPath,
  createBackup = createLibraryBackup,
  now = () => Date.now(),
}) => {
  const configDirectory = path.resolve(userDataDir);
  const configPath = path.join(configDirectory, BACKUP_CONFIG_FILE_NAME);
  const defaultFolder = path.join(configDirectory, DEFAULT_BACKUP_FOLDER_NAME);

  const readConfig = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  let config = readConfig();

  const writeConfig = (changes) => {
    const next = {
      version: CONFIG_VERSION,
      frequency: normalizeBackupFrequency(changes.frequency ?? config.frequency),
      retention: normalizeBackupRetention(changes.retention ?? config.retention),
      folder: Object.hasOwn(changes, "folder") ? changes.folder : (config.folder ?? null),
    };
    fs.mkdirSync(configDirectory, { recursive: true });
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, configPath);
    config = next;
  };

  const customFolder = () => {
    const configured = typeof config.folder === "string" ? config.folder.trim() : "";
    return configured && path.isAbsolute(configured) ? path.resolve(configured) : null;
  };
  const folder = () => customFolder() ?? defaultFolder;

  const ensureFolder = async () => {
    const target = folder();
    if (customFolder()) {
      // A chosen folder on an unplugged drive must fail loudly rather than be
      // recreated somewhere the user would not look.
      const stats = await fs.promises.stat(target).catch(() => null);
      if (!stats?.isDirectory()) throw new Error(`The backup folder is not available: ${target}`);
    } else {
      await fs.promises.mkdir(target, { recursive: true });
    }
    return target;
  };

  const status = async () => {
    const frequency = normalizeBackupFrequency(config.frequency);
    const backups = await listBackupFiles(folder()).catch(() => []);
    const lastAutomatic = backups.find((backup) => backup.kind === "automatic") ?? null;
    const lastPreMaintenance = backups.find((backup) => backup.kind === "pre-maintenance") ?? null;
    const interval = BACKUP_INTERVALS_MS[frequency];
    return {
      frequency,
      retention: normalizeBackupRetention(config.retention),
      preMaintenanceRetention: PRE_MAINTENANCE_RETENTION,
      folder: folder(),
      defaultFolder,
      isDefaultFolder: customFolder() === null,
      lastAutomaticBackupAt: lastAutomatic ? new Date(lastAutomatic.createdAt).toISOString() : null,
      lastPreMaintenanceBackupAt: lastPreMaintenance
        ? new Date(lastPreMaintenance.createdAt).toISOString()
        : null,
      nextAutomaticBackupAt:
        interval && lastAutomatic
          ? new Date(lastAutomatic.createdAt + interval).toISOString()
          : null,
    };
  };

  // Every write goes through one queue so a scheduled run, "Back up now" and
  // a safety snapshot never pick the same file name or prune concurrently.
  let queue = Promise.resolve();
  const enqueue = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const writeBackup = async (nameFor, { settingsJson, smartCratesJson }) => {
    const target = await ensureFolder();
    const date = new Date(now());
    let name = null;
    for (let sequence = 0; sequence <= MAX_NAME_SEQUENCE; sequence += 1) {
      const candidate = nameFor(date, sequence);
      if (
        !fs.existsSync(path.join(target, candidate)) &&
        !fs.existsSync(path.join(target, `${candidate}${PARTIAL_SUFFIX}`))
      ) {
        name = candidate;
        break;
      }
    }
    if (!name) throw new Error("Too many backups were created in the same second");
    const destinationPath = path.join(target, name);
    // Write under a name retention does not match, then rename, so an
    // interrupted backup never counts as the newest good one.
    const partialPath = `${destinationPath}${PARTIAL_SUFFIX}`;
    try {
      const result = await createBackup({
        dbPath: getDbPath(),
        destinationPath: partialPath,
        settingsJson,
        smartCratesJson,
      });
      await fs.promises.rename(partialPath, destinationPath);
      return { ...result, destinationPath, fileName: name };
    } catch (error) {
      await fs.promises.rm(partialPath, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  return {
    folder,
    defaultFolder,
    status,

    setSchedule({ frequency, retention } = {}) {
      if (frequency !== undefined && !Object.hasOwn(BACKUP_INTERVALS_MS, frequency)) {
        throw new Error("Unsupported backup frequency");
      }
      writeConfig({ frequency, retention });
      return status();
    },

    /** Called only with a folder the user picked in a main-process dialog. */
    setFolder(folderPath) {
      if (typeof folderPath !== "string" || !path.isAbsolute(folderPath)) {
        throw new Error("The backup folder must be an absolute path");
      }
      const resolved = path.resolve(folderPath);
      if (!fs.statSync(resolved).isDirectory()) throw new Error("Choose a folder for backups");
      fs.accessSync(resolved, fs.constants.W_OK);
      writeConfig({ folder: resolved });
      return status();
    },

    resetFolder() {
      writeConfig({ folder: null });
      return status();
    },

    /** Ensure the folder exists (for "Open backups folder") and return it. */
    prepareFolder: () => ensureFolder(),

    /**
     * Write an automatic backup when one is due (or `force` is set), then
     * prune automatic backups beyond the retention count.
     */
    runScheduled({ settingsJson, smartCratesJson, force = false } = {}) {
      return enqueue(async () => {
        const before = await status();
        const due =
          force ||
          isBackupDue({
            frequency: before.frequency,
            lastBackupAt: before.lastAutomaticBackupAt
              ? Date.parse(before.lastAutomaticBackupAt)
              : null,
            now: now(),
          });
        if (!due) return { created: false, backup: null, pruned: [], status: before };
        const backup = await writeBackup(automaticBackupFileName, {
          settingsJson,
          smartCratesJson,
        });
        const pruned = await pruneBackups(folder(), {
          kind: "automatic",
          keep: before.retention,
        });
        return { created: true, backup, pruned, status: await status() };
      });
    },

    /** A safety backup before restore, organize or delete-from-disk. */
    createPreMaintenanceSnapshot(action, { settingsJson, smartCratesJson } = {}) {
      return enqueue(async () => {
        const backup = await writeBackup(
          (date, sequence) => preMaintenanceBackupFileName(action, date, sequence),
          { settingsJson, smartCratesJson },
        );
        const pruned = await pruneBackups(folder(), {
          kind: "pre-maintenance",
          keep: PRE_MAINTENANCE_RETENTION,
        });
        return { backup, pruned };
      });
    },
  };
};
