import { Disc3, Music2 } from "lucide-react";
import { convertFileSrc } from "@muro/desktop/runtime";
import { t } from "../../i18n";
import type { CurrentTrack } from "../../hooks";

type NowPlayingTrackProps = {
  currentTrack: CurrentTrack | null;
};

export const NowPlayingTrack = ({ currentTrack }: NowPlayingTrackProps) => {
  if (currentTrack) {
    return (
      <div className="flex w-full items-center gap-2.5 bg-[var(--color-accent-light)] px-[var(--spacing-lg)] py-1.5">
        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)]">
          {currentTrack.coverArtPath ? (
            <img
              src={convertFileSrc(currentTrack.coverArtPath)}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
              <Music2 className="h-4 w-4" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[var(--font-size-sm)] font-medium text-[var(--color-accent)]">
            {currentTrack.title}
          </div>
          <div className="truncate text-[var(--font-size-xs)] font-light text-[var(--color-accent)]">
            {currentTrack.artist}
          </div>
        </div>
        <Disc3 className="h-4 w-4 flex-shrink-0 animate-spin-slow text-[var(--color-accent)]" />
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-2.5 px-[var(--spacing-lg)] py-1.5 text-[var(--color-text-muted)]">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)]">
        <Music2 className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[var(--font-size-sm)] font-medium">
          {t("player.empty.title")}
        </div>
        <div className="truncate text-[var(--font-size-xs)] font-light">
          {t("player.empty.subtitle")}
        </div>
      </div>
    </div>
  );
};
