export type BridgeEvent = { payload: unknown };

export type MuroBridge = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  on(event: string, listener: (payload: unknown) => void): () => void;
  appDataDir(): Promise<string>;
  openDialog(options: Record<string, unknown>): Promise<string | string[] | null>;
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
