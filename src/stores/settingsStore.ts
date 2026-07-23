import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isLocale, setLocale as setI18nLocale, type Locale } from "../i18n";
import type { MixBars } from "../lib/mix/config";

export type AnalysisOutputMode = "none" | "prepend" | "append" | "overwrite";
export type AnalysisNotationMode = "standard" | "custom" | "combined" | "djCombined";
export type AnalysisPerformanceMode = "stable" | "fast" | "maximum";
export type DeleteMode = "library" | "disk";
export type ThemeMode = "system" | "dark" | "light";
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

const DEFAULT_ANALYSIS_OUTPUTS: AnalysisOutputs = {
  comment: "none",
  grouping: "none",
  initialKey: "none",
  bpm: "none",
};

const normalizeThemeMode = (theme: unknown): ThemeMode => {
  if (theme === "system" || theme === "light") return theme;
  return "dark";
};

export const applyThemeMode = (theme: ThemeMode) => {
  if (typeof document === "undefined") return;

  const resolvedTheme = theme === "system"
    && typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";

  document.documentElement.dataset.theme = theme === "system" ? resolvedTheme : theme;
  document.documentElement.style.colorScheme = resolvedTheme;
};

type SettingsState = {
  theme: ThemeMode;
  locale: Locale;
  seekMode: "fast" | "accurate";
  dbPath: string;
  dbFileName: string;
  useAutoDbPath: boolean;
  analysisNotation: AnalysisNotationMode;
  analysisCustomCodes: string[];
  analysisDelimiter: string;
  analysisOutputs: AnalysisOutputs;
  analysisPerformance: AnalysisPerformanceMode;
  lastDeleteMode: DeleteMode;
  djMixEnabled: boolean;
  autoMix: boolean;
  mixBars: MixBars;
  mixPreservePitch: boolean;
  lastFmApiKey: string;
  theAudioDbApiKey: string;
  fanartApiKey: string;
  braveSearchApiKey: string;
  acoustIdClientKey: string;
  audioOutputDeviceId: string;
  audioOutputDeviceLabel: string;
};

