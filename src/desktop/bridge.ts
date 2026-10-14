export type BridgeEvent = { payload: unknown };
export type WindowControlAction = "minimize" | "toggleMaximize" | "close";
export type DatabaseLocation = {
  dbPath: string;
  defaultPath: string;
  isDefault: boolean;
};

export type BackupFrequency = "off" | "daily" | "weekly";
export type BackupStatus = {
  frequency: BackupFrequency;
  retention: number;
  preMaintenanceRetention: number;
  folder: string;
  defaultFolder: string;
  isDefaultFolder: boolean;
  lastAutomaticBackupAt: string | null;
  lastPreMaintenanceBackupAt: string | null;
  nextAutomaticBackupAt: string | null;
};

export type UpdateCheckError = "network" | "timeout" | "rate-limited" | "http" | "invalid-response";
export type UpdateDownloadError =
  | "not-available"
  | "network"
  | "timeout"
  | "http"
  | "size-mismatch"
  | "digest-mismatch"
  | "write-failed"
  | "invalid-response"
  | "missing-file";
export type UpdateStatus = {
  currentVersion: string;
  /** False in development builds, which only check when asked to. */
  automaticChecks: boolean;
  checking: boolean;
  lastCheckedAt: string | null;
  error: UpdateCheckError | null;
  latest: {
    version: string;
    name: string;
    prerelease: boolean;
    publishedAt: string | null;
    /** Whether the release has an installer for this platform and architecture. */
    hasInstaller: boolean;
    installerName: string | null;
    installerSize: number | null;
  } | null;
  updateAvailable: boolean;
  download: {
    state: "idle" | "downloading" | "completed" | "failed";
    version: string | null;
    fileName: string | null;
    receivedBytes: number;
    totalBytes: number;
    error: UpdateDownloadError | null;
  };
};

export type MuroBridge = {
  platform: string;
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  on(event: string, listener: (payload: unknown) => void): () => void;
  appDataDir(): Promise<string>;
  databaseLocation(): Promise<DatabaseLocation>;
  chooseDatabaseLocation(options: { mode: "open" | "create" }): Promise<DatabaseLocation | null>;
  resetDatabaseLocation(): Promise<DatabaseLocation | null>;
  chooseBackupFolder(): Promise<BackupStatus | null>;
  resetBackupFolder(): Promise<BackupStatus>;
  openBackupFolder(): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(options: { manual: boolean }): Promise<UpdateStatus>;
  downloadUpdate(version: string): Promise<UpdateStatus>;
  cancelUpdateDownload(): Promise<UpdateStatus>;
  openUpdateInstaller(): Promise<void>;
  showUpdateInstaller(): Promise<void>;
  openUpdateReleasePage(): Promise<void>;
  clipboardHasImage(): Promise<boolean>;
  cacheClipboardCoverArt(): Promise<{ fullPath: string; thumbPath: string } | null>;
  copyImageToClipboard(filePath: string): Promise<boolean>;
  copyTextToClipboard(text: string): Promise<boolean>;
  windowControl(action: WindowControlAction): Promise<boolean>;
  isWindowMaximized(): Promise<boolean>;
  openDialog(options: Record<string, unknown>): Promise<string | string[] | null>;
  saveDialog(options: Record<string, unknown>): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(filePath: string): Promise<void>;
  startFileDrag(filePaths: string[]): void;
  confirmDialog(message: string, options?: Record<string, unknown>): Promise<boolean>;
};

declare global {
  interface Window {
    muro?: MuroBridge;
  }
}

export const bridge = (): MuroBridge => {
  if (!window.muro) {
    throw new Error("The Muro desktop bridge is unavailable");
  }
  return window.muro;
};
