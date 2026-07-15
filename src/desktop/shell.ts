import { bridge } from "./bridge";

export const openExternal = (url: string): Promise<void> => bridge().openExternal(url);
