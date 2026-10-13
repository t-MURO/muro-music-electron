import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabaseLocationStore } from "../electron/databaseLocation.mjs";
import { createPathAccess, PATH_ACCESS_DENIED } from "../electron/pathAccess.mjs";
import { createTrustedRendererUrlCheck } from "../electron/rendererSecurity.mjs";

const productionPath = path.resolve("/Applications/Muro/dist/index.html");
const productionCheck = createTrustedRendererUrlCheck({
  productionRendererPath: productionPath,
});
assert.equal(productionCheck(pathToFileURL(productionPath).toString()), true);
assert.equal(productionCheck(`${pathToFileURL(productionPath)}#/settings`), true);
assert.equal(
  productionCheck(pathToFileURL(path.resolve(productionPath, "../other.html")).toString()),
  false,
);
assert.equal(productionCheck("https://example.com"), false);
assert.equal(productionCheck("not a URL"), false);

const developmentCheck = createTrustedRendererUrlCheck({
  developmentUrl: "http://localhost:5173/",
  productionRendererPath: productionPath,
});
assert.equal(developmentCheck("http://localhost:5173/#/settings"), true);
assert.equal(developmentCheck("http://localhost:5173/another-path"), true);
assert.equal(developmentCheck("http://127.0.0.1:5173/"), false);
assert.equal(developmentCheck("https://localhost:5173/"), false);

// Path grants: what a dialog returned is usable, nothing else.
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "muro-security-"));
try {
  const pickedFile = path.join(temporaryDirectory, "picked", "song.mp3");
  const pickedFolder = path.join(temporaryDirectory, "export");
  const savedFile = path.join(temporaryDirectory, "saved", "list.m3u8");
  const access = createPathAccess();
  assert.equal(access.canRead(pickedFile), false);
  access.grantDialogSelection({ paths: [pickedFile] });
  assert.equal(access.canRead(pickedFile), true);
  assert.equal(access.canWrite(pickedFile), false, "an opened file is read-only");
  assert.equal(access.canRead(path.join(path.dirname(pickedFile), "other.mp3")), false);
  access.grantDialogSelection({ paths: [pickedFolder], directory: true });
  assert.equal(access.canWrite(path.join(pickedFolder, "Muro Library", "a.mp3")), true);
  assert.equal(access.canWrite(`${pickedFolder}-sibling`), false);
  assert.equal(
    access.canRead(path.join(pickedFolder, "..", "picked", "other.mp3")),
    false,
    "dot segments are resolved before matching",
  );
  access.grantDialogSelection({ paths: [savedFile], save: true });
  assert.equal(access.canWrite(savedFile), true);
  assert.equal(access.canWrite(path.join(path.dirname(savedFile), "other.m3u8")), false);
  assert.equal(access.canRead("relative/song.mp3"), false);
  assert.equal(access.canRead(`${pickedFile}\0.mp3`), false);
  assert.equal(access.canRead(42), false);
  assert.throws(() => access.assertWritable(pickedFile, "file"), { code: PATH_ACCESS_DENIED });
  if (process.platform === "win32") {
    assert.equal(
      access.canRead(pickedFile.toUpperCase()),
      true,
      "Windows paths compare case-insensitively",
    );
    assert.equal(
      access.canRead(`\\\\?\\${pickedFile}`),
      false,
      "device namespace paths are refused",
    );
  }

  // The database location lives in a main-process config file in userData.
  const userDataDir = path.join(temporaryDirectory, "userData");
  const legacyDatabase = path.join(temporaryDirectory, "custom", "library.db");
  fs.mkdirSync(path.dirname(legacyDatabase), { recursive: true });
  fs.writeFileSync(
    legacyDatabase,
    Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(84)]),
  );

  const freshInstall = createDatabaseLocationStore({ userDataDir });
  assert.equal(freshInstall.needsMigration(), true);
  assert.equal(freshInstall.getDbPath(), path.join(userDataDir, "muro.db"));
  const migrated = freshInstall.migrateLegacyLocation(legacyDatabase);
  assert.equal(migrated.dbPath, legacyDatabase, "an existing custom database is kept");
  assert.equal(migrated.migrated, true);
  assert.equal(freshInstall.needsMigration(), false);
  assert.equal(
    freshInstall.migrateLegacyLocation(path.join(temporaryDirectory, "other.db")).dbPath,
    legacyDatabase,
    "migration is one-time",
  );
  assert.equal(
    createDatabaseLocationStore({ userDataDir }).getDbPath(),
    legacyDatabase,
    "the location persists across restarts",
  );

  const rejectingDir = path.join(temporaryDirectory, "userData-rejecting");
  const notADatabase = path.join(temporaryDirectory, "custom", "notes.txt");
  fs.writeFileSync(notADatabase, "not sqlite");
  const rejecting = createDatabaseLocationStore({ userDataDir: rejectingDir });
  const rejected = rejecting.migrateLegacyLocation(notADatabase);
  assert.equal(rejected.dbPath, path.join(rejectingDir, "muro.db"));
  assert.equal(rejected.rejectedLegacyPath, notADatabase);
  assert.equal(
    createDatabaseLocationStore({
      userDataDir: path.join(temporaryDirectory, "userData-new"),
    }).migrateLegacyLocation(path.join(temporaryDirectory, "nowhere", "new.db")).isDefault,
    true,
    "a non-existent path outside userData is not created",
  );
  const renamedDir = path.join(temporaryDirectory, "userData-renamed");
  assert.equal(
    createDatabaseLocationStore({ userDataDir: renamedDir }).migrateLegacyLocation(
      path.join(renamedDir, "muro-dev.db"),
    ).dbPath,
    path.join(renamedDir, "muro-dev.db"),
    "the old in-userData file name setting is honoured",
  );

  assert.equal(freshInstall.resetToDefault().isDefault, true);
  assert.equal(
    createDatabaseLocationStore({ userDataDir }).getDbPath(),
    path.join(userDataDir, "muro.db"),
  );
  assert.throws(() => freshInstall.setDbPath("relative.db"));
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Renderer security smoke test passed.");
