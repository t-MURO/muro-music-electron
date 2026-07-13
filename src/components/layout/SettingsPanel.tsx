import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { t, type Locale } from "../../i18n";

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

type Tab = "dev" | "application" | "theme";

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
  const isDevMode = import.meta.env.DEV;
  const [activeTab, setActiveTab] = useState<Tab>(
    isDevMode ? "dev" : "application"
  );

  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border-light)] px-[var(--spacing-lg)]">
        {isDevMode && (
          <button
            className={`px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
              activeTab === "dev"
                ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
            onClick={() => setActiveTab("dev")}
            type="button"
          >
            Dev
          </button>
        )}
        <button
          className={`px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium transition-all duration-[var(--transition-fast)] ${
            activeTab === "application"
              ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
          onClick={() => setActiveTab("application")}
          type="button"
        >
          Application
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
        {activeTab === "dev" && isDevMode && (
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
          </div>
        )}

        {activeTab === "application" && (
          <div className="space-y-8">
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
                      {coverArtBackfillPending ? "Extracting..." : "Extract cover art"}
                    </button>
                    {coverArtBackfillStatus && (
                      <span className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                        {coverArtBackfillStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
                    Extracts and caches cover art for tracks imported before this feature was added.
                  </p>
                </div>
              </div>
            </div>
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
