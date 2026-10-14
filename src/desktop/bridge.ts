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
  clipboardHasImage(): Promise<boolean>;
  cacheClipboardCoverArt(): Promise<{ fullPath: string; thumbPath: string } | null>;
  copyImageToClipboard(filePath: string): Promise<boolean>;
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
