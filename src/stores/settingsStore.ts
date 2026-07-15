import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isLocale, setLocale as setI18nLocale, type Locale } from "../i18n";

export type AnalysisOutputMode = "none" | "prepend" | "append" | "overwrite";
export type AnalysisNotationMode = "standard" | "custom" | "combined" | "djCombined";
export type AnalysisOutputs = {
  comment: AnalysisOutputMode;
  grouping: AnalysisOutputMode;
  initialKey: AnalysisOutputMode;
  bpm: "none" | "overwrite";
};

const DEFAULT_CUSTOM_CODES = [
  "11B", "8A", "6B", "3A", "1B", "10A", "8B", "5A", "3B", "12A", "10B", "7A",
  "5B", "2A", "12B", "9A", "7B", "4A", "2B", "11A", "9B", "6A", "4B", "1A", "",
];

type SettingsState = {
  theme: string;
  locale: Locale;
  seekMode: "fast" | "accurate";
  dbPath: string;
  dbFileName: string;
  useAutoDbPath: boolean;
  analysisNotation: AnalysisNotationMode;
  analysisCustomCodes: string[];
  analysisDelimiter: string;
  analysisOutputs: AnalysisOutputs;
};

type SettingsActions = {
  setTheme: (theme: string) => void;
  setLocale: (locale: Locale) => void;
  setSeekMode: (mode: "fast" | "accurate") => void;
  setDbPath: (path: string) => void;
  setDbFileName: (name: string) => void;
  setUseAutoDbPath: (auto: boolean) => void;
  setAnalysisNotation: (notation: AnalysisNotationMode) => void;
  setAnalysisCustomCode: (index: number, value: string) => void;
  setAnalysisDelimiter: (delimiter: string) => void;
  setAnalysisOutput: <K extends keyof AnalysisOutputs>(field: K, mode: AnalysisOutputs[K]) => void;
};

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // State
      theme: "studio",
      locale: "en",
      seekMode: "fast",
      dbPath: "",
      dbFileName: "muro.db",
      useAutoDbPath: true,
      analysisNotation: "custom",
      analysisCustomCodes: [...DEFAULT_CUSTOM_CODES],
      analysisDelimiter: " - ",
      analysisOutputs: {
        comment: "none",
        grouping: "none",
        initialKey: "none",
        bpm: "none",
      },

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
      setAnalysisNotation: (analysisNotation) => set({ analysisNotation }),
      setAnalysisCustomCode: (index, value) => set((state) => {
        const analysisCustomCodes = [...state.analysisCustomCodes];
        analysisCustomCodes[index] = value;
        return { analysisCustomCodes };
      }),
      setAnalysisDelimiter: (analysisDelimiter) => set({ analysisDelimiter }),
      setAnalysisOutput: (field, mode) => set((state) => ({
        analysisOutputs: { ...state.analysisOutputs, [field]: mode },
      })),
    }),
    {
      name: "muro-settings",
      partialize: (state) => ({
        theme: state.theme,
        locale: state.locale,
        seekMode: state.seekMode,
        analysisNotation: state.analysisNotation,
        analysisCustomCodes: state.analysisCustomCodes,
        analysisDelimiter: state.analysisDelimiter,
        analysisOutputs: state.analysisOutputs,
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
