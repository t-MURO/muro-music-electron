import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isLocale, setLocale as setI18nLocale, type Locale } from "../i18n";

type SettingsState = {
  theme: string;
  locale: Locale;
  seekMode: "fast" | "accurate";
  dbPath: string;
  dbFileName: string;
  useAutoDbPath: boolean;
};

type SettingsActions = {
  setTheme: (theme: string) => void;
  setLocale: (locale: Locale) => void;
  setSeekMode: (mode: "fast" | "accurate") => void;
  setDbPath: (path: string) => void;
  setDbFileName: (name: string) => void;
  setUseAutoDbPath: (auto: boolean) => void;
};

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // State
      theme: "light",
      locale: "en",
      seekMode: "fast",
      dbPath: "",
      dbFileName: "muro.db",
      useAutoDbPath: true,

      // Actions
      setTheme: (theme) => {
        set({ theme });
        if (typeof document !== "undefined") {
          document.documentElement.dataset.theme = theme;
        }
      },
      setLocale: (locale) => {
        set({ locale });
        setI18nLocale(locale);
      },
      setSeekMode: (seekMode) => set({ seekMode }),
      setDbPath: (dbPath) => set({ dbPath, useAutoDbPath: false }),
      setDbFileName: (dbFileName) => set({ dbFileName, useAutoDbPath: true }),
      setUseAutoDbPath: (useAutoDbPath) => set({ useAutoDbPath }),
    }),
    {
      name: "muro-settings",
      partialize: (state) => ({
        theme: state.theme,
        locale: state.locale,
        seekMode: state.seekMode,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Apply theme on rehydrate
          if (typeof document !== "undefined") {
            document.documentElement.dataset.theme = state.theme;
          }
          // Apply locale on rehydrate
          if (isLocale(state.locale)) {
            setI18nLocale(state.locale);
          }
        }
      },
    }
  )
);
