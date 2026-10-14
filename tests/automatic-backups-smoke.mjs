import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { strFromU8, unzipSync } from "fflate";
import {
  BACKUP_INTERVALS_MS,
  PRE_MAINTENANCE_RETENTION,
  automaticBackupFileName,
  createAutomaticBackups,
  isBackupDue,
  parseBackupFileName,
  preMaintenanceBackupFileName,
  pruneBackups,
} from "../electron/automaticBackups.mjs";
import { createBackend } from "../electron/backend.mjs";
import { openDatabase } from "../electron/database.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "muro-automatic-backups-"));

const names = (folder) => fs.readdirSync(folder).sort();
const touch = (folder, name) => fs.writeFileSync(path.join(folder, name), "x");

// --- File names ---------------------------------------------------------------
{
  const date = new Date(Date.UTC(2026, 9, 14, 7, 5, 9));
  assert.equal(automaticBackupFileName(date), "muro-auto-20261014-070509.murobackup");
  assert.equal(automaticBackupFileName(date, 2), "muro-auto-20261014-070509-2.murobackup");
  assert.equal(
    preMaintenanceBackupFileName("delete", date),
    "muro-pre-delete-20261014-070509.murobackup",
  );
  assert.throws(() => preMaintenanceBackupFileName("anything", date));
  assert.deepEqual(parseBackupFileName("muro-auto-20261014-070509-2.murobackup"), {
    kind: "automatic",
    action: null,
    createdAt: date.getTime(),
    sequence: 2,
  });
  assert.equal(
    parseBackupFileName("muro-pre-restore-20261014-070509.murobackup").action,
    "restore",
  );
  for (const foreign of [
    "muro-library-2026-10-14.murobackup",
    "muro-auto-20261014-070509.murobackup.partial",
    "muro-auto-20261340-070509.murobackup",
    "muro-auto-20261014-070509.murobackup.bak",
    "muro-auto-20261014-070509.zip",
    "Muro-auto-20261014-070509.murobackup",
    "muro-pre-wipe-20261014-070509.murobackup",
    "x-muro-auto-20261014-070509.murobackup",
  ]) {
    assert.equal(parseBackupFileName(foreign), null, `${foreign} is not an app backup`);
  }
}

// --- Schedule ---------------------------------------------------------------
{
  const now = Date.UTC(2026, 9, 14, 12);
  assert.equal(isBackupDue({ frequency: "off", lastBackupAt: null, now }), false);
  assert.equal(isBackupDue({ frequency: "weekly", lastBackupAt: null, now }), true);
  assert.equal(isBackupDue({ frequency: "weekly", lastBackupAt: now - 6 * DAY, now }), false);
  assert.equal(isBackupDue({ frequency: "weekly", lastBackupAt: now - 7 * DAY, now }), true);
  assert.equal(isBackupDue({ frequency: "daily", lastBackupAt: now - 23 * HOUR, now }), false);
  assert.equal(isBackupDue({ frequency: "daily", lastBackupAt: now - 25 * HOUR, now }), true);
  assert.equal(
    isBackupDue({ frequency: "daily", lastBackupAt: now + 2 * HOUR, now }),
    false,
    "a slightly fast clock does not trigger a backup",
  );
  assert.equal(
    isBackupDue({ frequency: "daily", lastBackupAt: now + 3 * DAY, now }),
    true,
    "a clock turned far back does not suspend backups",
  );
  assert.equal(
    isBackupDue({ frequency: "bogus", lastBackupAt: now - 6 * DAY, now }),
    false,
    "an unknown frequency falls back to weekly",
  );
}

// --- Retention only deletes matching automatic backups -------------------------
{
  const folder = path.join(root, "retention");
  fs.mkdirSync(folder);
  const base = Date.UTC(2026, 0, 1);
  const automatic = Array.from({ length: 7 }, (_, index) =>
    automaticBackupFileName(new Date(base + index * DAY)),
  );
  for (const name of automatic) touch(folder, name);
  const untouchable = [
    "muro-library-2026-01-01.murobackup",
    "notes.txt",
    "muro-auto-20250101-000000.murobackup.partial",
    "muro-auto-20250101-000000.murobackup.bak",
    preMaintenanceBackupFileName("delete", new Date(base - DAY)),
  ];
  for (const name of untouchable) touch(folder, name);
  // A directory that looks like a backup is not a file the app created.
  fs.mkdirSync(path.join(folder, "muro-auto-20240101-000000.murobackup"));

  const deleted = await pruneBackups(folder, { kind: "automatic", keep: 5 });
  assert.deepEqual(deleted.sort(), automatic.slice(0, 2).sort(), "only the two oldest go");
  assert.deepEqual(
    names(folder),
    [...automatic.slice(2), ...untouchable, "muro-auto-20240101-000000.murobackup"].sort(),
  );
  assert.ok(fs.statSync(path.join(folder, "muro-auto-20240101-000000.murobackup")).isDirectory());
}

