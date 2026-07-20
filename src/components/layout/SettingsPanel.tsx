import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { t, type Locale } from "../../i18n";
import { openExternal } from "../../desktop/shell";
import { MIX_BAR_OPTIONS } from "../../lib/mix/config";
import {
  useSettingsStore,
  type AnalysisNotationMode,
  type AnalysisOutputMode,
  type AnalysisOutputs,
  type MixBars,
} from "../../stores";

type SettingsPanelProps = {
  theme: string;
  locale: Locale;
  themes: ReadonlyArray<{ id: string; label: string }>;
  localeOptions: ReadonlyArray<{ id: string; label: string }>;
  dbPath: string;
  dbFileName: string;
  backfillPending: boolean;
  backfillStatus: string | null;
  coverArtBackfillPending: boolean;
  coverArtBackfillStatus: string | null;
  clearSongsPending: boolean;
  seekMode: "fast" | "accurate";
  onThemeChange: (theme: string) => void;
  onLocaleChange: (locale: Locale) => void;
  onSeekModeChange: (mode: "fast" | "accurate") => void;
  onDbPathChange: (value: string) => void;
  onDbFileNameChange: (value: string) => void;
  onBackfillSearchText: () => void;
  onBackfillCoverArt: () => void;
  onClearSongs: () => void;
  onUseDefaultLocation: () => void;
};

type Tab = "dev" | "application" | "analysis" | "theme";

const themeDescriptions: Record<string, { label: string; description: string }> = {
  "light": { label: "Light", description: "Polished, spacious design with light colors" },
  "dark": { label: "Dark", description: "Polished, spacious design with dark colors" },
  "compact-light": { label: "Compact Light", description: "Dense layout for power users, light mode" },
  "compact-dark": { label: "Compact Dark", description: "Dense layout for power users, dark mode" },
  "terminal": { label: "Terminal", description: "Monospace terminal theme" },
  "compact-terminal": { label: "Compact Terminal", description: "Dense monospace terminal theme" },
  "bw-terminal": { label: "B&W Terminal", description: "Monospace black and white terminal" },
  "compact-bw-terminal": { label: "Compact B&W Terminal", description: "Dense black and white terminal" },
};

const KEY_NAMES = [
  "A", "Am", "Bb", "Bbm", "B", "Bm", "C", "Cm", "Db", "Dbm", "D", "Dm",
  "Eb", "Ebm", "E", "Em", "F", "Fm", "Gb", "Gbm", "G", "Gm", "Ab", "Abm", "Unknown",
];

const ANALYSIS_OUTPUT_FIELDS: Array<{
  field: keyof AnalysisOutputs;
  label: string;
  bpmOnly?: boolean;
}> = [
  { field: "comment", label: "Comment" },
  { field: "grouping", label: "Grouping / custom field" },
  { field: "initialKey", label: "Initial Key" },
  { field: "bpm", label: "Detected BPM", bpmOnly: true },
];

