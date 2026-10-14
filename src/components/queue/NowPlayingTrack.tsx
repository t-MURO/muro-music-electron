import { Music2 } from "lucide-react";
import { convertFileSrc } from "@muro/desktop/runtime";
import { t } from "../../i18n";
import type { CurrentTrack } from "../../hooks";
import type { Track } from "../../types";

type NowPlayingTrackProps = {
  currentTrack: CurrentTrack | null;
  trackDetails?: Track | null;
};

export const NowPlayingTrack = ({ currentTrack, trackDetails }: NowPlayingTrackProps) => {
  if (!currentTrack) {
    return (
      <div className="flex w-full items-center gap-3 px-4 text-[var(--color-text-muted)]">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
          <Music2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{t("player.empty.title")}</div>
          <div className="mt-1 truncate text-[10px]">{t("player.empty.subtitle")}</div>
        </div>
      </div>
    );
  }

  const coverPath = currentTrack.coverArtPath || currentTrack.coverArtThumbPath;
  return (
    <div className="now-playing-card px-4">
      <div className="now-playing-layout flex items-center gap-3">
        <div className="now-playing-cover h-[92px] w-[92px] shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
          {coverPath ? (
            <img src={convertFileSrc(coverPath)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
              <Music2 className="h-5 w-5" />
            </div>
          )}
        </div>
        <div className="now-playing-meta min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
            {currentTrack.title}
          </div>
          <div className="mt-1 truncate text-[11px] text-[var(--color-text-secondary)]">
            {currentTrack.artist}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-muted)]">
            {currentTrack.album}
          </div>
          {(trackDetails?.bitrate || trackDetails?.bpm || trackDetails?.key) && (
            <div className="mt-2 truncate text-[10px] tabular-nums text-[var(--color-text-muted)]">
              {[
                trackDetails?.bitrate,
                trackDetails?.bpm ? `${trackDetails.bpm.toFixed(1)} BPM` : "",
                trackDetails?.key,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