// --- Scheduled runs with a controllable clock ---------------------------------
{
  const userDataDir = path.join(root, "scheduler");
  let clock = Date.UTC(2026, 9, 1, 9);
  const written = [];
  const scheduler = createAutomaticBackups({
    userDataDir,
    getDbPath: () => path.join(userDataDir, "muro.db"),
    now: () => clock,
    createBackup: async ({ destinationPath, settingsJson }) => {
      written.push({ destinationPath, settingsJson });
      fs.writeFileSync(destinationPath, "backup");
      return { destinationPath, manifest: {}, bytes: 6 };
    },
  });
  const folder = path.join(userDataDir, "backups");

  const initial = await scheduler.status();
  assert.equal(initial.frequency, "weekly", "weekly by default");
  assert.equal(initial.retention, 5, "keep five by default");
  assert.equal(initial.folder, folder, "the default folder is owned by the main process");
  assert.equal(initial.lastAutomaticBackupAt, null);

  await scheduler.setSchedule({ frequency: "daily", retention: 2 });
  assert.throws(() => scheduler.setSchedule({ frequency: "hourly" }), /Unsupported/);
  assert.equal((await scheduler.status()).retention, 2);
  assert.equal(
    (await scheduler.setSchedule({ retention: 10_000 })).retention,
    50,
    "retention is clamped by the main process",
  );
  await scheduler.setSchedule({ retention: 2 });
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(userDataDir, "muro-backups.json"), "utf8")),
    { version: 1, frequency: "daily", retention: 2, folder: null },
    "the schedule is persisted next to the other main-process config",
  );

  fs.mkdirSync(folder, { recursive: true });
  touch(folder, "my-manual.murobackup");

  const first = await scheduler.runScheduled({ settingsJson: "{}" });
  assert.equal(first.created, true, "the first check backs up immediately");
  assert.equal(path.basename(first.backup.destinationPath), "muro-auto-20261001-090000.murobackup");
  assert.ok(
    written[0].destinationPath.endsWith(".partial"),
    "the archive is written under a name retention ignores, then renamed",
  );
  assert.equal(first.status.lastAutomaticBackupAt, new Date(clock).toISOString());

  clock += HOUR;
  assert.equal((await scheduler.runScheduled({})).created, false, "not due after an hour");

  clock += DAY;
  assert.equal((await scheduler.runScheduled({})).created, true, "due after a day");
  clock += DAY;
  const third = await scheduler.runScheduled({});
  assert.equal(third.created, true);
  assert.deepEqual(third.pruned, ["muro-auto-20261001-090000.murobackup"]);
  assert.deepEqual(names(folder), [
    "muro-auto-20261002-100000.murobackup",
    "muro-auto-20261003-100000.murobackup",
    "my-manual.murobackup",
  ]);

  // "Back up now" in the same second gets a distinct, still-matching name.
  const forcedA = scheduler.runScheduled({ force: true });
  const forcedB = scheduler.runScheduled({ force: true });
  const [resultA, resultB] = await Promise.all([forcedA, forcedB]);
  assert.equal(resultA.backup.fileName, "muro-auto-20261003-100000-1.murobackup");
  assert.equal(resultB.backup.fileName, "muro-auto-20261003-100000-2.murobackup");
  assert.equal(names(folder).filter((name) => name.startsWith("muro-auto-")).length, 2);
  assert.ok(fs.existsSync(path.join(folder, "my-manual.murobackup")), "manual backups stay");

  await scheduler.setSchedule({ frequency: "off" });
  clock += 30 * DAY;
  assert.equal((await scheduler.runScheduled({})).created, false, "off never backs up");

  // A failed write leaves no partial file and no new backup behind.
  const failing = createAutomaticBackups({
    userDataDir,
    getDbPath: () => path.join(userDataDir, "muro.db"),
    now: () => clock,
    createBackup: async ({ destinationPath }) => {
      fs.writeFileSync(destinationPath, "half");
      throw new Error("disk full");
    },
  });
  await failing.setSchedule({ frequency: "daily" });
  await assert.rejects(failing.runScheduled({}), /disk full/);
  assert.equal(
    names(folder).some((name) => name.endsWith(".partial")),
    false,
  );
  assert.equal(BACKUP_INTERVALS_MS.daily, DAY);
}

