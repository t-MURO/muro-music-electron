import fs from "node:fs";
import path from "node:path";

// The main process owns the database location. It is persisted in a small JSON
// file in userData so the renderer never has to (and can no longer) name the
// SQLite file every command operates on.

export const DATABASE_CONFIG_FILE_NAME = "muro-config.json";
export const DEFAULT_DATABASE_FILE_NAME = "muro.db";
const CONFIG_VERSION = 1;
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");

export const isSqliteDatabaseFile = (filePath) => {
  let handle;
  try {
    handle = fs.openSync(filePath, "r");
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = fs.readSync(handle, header, 0, header.length, 0);
    return bytesRead === header.length && header.equals(SQLITE_HEADER);
  } catch {
    return false;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
};

const samePath = (left, right) => process.platform === "win32"
  ? path.resolve(left).toLocaleLowerCase() === path.resolve(right).toLocaleLowerCase()
  : path.resolve(left) === path.resolve(right);

export const createDatabaseLocationStore = ({ userDataDir }) => {
  const configDirectory = path.resolve(userDataDir);
  const configPath = path.join(configDirectory, DATABASE_CONFIG_FILE_NAME);
  const defaultPath = path.join(configDirectory, DEFAULT_DATABASE_FILE_NAME);

  const readConfig = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  let config = readConfig();

  const writeConfig = (databasePath) => {
    const next = {
      version: CONFIG_VERSION,
      databasePath: databasePath && !samePath(databasePath, defaultPath)
        ? path.resolve(databasePath)
        : null,
    };
    fs.mkdirSync(configDirectory, { recursive: true });
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, configPath);
    config = next;
  };

  const getDbPath = () => {
    const configured = typeof config?.databasePath === "string"
      ? config.databasePath.trim()
      : "";
    return configured && path.isAbsolute(configured) ? path.resolve(configured) : defaultPath;
  };

  const describe = () => {
    const dbPath = getDbPath();
    return { dbPath, defaultPath, isDefault: samePath(dbPath, defaultPath) };
  };

  return {
    configPath,
    defaultPath,
    getDbPath,
    describe,
    /** True until a location has been recorded by this or a later version. */
    needsMigration: () => config === null,

    /**
     * One-time import of the location older versions kept in renderer
     * settings. Only an existing SQLite database, or a file directly inside
     * userData (the old "database file name" setting), is accepted, and the
     * decision is persisted so the renderer cannot repeat the request later.
     */
    migrateLegacyLocation(legacyDbPath) {
      if (config !== null) return { ...describe(), migrated: false };
      const candidate = typeof legacyDbPath === "string" && path.isAbsolute(legacyDbPath.trim())
        ? path.resolve(legacyDbPath.trim())
        : null;
      const accepted = candidate !== null && (
        samePath(path.dirname(candidate), configDirectory)
        || isSqliteDatabaseFile(candidate)
      );
      writeConfig(accepted ? candidate : null);
      return {
        ...describe(),
        migrated: accepted && !samePath(candidate, defaultPath),
        rejectedLegacyPath: candidate !== null && !accepted ? candidate : null,
      };
    },

    /** Called only with a path the user picked in a main-process dialog. */
    setDbPath(databasePath) {
      if (typeof databasePath !== "string" || !path.isAbsolute(databasePath)) {
        throw new Error("The database location must be an absolute path");
      }
      writeConfig(databasePath);
      return describe();
    },

    resetToDefault() {
      writeConfig(null);
      return describe();
    },
  };
};
