export type BridgeEvent = { payload: unknown };
export type WindowControlAction = "minimize" | "toggleMaximize" | "close";

export type MuroBridge = {
  platform: string;
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  on(event: string, listener: (payload: unknown) => void): () => void;
  appDataDir(): Promise<string>;
  windowControl(action: WindowControlAction): Promise<boolean>;
  isWindowMaximized(): Promise<boolean>;
  openDialog(options: Record<string, unknown>): Promise<string | string[] | null>;
  saveDialog(options: Record<string, unknown>): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(filePath: string): Promise<void>;
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
