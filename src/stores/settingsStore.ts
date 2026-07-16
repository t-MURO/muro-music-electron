import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isLocale, setLocale as setI18nLocale, type Locale } from "../i18n";
import type { MixBars } from "../lib/mix/config";

export type AnalysisOutputMode = "none" | "prepend" | "append" | "overwrite";
export type AnalysisNotationMode = "standard" | "custom" | "combined" | "djCombined";
export type DeleteMode = "library" | "disk";
export type { MixBars } from "../lib/mix/config";
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
  lastDeleteMode: DeleteMode;
  djMixEnabled: boolean;
  autoMix: boolean;
  mixBars: MixBars;
  mixPreservePitch: boolean;
  theAudioDbApiKey: string;
  fanartApiKey: string;
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
  setLastDeleteMode: (mode: DeleteMode) => void;
  setDjMixEnabled: (djMixEnabled: boolean) => void;
  setAutoMix: (autoMix: boolean) => void;
  setMixBars: (mixBars: MixBars) => void;
  setMixPreservePitch: (mixPreservePitch: boolean) => void;
  setTheAudioDbApiKey: (theAudioDbApiKey: string) => void;
  setFanartApiKey: (fanartApiKey: string) => void;
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
      lastDeleteMode: "library",
      djMixEnabled: false,
      autoMix: false,
      mixBars: 8,
      mixPreservePitch: true,
      theAudioDbApiKey: "",
      fanartApiKey: "",

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
      setLastDeleteMode: (lastDeleteMode) => set({ lastDeleteMode }),
      setDjMixEnabled: (djMixEnabled) => set((state) => ({
        djMixEnabled,
        autoMix: djMixEnabled ? state.autoMix : false,
      })),
      setAutoMix: (autoMix) => set({ autoMix }),
      setMixBars: (mixBars) => set({ mixBars }),
      setMixPreservePitch: (mixPreservePitch) => set({ mixPreservePitch }),
      setTheAudioDbApiKey: (theAudioDbApiKey) => set({ theAudioDbApiKey }),
      setFanartApiKey: (fanartApiKey) => set({ fanartApiKey }),
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
        lastDeleteMode: state.lastDeleteMode,
        djMixEnabled: state.djMixEnabled,
        autoMix: state.autoMix,
        mixBars: state.mixBars,
        mixPreservePitch: state.mixPreservePitch,
        theAudioDbApiKey: state.theAudioDbApiKey,
        fanartApiKey: state.fanartApiKey,
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