type SettingsActions = {
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: Locale) => void;
  setSeekMode: (mode: "fast" | "accurate") => void;
  setDbPath: (path: string) => void;
  setDbFileName: (name: string) => void;
  setUseAutoDbPath: (auto: boolean) => void;
  setAnalysisNotation: (notation: AnalysisNotationMode) => void;
  setAnalysisCustomCode: (index: number, value: string) => void;
  setAnalysisDelimiter: (delimiter: string) => void;
  setAnalysisOutput: <K extends keyof AnalysisOutputs>(field: K, mode: AnalysisOutputs[K]) => void;
  setAnalysisPerformance: (performance: AnalysisPerformanceMode) => void;
  setLastDeleteMode: (mode: DeleteMode) => void;
  setDjMixEnabled: (djMixEnabled: boolean) => void;
  setAutoMix: (autoMix: boolean) => void;
  setMixBars: (mixBars: MixBars) => void;
  setMixPreservePitch: (mixPreservePitch: boolean) => void;
  setLastFmApiKey: (lastFmApiKey: string) => void;
  setTheAudioDbApiKey: (theAudioDbApiKey: string) => void;
  setFanartApiKey: (fanartApiKey: string) => void;
  setBraveSearchApiKey: (braveSearchApiKey: string) => void;
  setAcoustIdClientKey: (acoustIdClientKey: string) => void;
  setAudioOutputDevice: (deviceId: string, label: string) => void;
};

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // State
      theme: "dark",
      locale: "en",
      seekMode: "fast",
      dbPath: "",
      dbFileName: "muro.db",
      useAutoDbPath: true,
      analysisNotation: "custom",
      analysisCustomCodes: [...DEFAULT_CUSTOM_CODES],
      analysisDelimiter: " - ",
      analysisOutputs: { ...DEFAULT_ANALYSIS_OUTPUTS },
      analysisPerformance: "stable",
      lastDeleteMode: "library",
      djMixEnabled: false,
      autoMix: false,
      mixBars: 8,
      mixPreservePitch: true,
      lastFmApiKey: "",
      theAudioDbApiKey: "",
      fanartApiKey: "",
      braveSearchApiKey: "",
      acoustIdClientKey: "",
      audioOutputDeviceId: "",
      audioOutputDeviceLabel: "",

      // Actions
      setTheme: (theme) => {
        set({ theme });
        applyThemeMode(theme);
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
      setAnalysisPerformance: (analysisPerformance) => set({ analysisPerformance }),
      setLastDeleteMode: (lastDeleteMode) => set({ lastDeleteMode }),
      setDjMixEnabled: (djMixEnabled) => set((state) => ({
        djMixEnabled,
        autoMix: djMixEnabled ? state.autoMix : false,
      })),
      setAutoMix: (autoMix) => set({ autoMix }),
      setMixBars: (mixBars) => set({ mixBars }),
      setMixPreservePitch: (mixPreservePitch) => set({ mixPreservePitch }),
      setLastFmApiKey: (lastFmApiKey) => set({ lastFmApiKey }),
      setTheAudioDbApiKey: (theAudioDbApiKey) => set({ theAudioDbApiKey }),
      setFanartApiKey: (fanartApiKey) => set({ fanartApiKey }),
      setBraveSearchApiKey: (braveSearchApiKey) => set({ braveSearchApiKey }),
      setAcoustIdClientKey: (acoustIdClientKey) => set({ acoustIdClientKey }),
      setAudioOutputDevice: (audioOutputDeviceId, audioOutputDeviceLabel) =>
        set({ audioOutputDeviceId, audioOutputDeviceLabel }),
    }),
    {
      name: "muro-settings",
      version: 2,
      partialize: (state) => ({
        theme: state.theme,
        locale: state.locale,
        seekMode: state.seekMode,
        dbPath: state.dbPath,
        dbFileName: state.dbFileName,
        useAutoDbPath: state.useAutoDbPath,
        analysisNotation: state.analysisNotation,
        analysisCustomCodes: state.analysisCustomCodes,
        analysisDelimiter: state.analysisDelimiter,
        analysisOutputs: state.analysisOutputs,
        analysisPerformance: state.analysisPerformance,
        lastDeleteMode: state.lastDeleteMode,
        djMixEnabled: state.djMixEnabled,
        autoMix: state.autoMix,
        mixBars: state.mixBars,
        mixPreservePitch: state.mixPreservePitch,
        lastFmApiKey: state.lastFmApiKey,
        theAudioDbApiKey: state.theAudioDbApiKey,
        fanartApiKey: state.fanartApiKey,
        braveSearchApiKey: state.braveSearchApiKey,
        acoustIdClientKey: state.acoustIdClientKey,
        audioOutputDeviceId: state.audioOutputDeviceId,
        audioOutputDeviceLabel: state.audioOutputDeviceLabel,
      }),
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== "object") return persistedState;
        const persisted = persistedState as Partial<SettingsState>;
        return { ...persisted, theme: normalizeThemeMode(persisted.theme) };
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState && typeof persistedState === "object"
          ? persistedState as Partial<SettingsState>
          : {};
        const savedCustomCodes = Array.isArray(persisted.analysisCustomCodes)
          ? persisted.analysisCustomCodes
          : [];

        return {
          ...currentState,
          ...persisted,
          theme: normalizeThemeMode(persisted.theme),
          // Analysis settings are a nested group. Merge them with their defaults so
          // settings written by older versions cannot discard newer Key/BPM fields.
          analysisCustomCodes: DEFAULT_CUSTOM_CODES.map((fallback, index) =>
            typeof savedCustomCodes[index] === "string"
              ? savedCustomCodes[index]
              : fallback
          ),
          analysisOutputs: {
            ...DEFAULT_ANALYSIS_OUTPUTS,
            ...(persisted.analysisOutputs ?? {}),
          },
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Apply theme on rehydrate
          if (typeof document !== "undefined") {
            applyThemeMode(state.theme);
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