export const SettingsPanel = ({
  theme,
  locale,
  themes,
  localeOptions,
  dbPath,
  dbFileName,
  backfillPending,
  backfillStatus,
  coverArtBackfillPending,
  coverArtBackfillStatus,
  clearSongsPending,
  seekMode,
  onThemeChange,
  onLocaleChange,
  onSeekModeChange,
  onDbPathChange,
  onDbFileNameChange,
  onBackfillSearchText,
  onBackfillCoverArt,
  onClearSongs,
  onUseDefaultLocation,
}: SettingsPanelProps) => {
  const [activeTab, setActiveTab] = useState<Tab>("application");
  const analysisNotation = useSettingsStore((state) => state.analysisNotation);
  const analysisCustomCodes = useSettingsStore((state) => state.analysisCustomCodes);
  const analysisDelimiter = useSettingsStore((state) => state.analysisDelimiter);
  const analysisOutputs = useSettingsStore((state) => state.analysisOutputs);
  const analysisPerformance = useSettingsStore((state) => state.analysisPerformance);
  const setAnalysisNotation = useSettingsStore((state) => state.setAnalysisNotation);
  const setAnalysisCustomCode = useSettingsStore((state) => state.setAnalysisCustomCode);
  const setAnalysisDelimiter = useSettingsStore((state) => state.setAnalysisDelimiter);
  const setAnalysisOutput = useSettingsStore((state) => state.setAnalysisOutput);
  const setAnalysisPerformance = useSettingsStore((state) => state.setAnalysisPerformance);
  const djMixEnabled = useSettingsStore((state) => state.djMixEnabled);
  const autoMix = useSettingsStore((state) => state.autoMix);
  const mixBars = useSettingsStore((state) => state.mixBars);
  const mixPreservePitch = useSettingsStore((state) => state.mixPreservePitch);
  const setDjMixEnabled = useSettingsStore((state) => state.setDjMixEnabled);
  const setAutoMix = useSettingsStore((state) => state.setAutoMix);
  const setMixBars = useSettingsStore((state) => state.setMixBars);
  const setMixPreservePitch = useSettingsStore((state) => state.setMixPreservePitch);
  const lastFmApiKey = useSettingsStore((state) => state.lastFmApiKey);
  const setLastFmApiKey = useSettingsStore((state) => state.setLastFmApiKey);
  const theAudioDbApiKey = useSettingsStore((state) => state.theAudioDbApiKey);
  const setTheAudioDbApiKey = useSettingsStore((state) => state.setTheAudioDbApiKey);
  const fanartApiKey = useSettingsStore((state) => state.fanartApiKey);
  const setFanartApiKey = useSettingsStore((state) => state.setFanartApiKey);
  const writesAudioTags = Object.values(analysisOutputs).some((mode) => mode !== "none");

  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border-light)] px-[var(--spacing-lg)]">
        <button
          className={`px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
            activeTab === "dev"
              ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => setActiveTab("dev")}
          type="button"
          data-settings-tab="dev"
        >
          Dev
        </button>
        <button
          className={`px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
            activeTab === "application"
              ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => setActiveTab("application")}
          type="button"
          data-settings-tab="application"
        >
          Application
        </button>
        <button
          className={`px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
            activeTab === "analysis"
              ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => setActiveTab("analysis")}
          type="button"
          data-settings-tab="analysis"
        >
          Key Analysis
        </button>
        <button
          className={`px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
            activeTab === "theme"
              ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => setActiveTab("theme")}
          type="button"
        >
          Theme
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-[var(--spacing-lg)]">
        {activeTab === "dev" && (
          <div className="space-y-8">
            <div>
              <h3 className="mb-[var(--spacing-md)] text-[var(--font-size-sm)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Songs
              </h3>
              <div className="space-y-3">
                <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                  Clear the song tables for a clean slate during development.
                </p>
                <button
                  className="flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={onClearSongs}
                  disabled={clearSongsPending}
                  type="button"
                >
                  {clearSongsPending ? "Clearing..." : "Empty song database"}
                </button>
              </div>
            </div>

            <div data-developer-features>
              <h3 className="mb-[var(--spacing-md)] text-[var(--font-size-sm)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Experimental features
              </h3>
              <div className="max-w-xl space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-[var(--spacing-lg)]">
                <label className="flex items-center gap-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={djMixEnabled}
                    onChange={(event) => setDjMixEnabled(event.target.checked)}
                    data-dj-mix-feature-toggle
                  />
                  Enable experimental DJ mixing
                </label>
                <p className="text-[var(--font-size-xs)] leading-relaxed text-[var(--color-text-secondary)]">
                  Adds beat-grid analysis, manual two-track mixes, and optional automatic transitions.
                  Keep it disabled if you only want Mix Next recommendations without audio transitions.
                </p>

                {djMixEnabled && (
                  <div className="space-y-4 border-t border-[var(--color-border)] pt-4" data-dj-mix-settings>
                    <label className="flex items-center gap-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                      <input
                        type="checkbox"
                        checked={autoMix}
                        onChange={(event) => setAutoMix(event.target.checked)}
                        data-mix-auto
                      />
                      Auto-mix into next track
                    </label>
                    <p className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                      Blends the end of the playing track into the next queued track.
                    </p>

                    <div>
                      <label className="mb-2 block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                        Transition length
                      </label>
                      <div className="relative w-64">
                        <select
                          className="h-[var(--input-height)] w-full appearance-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] pr-10 text-[var(--font-size-sm)] text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
                          onChange={(event) => setMixBars(Number(event.target.value) as MixBars)}
                          value={mixBars}
                          data-mix-bars
                        >
                          {MIX_BAR_OPTIONS.map((bars) => (
                            <option key={bars} value={bars}>{bars} bars</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                      </div>
                    </div>

                    <label className="flex items-center gap-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                      <input
                        type="checkbox"
                        checked={mixPreservePitch}
                        onChange={(event) => setMixPreservePitch(event.target.checked)}
                        data-mix-preserve-pitch
                      />
                      Keep pitch constant
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {(activeTab === "application" || activeTab === "analysis") && (
          <div className="space-y-8">
            {activeTab === "application" && (
              <>
            {/* Language Section */}
            <div>
              <h3 className="mb-[var(--spacing-md)] text-[var(--font-size-sm)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t("settings.language")}
              </h3>
              <div className="space-y-3">
                <label className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                  Language
                </label>
                <div className="relative w-64">
                  <select
                    className="h-[var(--input-height)] w-full appearance-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] pr-10 text-[var(--font-size-sm)] text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
                    onChange={(event) => onLocaleChange(event.target.value as Locale)}
                    value={locale}
                  >
                    {localeOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                </div>
                <p className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                  {t("settings.language.help")}
                </p>
              </div>
            </div>

            <div>
              <h3 className="mb-[var(--spacing-md)] text-[var(--font-size-sm)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Playback
              </h3>
              <div className="space-y-3">
                <label className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                  Seek Mode
                </label>
                <div className="relative w-64">
                  <select
                    className="h-[var(--input-height)] w-full appearance-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] pr-10 text-[var(--font-size-sm)] text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
                    onChange={(event) =>
                      onSeekModeChange(event.target.value as "fast" | "accurate")
                    }
                    value={seekMode}
                  >
                    <option value="fast">Fast (Recommended)</option>
                    <option value="accurate">Accurate</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                </div>
                <p className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                  Fast seeking is snappier but can be slightly less precise on some formats.
                </p>
              </div>
            </div>

            <div data-artist-information-settings>
              <h3 className="mb-[var(--spacing-md)] text-[var(--font-size-sm)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Artist information
              </h3>
              <div className="max-w-xl space-y-5">
                <div className="space-y-3">
                  <label className="block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]" htmlFor="lastfm-api-key">
                    Last.fm API key
                  </label>
                  <input
                    autoComplete="off"
                    className="h-[var(--input-height)] w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
                    data-lastfm-api-key
                    id="lastfm-api-key"
                    onChange={(event) => setLastFmApiKey(event.target.value.trim())}
                    placeholder="Paste your Last.fm API key"
                    spellCheck={false}
                    type="password"
                    value={lastFmApiKey}
                  />
                  <p className="text-[var(--font-size-xs)] leading-relaxed text-[var(--color-text-secondary)]">
                    Adds artist biographies, tags, profile links, and similar artists. Last.fm
                    artwork is not used. The key stays in this app's local settings.
                  </p>
                  <button
                    className="inline-flex items-center gap-1.5 text-[var(--font-size-xs)] font-medium text-[var(--color-accent)] hover:underline"
                    onClick={() => { void openExternal("https://www.last.fm/api/account/create"); }}
                    type="button"
                  >
                    Create a Last.fm API key <ExternalLink className="h-3 w-3" />
                  </button>
                </div>

                <div className="space-y-3 border-t border-[var(--color-border)] pt-5">
                  <label className="block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]" htmlFor="theaudiodb-api-key">
                    TheAudioDB Premium API key
                  </label>
                  <input
                    autoComplete="off"
                    className="h-[var(--input-height)] w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
                    data-theaudiodb-api-key
                    id="theaudiodb-api-key"
                    onChange={(event) => setTheAudioDbApiKey(event.target.value.trim())}
                    placeholder="Paste your Premium API key"
                    spellCheck={false}
                    type="password"
                    value={theAudioDbApiKey}
                  />
                  <p className="text-[var(--font-size-xs)] leading-relaxed text-[var(--color-text-secondary)]">
                    Uses the Premium V2 API to fill missing artist biographies, genres, countries,
                    and artwork. The key stays in this app's local settings.
                  </p>
                  <button
                    className="inline-flex items-center gap-1.5 text-[var(--font-size-xs)] font-medium text-[var(--color-accent)] hover:underline"
                    onClick={() => { void openExternal("https://www.theaudiodb.com/free_music_api"); }}
                    type="button"
                  >
                    TheAudioDB API details <ExternalLink className="h-3 w-3" />
                  </button>
                </div>

                <div className="space-y-3 border-t border-[var(--color-border)] pt-5">
                  <label className="block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]" htmlFor="fanart-api-key">
                    Fanart.tv project API key
                  </label>
                  <input
                    autoComplete="off"
                    className="h-[var(--input-height)] w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
                    data-fanart-api-key
                    id="fanart-api-key"
                    onChange={(event) => setFanartApiKey(event.target.value.trim())}
                    placeholder="Optional fallback"
                    spellCheck={false}
                    type="password"
                    value={fanartApiKey}
                  />
                  <p className="text-[var(--font-size-xs)] leading-relaxed text-[var(--color-text-secondary)]">
                    MusicBrainz, Wikidata, Wikipedia, and Wikimedia Commons provide the first
                    no-key artist-photo lookup. Last.fm and TheAudioDB fill missing text metadata,
                    while Fanart.tv is the final artwork fallback. Downloaded images and artist
                    profiles are cached locally.
                  </p>
                  <button
                    className="inline-flex items-center gap-1.5 text-[var(--font-size-xs)] font-medium text-[var(--color-accent)] hover:underline"
                    onClick={() => { void openExternal("https://fanart.tv/get-an-api-key/"); }}
                    type="button"
                  >
                    Get a Fanart.tv API key <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
              </>
            )}

            <div data-analysis-settings>
              <h3 className="mb-[var(--spacing-md)] text-[var(--font-size-sm)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Key and BPM Analysis
              </h3>
              <div className="max-w-3xl space-y-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-[var(--spacing-lg)]">
                <div>
                  <label className="mb-2 block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                    Analysis performance
                  </label>
                  <div className="relative max-w-md">
                    <select
                      value={analysisPerformance}
                      onChange={(event) => setAnalysisPerformance(event.target.value as "stable" | "fast" | "maximum")}
                      data-analysis-performance
                      className="h-[var(--input-height)] w-full appearance-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] pr-10 text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                    >
                      <option value="stable">Stable — 1 worker</option>
                      <option value="fast">Fast — 2 isolated workers</option>
                      <option value="maximum">Maximum — up to 4 isolated workers</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  </div>
                  <p className="mt-2 max-w-2xl text-[var(--font-size-xs)] leading-relaxed text-[var(--color-text-secondary)]">
                    More workers analyze separate songs at the same accuracy. Maximum uses up to four CPU cores and may increase power use, fan noise, and memory pressure.
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                    Key notation
                  </label>
                  <div className="relative max-w-md">
                    <select
                      value={analysisNotation}
                      onChange={(event) => setAnalysisNotation(event.target.value as AnalysisNotationMode)}
                      data-analysis-notation
                      className="h-[var(--input-height)] w-full appearance-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] pr-10 text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                    >
                      <option value="standard">Standard key (Am)</option>
                      <option value="custom">Custom / Camelot (8A)</option>
                      <option value="combined">Custom + standard key (8A Am)</option>
                      <option value="djCombined">DJ notation + key (8A - Am)</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  </div>
                </div>

                {(analysisNotation === "custom" || analysisNotation === "combined") && (
                  <details>
                    <summary className="cursor-pointer text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                      Custom key codes
                    </summary>
                    <div className="mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-auto pr-2 sm:grid-cols-3 md:grid-cols-4">
                      {KEY_NAMES.map((name, index) => (
                        <label key={name} className="flex items-center gap-2 text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                          <span className="w-9 shrink-0">{name}</span>
                          <input
                            value={analysisCustomCodes[index] ?? ""}
                            onChange={(event) => setAnalysisCustomCode(index, event.target.value)}
                            className="h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-2 text-[var(--font-size-xs)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                )}

                <div>
                  <label className="mb-2 block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                    Separator
                  </label>
                  <input
                    value={analysisDelimiter}
                    onChange={(event) => setAnalysisDelimiter(event.target.value)}
                    className="h-[var(--input-height)] w-32 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                  />
                </div>

                <div>
                  <div className="mb-2 text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                    Audio-file tag outputs
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ANALYSIS_OUTPUT_FIELDS.map(({ field, label, bpmOnly }) => (
                      <label key={field} className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                        <span className="mb-1 block">{label}</span>
                        <select
                          value={analysisOutputs[field]}
                          onChange={(event) => setAnalysisOutput(
                            field,
                            event.target.value as AnalysisOutputMode,
                          )}
                          className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-2 text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                        >
                          <option value="none">Do not write</option>
                          {!bpmOnly && <option value="prepend">Prepend</option>}
                          {!bpmOnly && <option value="append">Append</option>}
                          <option value="overwrite">Overwrite</option>
                        </select>
                      </label>
                    ))}
                  </div>
                </div>

                <p className={`text-[var(--font-size-xs)] ${writesAudioTags ? "text-amber-500" : "text-[var(--color-text-muted)]"}`}>
                  {writesAudioTags
                    ? "Enabled outputs modify tags in the source audio files during analysis."
                    : "Source audio files are not modified. Enable an output explicitly to write tags."}
                </p>
              </div>
            </div>

            {activeTab === "application" && (
              <>
            {/* Maintenance Section */}
            <div>
              <h3 className="mb-[var(--spacing-md)] text-[var(--font-size-sm)] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Maintenance
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                    Database File Name
                  </label>
                  <input
                    className="h-[var(--input-height)] w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
                    placeholder="muro.db"
                    value={dbFileName}
                    onChange={(event) => onDbFileNameChange(event.target.value)}
                  />
                  <p className="mt-2 text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                    Stored inside the app data directory unless you override the full path.
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                    Database Path
                  </label>
                  <input
                    className="h-[var(--input-height)] w-full max-w-xl rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
                    placeholder="/path/to/muro.db"
                    value={dbPath}
                    onChange={(event) => onDbPathChange(event.target.value)}
                  />
                  <button
                    className="mt-3 flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-bg-hover)]"
                    type="button"
                    onClick={onUseDefaultLocation}
                  >
                    Use default location
                  </button>
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-white transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={onBackfillSearchText}
                      disabled={backfillPending}
                      type="button"
                    >
                      {backfillPending ? "Backfilling..." : "Backfill search index"}
                    </button>
                    {backfillStatus && (
                      <span className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                        {backfillStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                    Runs a one-time search index update for existing tracks.
                  </p>
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-white transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={onBackfillCoverArt}
                      disabled={coverArtBackfillPending}
                      type="button"
                    >
                      {coverArtBackfillPending ? "Extracting..." : "Extract embedded cover art"}
                    </button>
                    {coverArtBackfillStatus && (
                      <span className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                        {coverArtBackfillStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                    Rebuilds locally cached covers from artwork already embedded in your audio
                    files. It never contacts an online artwork service.
                  </p>
                </div>
              </div>
            </div>
              </>
            )}
          </div>
        )}

        {activeTab === "theme" && (
          <div className="space-y-6">
            {/* Theme Selection */}
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="mb-1 block text-[var(--font-size-md)] font-medium text-[var(--color-text-primary)]">
                  Theme
                </label>
                <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                  Choose a theme that suits your workflow
                </p>
              </div>
              <div className="relative">
                <select
                  value={theme}
                  onChange={(e) => onThemeChange(e.target.value)}
                  className="h-[var(--input-height)] w-40 appearance-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] pr-10 text-[var(--font-size-sm)] text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
                >
                  {themes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              </div>
            </div>

            {/* Theme Preview Grid */}
            <div className="border-t border-[var(--color-border-light)] pt-6">
              <h4 className="mb-4 text-[var(--font-size-sm)] font-medium text-[var(--color-text-secondary)]">
                Theme Preview
              </h4>
              <div className="grid grid-cols-2 gap-4">
                {themes.map((t) => {
                  const themeInfo = themeDescriptions[t.id] || { label: t.label, description: "" };
                  return (
                    <button
                      key={t.id}
                      className={`flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border-2 p-4 transition-all duration-[var(--transition-fast)] ${
                        theme === t.id
                          ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
                          : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:border-[var(--color-accent-light)] hover:bg-[var(--color-bg-tertiary)]"
                      }`}
                      onClick={() => onThemeChange(t.id)}
                      type="button"
                    >
                      <div
                        className={`grid aspect-[16/10] w-full grid-cols-[1fr_2fr_1fr] gap-0.5 overflow-hidden rounded-[var(--radius-md)]`}
                        data-theme-preview={t.id}
                      >
                        <div className="rounded-sm bg-[var(--color-bg-primary)]" />
                        <div className="rounded-sm bg-[var(--color-bg-primary)]" />
                        <div className="rounded-sm bg-[var(--color-bg-primary)]" />
                      </div>
                      <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text-primary)]">
                        {themeInfo.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
