import { ListPlus, Music2, Play, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@muro/desktop/runtime";
import {
  getCamelotSuggestions,
  getTracksForCamelotCode,
  toCamelotCode,
} from "../../utils/camelot";
import type { Track } from "../../types";
import { CamelotWheel } from "./CamelotWheel";

type MixSuggestionsProps = {
  tracks: Track[];
  currentTrack: Track | null | undefined;
  queuedTrackIds: string[];
  onPlayTrack: (trackId: string) => void;
  onPlayNext: (trackId: string) => void;
};

const MAX_SUGGESTIONS = 50;

export const MixSuggestions = ({
  tracks,
  currentTrack,
  queuedTrackIds,
  onPlayTrack,
  onPlayNext,
}: MixSuggestionsProps) => {
  const currentCode = toCamelotCode(currentTrack?.key);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const automaticSuggestions = useMemo(
    () => getCamelotSuggestions(currentTrack, tracks, new Set(queuedTrackIds)).slice(0, MAX_SUGGESTIONS),
    [currentTrack, queuedTrackIds, tracks],
  );
  const selectedSuggestions = useMemo(() => {
    if (!selectedCode || !currentTrack) return [];
    return getTracksForCamelotCode(
      selectedCode,
      currentTrack,
      tracks,
      new Set(queuedTrackIds),
    ).slice(0, MAX_SUGGESTIONS).map((track) => ({
      track,
      code: selectedCode,
      reason: selectedCode === currentCode ? "Same key" : `${selectedCode} selected on wheel`,
    }));
  }, [currentCode, currentTrack, queuedTrackIds, selectedCode, tracks]);
  const suggestions = selectedCode ? selectedSuggestions : automaticSuggestions;

  useEffect(() => {
    setSelectedCode(null);
  }, [currentTrack?.id]);

  if (!currentTrack) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 text-center text-[var(--color-text-muted)]">
        <Sparkles className="mb-3 h-6 w-6" />
        <p className="text-xs font-medium text-[var(--color-text-secondary)]">Play a track to find a compatible mix</p>
        <p className="mt-1 text-[10px]">Suggestions update automatically when the playing track changes.</p>
      </div>
    );
  }

  if (!currentCode) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 text-center text-[var(--color-text-muted)]">
        <Sparkles className="mb-3 h-6 w-6" />
        <p className="text-xs font-medium text-[var(--color-text-secondary)]">No Camelot key for this track</p>
        <p className="mt-1 text-[10px]">Analyze its key first, then Mix Next can find compatible songs.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-mix-suggestions>
      <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Mixing from</div>
            <div className="mt-1 truncate text-[12px] font-medium text-[var(--color-text-primary)]">{currentTrack.title}</div>
          </div>
          <span className="shrink-0 rounded-[var(--radius-md)] bg-[var(--color-accent-light)] px-2.5 py-1 text-xs font-bold text-[var(--color-accent)]">
            {currentCode}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
          Same, relative, and neighboring Camelot keys · closest BPM first
        </p>
      </div>

      <div className="shrink-0 border-b border-[var(--color-border)] px-2 py-3">
        <CamelotWheel
          currentCode={currentCode}
          selectedCode={selectedCode}
          onSelectCode={setSelectedCode}
        />
      </div>

      <div className="flex h-11 shrink-0 items-center border-b border-[var(--color-border-light)] px-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
          {selectedCode ? `${selectedCode} tracks` : "Compatible tracks"}
        </span>
        {selectedCode && (
          <button
            className="ml-2 text-[9px] text-[var(--color-accent)] hover:underline"
            onClick={() => setSelectedCode(null)}
            type="button"
          >
            Reset
          </button>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-[var(--color-text-muted)]">{suggestions.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {suggestions.length === 0 ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center px-7 text-center text-[var(--color-text-muted)]">
            <Music2 className="mb-3 h-5 w-5" />
            <p className="text-xs">{selectedCode ? `No ${selectedCode} tracks found` : "No compatible tracks found"}</p>
            <p className="mt-1 text-[10px]">{selectedCode ? "Choose another key on the wheel." : "Analyze more songs to expand the suggestions."}</p>
          </div>
        ) : (
          suggestions.map(({ track, code, reason }) => {
            const coverPath = track.coverArtThumbPath || track.coverArtPath;
            return (
              <div
                key={track.id}
                className="group border-b border-[var(--color-border-light)] px-3 py-2.5 hover:bg-[var(--color-bg-hover)]"
                data-mix-suggestion
                data-mix-reason={reason}
                data-mix-code={code}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
                    {coverPath
                      ? <img src={convertFileSrc(coverPath)} alt="" className="h-full w-full object-cover" />
                      : <Music2 className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">{track.title}</div>
                    <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-muted)]">{track.artist}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] font-bold text-[var(--color-accent)]">{code}</div>
                    <div className="mt-0.5 text-[9px] tabular-nums text-[var(--color-text-muted)]">{track.bpm ? `${track.bpm.toFixed(1)} BPM` : "—"}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 pl-[46px]">
                  <span className="min-w-0 flex-1 truncate text-[9px] text-[var(--color-text-muted)]">{reason}</span>
                  <button
                    className="toolbar-icon-button h-6 w-6"
                    onClick={() => onPlayTrack(track.id)}
                    title={`Play ${track.title}`}
                    aria-label={`Play ${track.title}`}
                    type="button"
                  >
                    <Play className="h-3 w-3" fill="currentColor" />
                  </button>
                  <button
                    className="toolbar-icon-button h-6 w-6"
                    onClick={() => onPlayNext(track.id)}
                    title={`Play ${track.title} next`}
                    aria-label={`Play ${track.title} next`}
                    data-mix-play-next
                    type="button"
                  >
                    <ListPlus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
