import { useState, useCallback, useRef, type PointerEvent } from "react";
import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music2,
} from "lucide-react";
import { convertFileSrc } from "@muro/desktop/runtime";
import { t } from "../../i18n";
import { usePlaybackStore } from "../../stores";

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

type PlayerBarProps = {
  onTogglePlay: () => void;
  onSeekChange: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onSkipPrevious: () => void;
  onSkipNext: () => void;
};

export const PlayerBar = ({
  onTogglePlay,
  onSeekChange,
  onVolumeChange,
  onSkipPrevious,
  onSkipNext,
}: PlayerBarProps) => {
  // Read state from store
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const shuffleEnabled = usePlaybackStore((s) => s.shuffleEnabled);
  const repeatMode = usePlaybackStore((s) => s.repeatMode);
  const currentPosition = usePlaybackStore((s) => s.currentPosition);
  const duration = usePlaybackStore((s) => s.duration);
  const volume = usePlaybackStore((s) => s.volume);
  const currentTrack = usePlaybackStore((s) => s.currentTrack);
  const toggleShuffle = usePlaybackStore((s) => s.toggleShuffle);
  const toggleRepeat = usePlaybackStore((s) => s.toggleRepeat);
  // Local state for seeking - only send to backend on release
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const isSeekingRef = useRef(false);

  const displayPosition = isSeeking ? seekValue : currentPosition;
  const progress =
    duration > 0 ? Math.min(100, Math.max(0, (displayPosition / duration) * 100)) : 0;
  const volumePercent = volume * 100;

  const getSeekValue = useCallback(
    (clientX: number) => {
      if (!progressRef.current || duration <= 0) {
        return 0;
      }
      const rect = progressRef.current.getBoundingClientRect();
      const clamped = Math.min(Math.max(clientX - rect.left, 0), rect.width);
      const ratio = rect.width > 0 ? clamped / rect.width : 0;
      return ratio * duration;
    },
    [duration]
  );

  const updateSeekValue = useCallback(
    (clientX: number) => {
      const value = getSeekValue(clientX);
      setSeekValue(value);
      return value;
    },
    [getSeekValue]
  );

  const handleSeekStart = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (duration <= 0) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      isSeekingRef.current = true;
      setIsSeeking(true);
      updateSeekValue(event.clientX);
    },
    [duration, updateSeekValue]
  );

  const handleSeekMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isSeekingRef.current) {
        return;
      }
      updateSeekValue(event.clientX);
    },
    [updateSeekValue]
  );

  const handleSeekEnd = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isSeekingRef.current) {
        return;
      }
      const value = updateSeekValue(event.clientX);
      isSeekingRef.current = false;
      setIsSeeking(false);
      onSeekChange(value);
    },
    [onSeekChange, updateSeekValue]
  );

  const handleSeekCancel = useCallback(() => {
    if (!isSeekingRef.current) {
      return;
    }
    isSeekingRef.current = false;
    setIsSeeking(false);
  }, []);

  return (
    <footer className="player-bar col-span-3 col-start-1 row-start-3 grid h-[var(--media-controls-height)] grid-cols-[1fr_2fr_1fr] items-center gap-[var(--spacing-lg)] border-t border-[var(--color-border)] bg-[var(--color-bg-primary)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
      {/* Left section - Track info */}
      <div className="flex min-w-0 items-center gap-[var(--spacing-md)]">
        {currentTrack?.coverArtThumbPath ? (
          <img
            src={convertFileSrc(currentTrack.coverArtThumbPath)}
            alt={`${currentTrack.title} cover`}

            className="h-[var(--avatar-size)] w-[var(--avatar-size)] shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)] object-cover"
          />
        ) : (
          <div className="flex h-[var(--avatar-size)] w-[var(--avatar-size)] shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
            <Music2 className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 overflow-hidden">
          <p className="truncate text-[var(--font-size-sm)] font-semibold text-[var(--color-text-primary)]">
            {currentTrack ? currentTrack.title : t("player.empty.title")}
          </p>
          <p className="truncate text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            {currentTrack ? currentTrack.artist : t("player.empty.subtitle")}
          </p>
        </div>
      </div>

      {/* Center section - Controls */}
      <div className="flex flex-col items-center gap-[var(--spacing-sm)]">
        <div className="flex items-center gap-[var(--spacing-md)]">
          <button
            className={`player-bar-button flex h-[var(--button-height)] w-[var(--button-height)] items-center justify-center rounded-[var(--radius-full)] transition-all duration-[var(--transition-fast)] ${
              shuffleEnabled
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            }`}
            onClick={toggleShuffle}
            title="Shuffle"
            type="button"
          >
            <Shuffle className="h-[18px] w-[18px]" />
          </button>
          <button
            className="player-bar-button flex h-[var(--button-height)] w-[var(--button-height)] items-center justify-center rounded-[var(--radius-full)] text-[var(--color-text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={onSkipPrevious}
            title="Previous"
            type="button"
          >
            <SkipBack className="h-5 w-5" />
          </button>
          <button
            className="player-bar-play-button flex h-[var(--play-button-size)] w-[var(--play-button-size)] items-center justify-center rounded-[var(--radius-full)] bg-[var(--color-accent)] text-white transition-all duration-[var(--transition-fast)] hover:scale-105 hover:bg-[var(--color-accent-hover)]"
            onClick={onTogglePlay}
            title={isPlaying ? "Pause" : "Play"}
            type="button"
          >
            {isPlaying ? (
              <Pause className="h-6 w-6" fill="currentColor" />
            ) : (
              <Play className="h-6 w-6" fill="currentColor" />
            )}
          </button>
          <button
            className="player-bar-button flex h-[var(--button-height)] w-[var(--button-height)] items-center justify-center rounded-[var(--radius-full)] text-[var(--color-text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={onSkipNext}
            title="Next"
            type="button"
          >
            <SkipForward className="h-5 w-5" />
          </button>
          <button
            className={`player-bar-button flex h-[var(--button-height)] w-[var(--button-height)] items-center justify-center rounded-[var(--radius-full)] transition-all duration-[var(--transition-fast)] ${
              repeatMode !== "off"
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            }`}
            onClick={toggleRepeat}
            title={
              repeatMode === "off"
                ? "Repeat"
                : repeatMode === "all"
                ? "Repeat all"
                : "Repeat one"
            }
            type="button"
          >
            {repeatMode === "one" ? (
              <Repeat1 className="h-[18px] w-[18px]" />
            ) : (
              <Repeat className="h-[18px] w-[18px]" />
            )}
          </button>
        </div>

        <div className="flex w-full max-w-[600px] items-center gap-[var(--spacing-md)]">
          <span className="min-w-[40px] text-right text-[var(--font-size-xs)] tabular-nums text-[var(--color-text-muted)]">
            {formatTime(displayPosition)}
          </span>
          <div
            ref={progressRef}
            className="player-progress-bar relative h-1 flex-1 touch-none rounded-[var(--radius-full)]"
            onPointerDown={handleSeekStart}
            onPointerMove={handleSeekMove}
            onPointerUp={handleSeekEnd}
            onPointerCancel={handleSeekCancel}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={displayPosition}
          >
            <div
              className="player-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="min-w-[40px] text-[var(--font-size-xs)] tabular-nums text-[var(--color-text-muted)]">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Right section - Volume */}
      <div className="flex items-center justify-end gap-[var(--spacing-sm)]">
        <button
          className="player-bar-button flex h-[var(--button-height)] w-[var(--button-height)] items-center justify-center rounded-[var(--radius-full)] text-[var(--color-text-secondary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
          onClick={() => onVolumeChange(volume > 0 ? 0 : 0.8)}
          title={volume > 0 ? "Mute" : "Unmute"}
          type="button"
        >
          {volume > 0 ? (
            <Volume2 className="h-[18px] w-[18px]" />
          ) : (
            <VolumeX className="h-[18px] w-[18px]" />
          )}
        </button>
        <div className="player-volume-control relative h-1 w-[100px]">
          <input
            type="range"
            min="0"
            max="100"
            value={volumePercent}
            onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
            className="absolute left-0 top-0 z-[2] h-full w-full cursor-pointer opacity-0"
            aria-label="Volume"
          />
          <div
            className="player-volume-fill"
            style={{ width: `${volumePercent}%` }}
          />
        </div>
      </div>
    </footer>
  );
};
