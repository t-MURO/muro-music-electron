import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@muro/desktop/runtime";
import { t } from "../../i18n";
import {
  analyzeTrack,
  normalizeBpm,
  BPM_RANGES,
  type AnalysisResult,
  type BpmRange,
} from "../../lib/analyzer";
import type { Track } from "../../types";

type TrackAnalysis = {
  track: Track;
  result: AnalysisResult | null;
  error: string | null;
  rawBpm: number; // Store raw BPM for re-normalization
};

type AnalysisModalProps = {
  isOpen: boolean;
  tracks: Track[];
  dbPath: string;
  onClose: () => void;
  onAnalysisComplete?: (results: Map<string, AnalysisResult>) => void;
};

export const AnalysisModal = ({
  isOpen,
  tracks,
  dbPath,
  onClose,
  onAnalysisComplete,
}: AnalysisModalProps) => {
  const [analyses, setAnalyses] = useState<TrackAnalysis[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [selectedRange, setSelectedRange] = useState<BpmRange>(BPM_RANGES[0]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize analyses when tracks change
  useEffect(() => {
    if (isOpen && tracks.length > 0) {
      setAnalyses(
        tracks.map((track) => ({
          track,
          result: null,
          error: null,
          rawBpm: 0,
        }))
      );
      setProgress({ current: 0, total: tracks.length });
    }
  }, [isOpen, tracks]);

  // Start analysis when modal opens
  useEffect(() => {
    if (!isOpen || tracks.length === 0 || isAnalyzing) {
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const runAnalysis = async () => {
      setIsAnalyzing(true);

      for (let i = 0; i < tracks.length; i++) {
        // Check if cancelled
        if (abortController.signal.aborted) {
          break;
        }

        const track = tracks[i];
        // Show which track is being analyzed (0-indexed display as "1 of N")
        setProgress({ current: i, total: tracks.length });

        try {
          // Use wide range for initial analysis to get raw BPM
          const result = await analyzeTrack(track.sourcePath, {
            bpmMin: 60,
            bpmMax: 200,
            signal: abortController.signal,
          });

          setAnalyses((prev) =>
            prev.map((a) =>
              a.track.id === track.id
                ? { ...a, result, rawBpm: result.bpm, error: null }
                : a
            )
          );
        } catch (error) {
          // Ignore abort errors
          if (error instanceof DOMException && error.name === "AbortError") {
            break;
          }
          const errorMessage =
            error instanceof Error ? error.message : "Analysis failed";
          setAnalyses((prev) =>
            prev.map((a) =>
              a.track.id === track.id
                ? { ...a, result: null, rawBpm: 0, error: errorMessage }
                : a
            )
          );
        }

        // Update progress after track completes
        setProgress({ current: i + 1, total: tracks.length });
      }

      setIsAnalyzing(false);
      abortControllerRef.current = null;
    };

    runAnalysis();

    return () => {
      abortController.abort();
    };
  }, [isOpen, tracks]);

  // Re-normalize BPM when range changes
  useEffect(() => {
    setAnalyses((prev) =>
      prev.map((a) => {
        if (a.result && a.rawBpm > 0) {
          const normalizedBpm = normalizeBpm(
            a.rawBpm,
            selectedRange.min,
            selectedRange.max
          );
          return {
            ...a,
            result: { ...a.result, bpm: normalizedBpm },
          };
        }
        return a;
      })
    );
  }, [selectedRange]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);

    try {
      const results = new Map<string, AnalysisResult>();

      for (const analysis of analyses) {
        if (analysis.result) {
          results.set(analysis.track.id, analysis.result);

          // Save to database
          await invoke("update_track_analysis", {
            dbPath,
            trackId: analysis.track.id,
            bpm: analysis.result.bpm > 0 ? analysis.result.bpm : null,
            key: analysis.result.camelot !== "?" ? analysis.result.camelot : null,
          });
        }
      }

      onAnalysisComplete?.(results);
      onClose();
    } catch (error) {
      console.error("Failed to save analysis results:", error);
      setSaveError(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [analyses, dbPath, onAnalysisComplete, onClose]);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const handleClose = useCallback(() => {
    // Cancel any ongoing analysis when closing
    handleCancel();
    onClose();
  }, [handleCancel, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose(); // Cancels analysis and closes
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  const isSingleTrack = tracks.length === 1;
  const hasResults = analyses.some((a) => a.result !== null);
  const allComplete = !isAnalyzing && analyses.length > 0;

  return createPortal(
    <div
      className="modal-overlay-animate fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-[var(--spacing-lg)] backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="modal-panel-animate flex max-h-[80vh] w-full max-w-[600px] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-lg)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[var(--color-border)] p-[var(--spacing-lg)]">
          <h2 className="text-[var(--font-size-md)] font-semibold text-[var(--color-text-primary)]">
            {t("analysis.title")}
          </h2>
          <p className="mt-[var(--spacing-xs)] text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {isAnalyzing
              ? `${t("analysis.analyzing")} ${progress.current} / ${progress.total}...`
              : allComplete
                ? t("analysis.complete")
                : t("analysis.subtitle")}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-[var(--spacing-lg)]">
          {/* BPM Range Selector */}
          <div className="mb-[var(--spacing-md)]">
            <label className="mb-[var(--spacing-xs)] block text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
              {t("analysis.bpmRange")}
            </label>
            <select
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              value={`${selectedRange.min}-${selectedRange.max}`}
              onChange={(e) => {
                const [min, max] = e.target.value.split("-").map(Number);
                const range = BPM_RANGES.find(
                  (r) => r.min === min && r.max === max
                );
                if (range) {
                  setSelectedRange(range);
                }
              }}
            >
              {BPM_RANGES.map((range) => (
                <option
                  key={`${range.min}-${range.max}`}
                  value={`${range.min}-${range.max}`}
                >
                  {range.label}
                </option>
              ))}
            </select>
          </div>

          {/* Results */}
          {isSingleTrack && analyses[0] ? (
            // Single track view
            <div className="space-y-[var(--spacing-md)]">
              <div className="text-center">
                <div className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                  {analyses[0].track.title}
                </div>
                <div className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                  {analyses[0].track.artist}
                </div>
              </div>

              {analyses[0].error ? (
                <div className="rounded-[var(--radius-md)] bg-red-500/10 p-[var(--spacing-md)] text-center text-[var(--font-size-sm)] text-red-500">
                  {analyses[0].error}
                </div>
              ) : analyses[0].result ? (
                <div className="grid grid-cols-2 gap-[var(--spacing-md)]">
                  <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-[var(--spacing-md)] text-center">
                    <div className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                      BPM
                    </div>
                    <div className="text-[var(--font-size-xl)] font-bold text-[var(--color-text-primary)]">
                      {analyses[0].result.bpm > 0
                        ? analyses[0].result.bpm.toFixed(1)
                        : "N/A"}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-[var(--spacing-md)] text-center">
                    <div className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                      {t("analysis.key")}
                    </div>
                    <div className="text-[var(--font-size-xl)] font-bold text-[var(--color-text-primary)]">
                      {analyses[0].result.camelot}
                    </div>
                    <div className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                      {analyses[0].result.key} {analyses[0].result.scale}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-[var(--spacing-lg)]">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                </div>
              )}
            </div>
          ) : (
            // Multiple tracks table view
            <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                    <th className="px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
                      {t("columns.title")}
                    </th>
                    <th className="px-[var(--spacing-md)] py-[var(--spacing-sm)] text-left text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
                      {t("columns.artist")}
                    </th>
                    <th className="px-[var(--spacing-md)] py-[var(--spacing-sm)] text-right text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
                      BPM
                    </th>
                    <th className="px-[var(--spacing-md)] py-[var(--spacing-sm)] text-right text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
                      {t("columns.key")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((analysis) => (
                    <tr
                      key={analysis.track.id}
                      className="border-b border-[var(--color-border)] last:border-b-0"
                    >
                      <td className="max-w-[150px] truncate px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] text-[var(--color-text-primary)]">
                        {analysis.track.title}
                      </td>
                      <td className="max-w-[120px] truncate px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
                        {analysis.track.artist}
                      </td>
                      <td className="px-[var(--spacing-md)] py-[var(--spacing-sm)] text-right text-[var(--font-size-sm)]">
                        {analysis.error ? (
                          <span className="text-red-500">Error</span>
                        ) : analysis.result ? (
                          <span className="font-medium text-[var(--color-text-primary)]">
                            {analysis.result.bpm > 0
                              ? analysis.result.bpm.toFixed(1)
                              : "N/A"}
                          </span>
                        ) : (
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                        )}
                      </td>
                      <td className="px-[var(--spacing-md)] py-[var(--spacing-sm)] text-right text-[var(--font-size-sm)]">
                        {analysis.error ? (
                          <span className="text-red-500">-</span>
                        ) : analysis.result ? (
                          <span className="font-medium text-[var(--color-text-primary)]">
                            {analysis.result.camelot}
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-muted)]">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--color-border)] p-[var(--spacing-lg)]">
          {saveError && (
            <div className="mb-[var(--spacing-sm)] rounded-[var(--radius-md)] bg-red-500/10 px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-xs)] text-red-500">
              {saveError}
            </div>
          )}
          <div className="flex items-center justify-end gap-[var(--spacing-sm)]">
            {isAnalyzing ? (
              <button
                className="rounded-[var(--radius-md)] bg-red-500/10 px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium text-red-500 transition-colors hover:bg-red-500/20"
                onClick={handleCancel}
                type="button"
              >
                {t("analysis.cancel")}
              </button>
            ) : (
              <>
                <button
                  className="rounded-[var(--radius-md)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                  onClick={handleClose}
                  type="button"
                >
                  {t("analysis.close")}
                </button>
                <button
                  className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleSave}
                  disabled={!hasResults || isSaving}
                  type="button"
                >
                  {isSaving ? t("analysis.saving") : t("analysis.save")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