// --- Backend: real archives, safety snapshots, refusal on failure -------------
{
  const userDataDir = path.join(root, "backend");
  const covers = path.join(userDataDir, "covers");
  const dbPath = path.join(userDataDir, "muro.db");
  const backupsFolder = path.join(userDataDir, "backups");
  const outside = path.join(root, "outside");
  fs.mkdirSync(covers, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const backend = createBackend({
    dbPath,
    cacheDir: covers,
    userDataDir,
    emit: () => {},
    keyFinder: { close: () => {} },
  });
  const settingsJson = JSON.stringify({
    state: { theme: "dark", lastFmApiKey: "secret-key", watchedFolder: root },
    version: 4,
  });
  const smartCratesJson = JSON.stringify({ state: { smartCrates: [] }, version: 0 });
  const insertTrack = (id, sourcePath) => {
    const now = Math.floor(Date.now() / 1000);
    openDatabase(dbPath)
      .prepare(
        `
      INSERT INTO tracks(
        id, title, artist, album, filename, source_path, import_status, added_at, updated_at
      ) VALUES (?, ?, 'Artist', 'Album', ?, ?, 'accepted', ?, ?)
    `,
      )
      .run(id, `Title ${id}`, path.basename(sourcePath), sourcePath, now, now);
  };
  const readArchive = (archivePath) => unzipSync(new Uint8Array(fs.readFileSync(archivePath)));
  const archivedTrackIds = (archivePath) => {
    const snapshotPath = path.join(root, `check-${Date.now()}-${Math.random()}.db`);
    fs.writeFileSync(snapshotPath, Buffer.from(readArchive(archivePath)["database/muro.db"]));
    const db = new Database(snapshotPath, { readonly: true });
    try {
      return db
        .prepare("SELECT id FROM tracks ORDER BY id")
        .all()
        .map((row) => row.id);
    } finally {
      db.close();
    }
  };
  const backupsOfKind = (prefix) =>
    names(backupsFolder).filter((name) => name.startsWith(prefix) && name.endsWith(".murobackup"));

  try {
    const doomedPath = path.join(userDataDir, "doomed.mp3");
    fs.writeFileSync(doomedPath, "audio");
    insertTrack("doomed", doomedPath);

    // The renderer cannot redirect where automatic backups go.
    const scheduled = await backend.invoke("run_scheduled_backup", {
      settingsJson,
      smartCratesJson,
      destinationPath: path.join(outside, "evil.murobackup"),
      folder: outside,
    });
    assert.equal(scheduled.created, true);
    assert.equal(path.dirname(scheduled.backup.destinationPath), backupsFolder);
    assert.deepEqual(names(outside), []);
    const settingsEntry = strFromU8(
      readArchive(scheduled.backup.destinationPath)["settings/muro-settings.json"],
    );
    assert.match(settingsEntry, /"theme":"dark"/);
    assert.doesNotMatch(settingsEntry, /secret-key/, "API keys are stripped as in manual backups");
    assert.doesNotMatch(settingsEntry, /watchedFolder/);
    assert.equal(
      (await backend.invoke("run_scheduled_backup", { settingsJson, smartCratesJson })).created,
      false,
      "the default weekly schedule is not due again right away",
    );
    await assert.rejects(
      backend.invoke("set_backup_schedule", { frequency: "constantly" }),
      /Unsupported backup frequency/,
    );
    const status = await backend.invoke("get_backup_status");
    assert.equal(status.folder, backupsFolder);
    assert.ok(status.lastAutomaticBackupAt);

    // Removing a track from the library only does not need a safety snapshot.
    const keptPath = path.join(userDataDir, "kept.mp3");
    fs.writeFileSync(keptPath, "audio");
    insertTrack("kept", keptPath);
    await backend.invoke("delete_tracks", { trackIds: ["kept"], deleteFromDisk: false });
    assert.deepEqual(backupsOfKind("muro-pre-"), []);

    // Deleting from disk snapshots the library first, track included.
    const deleted = await backend.invoke("delete_tracks", {
      trackIds: ["doomed"],
      deleteFromDisk: true,
      backupState: { settingsJson, smartCratesJson },
    });
    assert.deepEqual(deleted.deletedTrackIds, ["doomed"]);
    assert.equal(fs.existsSync(doomedPath), false);
    const [deleteSnapshot] = backupsOfKind("muro-pre-delete-");
    assert.ok(deleteSnapshot, "a pre-delete snapshot was written");
    assert.deepEqual(archivedTrackIds(path.join(backupsFolder, deleteSnapshot)), ["doomed"]);
    assert.doesNotMatch(
      strFromU8(
        readArchive(path.join(backupsFolder, deleteSnapshot))["settings/muro-settings.json"],
      ),
      /secret-key/,
    );

    // Restoring snapshots the current state before replacing it.
    const manualBackup = path.join(outside, "manual.murobackup");
    backend.pathAccess.grantDialogSelection({ paths: [manualBackup], save: true });
    await backend.invoke("create_library_backup", {
      destinationPath: manualBackup,
      settingsJson,
      smartCratesJson,
    });
    const survivorPath = path.join(userDataDir, "survivor.mp3");
    fs.writeFileSync(survivorPath, "audio");
    insertTrack("survivor", survivorPath);
    await backend.invoke("restore_library_backup", {
      archivePath: manualBackup,
      backupState: { settingsJson, smartCratesJson },
    });
    const [restoreSnapshot] = backupsOfKind("muro-pre-restore-");
    assert.ok(restoreSnapshot, "a pre-restore snapshot was written");
    assert.deepEqual(
      archivedTrackIds(path.join(backupsFolder, restoreSnapshot)),
      ["survivor"],
      "the snapshot holds the state the restore replaced",
    );
    assert.equal(
      openDatabase(dbPath).prepare("SELECT 1 FROM tracks WHERE id = 'survivor'").get(),
      undefined,
    );
    assert.ok(fs.existsSync(manualBackup), "manual backups elsewhere are never pruned");

    // Repairing the library structure (moves files) is protected too.
    const libraryRoot = path.join(userDataDir, "Library");
    const misplacedPath = path.join(libraryRoot, "Wrong", "song.mp3");
    fs.mkdirSync(path.dirname(misplacedPath), { recursive: true });
    fs.writeFileSync(misplacedPath, "audio");
    insertTrack("misplaced", misplacedPath);
    backend.pathAccess.grantDialogSelection({ paths: [libraryRoot], directory: true });
    await backend.invoke("repair_library_structure", {
      libraryRoot,
      trackIds: ["misplaced"],
      backupState: { settingsJson, smartCratesJson },
    });
    assert.equal(backupsOfKind("muro-pre-organize-").length, 1);

    // Safety snapshots have their own small cap.
    for (let index = 0; index < PRE_MAINTENANCE_RETENTION + 2; index += 1) {
      const extraPath = path.join(userDataDir, `extra-${index}.mp3`);
      fs.writeFileSync(extraPath, "audio");
      insertTrack(`extra-${index}`, extraPath);
      await backend.invoke("delete_tracks", {
        trackIds: [`extra-${index}`],
        deleteFromDisk: true,
      });
    }
    assert.equal(backupsOfKind("muro-pre-").length, PRE_MAINTENANCE_RETENTION);
    assert.equal(backupsOfKind("muro-auto-").length, 1, "automatic backups are pruned separately");

    // When the safety snapshot cannot be written, nothing is deleted.
    const customFolder = path.join(root, "removable-drive");
    fs.mkdirSync(customFolder);
    assert.equal((await backend.backups.setFolder(customFolder)).isDefaultFolder, false);
    fs.rmSync(customFolder, { recursive: true });
    const protectedPath = path.join(userDataDir, "protected.mp3");
    fs.writeFileSync(protectedPath, "audio");
    insertTrack("protected", protectedPath);
    await assert.rejects(
      backend.invoke("delete_tracks", {
        trackIds: ["protected"],
        deleteFromDisk: true,
        backupState: { settingsJson, smartCratesJson },
      }),
      /^Error: SAFETY_BACKUP_FAILED: The backup folder is not available/,
    );
    assert.ok(fs.existsSync(protectedPath), "the file survives a refused delete");
    assert.ok(openDatabase(dbPath).prepare("SELECT 1 FROM tracks WHERE id = 'protected'").get());
    assert.equal(fs.existsSync(customFolder), false, "a missing chosen folder is not recreated");
    await assert.rejects(
      backend.invoke("run_scheduled_backup", { force: true }),
      /backup folder is not available/,
    );
    assert.equal((await backend.backups.resetFolder()).folder, backupsFolder);

    console.log("Automatic backups smoke test passed");
  } finally {
    backend.close();
  }
}

fs.rmSync(root, { recursive: true, force: true });
