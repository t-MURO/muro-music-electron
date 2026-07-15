import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { convertFileSrc } from "@muro/desktop/runtime";
import { t } from "../../i18n";
import { getAudioWaveform } from "../../lib/keyfinder";
import { useLibraryStore, usePlaybackStore } from "../../stores";
import { WaveformSeekBar } from "../player/WaveformSeekBar";

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
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const shuffleEnabled = usePlaybackStore((state) => state.shuffleEnabled);
  const repeatMode = usePlaybackStore((state) => state.repeatMode);
  const currentPosition = usePlaybackStore((state) => state.currentPosition);
  const duration = usePlaybackStore((state) => state.duration);
  const volume = usePlaybackStore((state) => state.volume);
  const currentTrack = usePlaybackStore((state) => state.currentTrack);
  const toggleShuffle = usePlaybackStore((state) => state.toggleShuffle);
  const toggleRepeat = usePlaybackStore((state) => state.toggleRepeat);
  const libraryTracks = useLibraryStore((state) => state.tracks);
  const inboxTracks = useLibraryStore((state) => state.inboxTracks);
  const trackDetails = currentTrack
    ? [...libraryTracks, ...inboxTracks].find((track) => track.id === currentTrack.id)
    : undefined;

  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const isSeekingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPeaks([]);
    if (!currentTrack?.sourcePath) return () => { cancelled = true; };
    setWaveformLoading(true);
    getAudioWaveform(currentTrack.sourcePath, 768)
      .then((result) => {
        if (!cancelled) setPeaks(Array.isArray(result.peaks) ? result.peaks : []);
      })
      .catch((error) => {
        console.warn("Could not generate playback waveform", error);
      })
      .finally(() => {
        if (!cancelled) setWaveformLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentTrack?.sourcePath]);

  const displayPosition = isSeeking ? seekValue : currentPosition;
  const progress = duration > 0
    ? Math.min(100, Math.max(0, (displayPosition / duration) * 100))
    : 0;
  const volumePercent = volume * 100;

  const getSeekValue = useCallback((clientX: number) => {
    if (!progressRef.current || duration <= 0) return 0;
    const rect = progressRef.current.getBoundingClientRect();
    const clamped = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    return (rect.width > 0 ? clamped / rect.width : 0) * duration;
  }, [duration]);

  const updateSeekValue = useCallback((clientX: number) => {
    const value = getSeekValue(clientX);
    setSeekValue(value);
    return value;
  }, [getSeekValue]);

  const handleSeekStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    isSeekingRef.current = true;
    setIsSeeking(true);
    updateSeekValue(event.clientX);
  }, [duration, updateSeekValue]);

  const handleSeekMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (isSeekingRef.current) updateSeekValue(event.clientX);
  }, [updateSeekValue]);

  const handleSeekEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isSeekingRef.current) return;
    const value = updateSeekValue(event.clientX);
    isSeekingRef.current = false;
    setIsSeeking(false);
    onSeekChange(value);
  }, [onSeekChange, updateSeekValue]);

  const handleSeekCancel = useCallback(() => {
    isSeekingRef.current = false;
    setIsSeeking(false);
  }, []);

  const controlButtonClass = "player-bar-button flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]";

  return (
    <footer className="player-bar col-span-3 col-start-1 row-start-3 grid h-[var(--media-controls-height)] grid-cols-[minmax(230px,300px)_minmax(360px,1fr)_minmax(190px,300px)] items-center gap-5 border-t border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {currentTrack?.coverArtThumbPath ? (
          <img src={convertFileSrc(currentTrack.coverArtThumbPath)} alt={`${currentTrack.title} cover`} className="h-[62px] w-[62px] shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] object-cover" />
        ) : (
          <div className="flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]"><Music2 className="h-5 w-5" /></div>
        )}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{currentTrack ? currentTrack.title : t("player.empty.title")}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]">{currentTrack ? currentTrack.artist : t("player.empty.subtitle")}</p>
          {currentTrack?.album && <p className="mt-0.5 truncate text-[10px] text-[var(--color-text-muted)]">{currentTrack.album}</p>}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-center gap-2">
          <button className={`${controlButtonClass} ${shuffleEnabled ? "text-[var(--color-accent)]" : ""}`} onClick={toggleShuffle} title="Shuffle" type="button"><Shuffle className="h-4 w-4" /></button>
          <button className={controlButtonClass} onClick={onSkipPrevious} title="Previous" type="button"><SkipBack className="h-[18px] w-[18px]" /></button>
          <button className="player-bar-play-button flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-accent)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-accent-light)]" onClick={onTogglePlay} title={isPlaying ? "Pause" : "Play"} type="button">
            {isPlaying ? <Pause className="h-[18px] w-[18px]" fill="currentColor" /> : <Play className="h-[18px] w-[18px] translate-x-px" fill="currentColor" />}
          </button>
          <button className={controlButtonClass} onClick={onSkipNext} title="Next" type="button"><SkipForward className="h-[18px] w-[18px]" /></button>
          <button className={`${controlButtonClass} ${repeatMode !== "off" ? "text-[var(--color-accent)]" : ""}`} onClick={toggleRepeat} title={repeatMode === "off" ? "Repeat" : repeatMode === "all" ? "Repeat all" : "Repeat one"} type="button">
            {repeatMode === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
          </button>
        </div>
        <div className="group flex min-w-0 items-center gap-2.5">
          <span className="w-9 text-right text-[10px] tabular-nums text-[var(--color-text-secondary)]">{formatTime(displayPosition)}</span>
          <WaveformSeekBar
            peaks={peaks}
            progress={progress}
            duration={duration}
            displayPosition={displayPosition}
            onSeekStart={handleSeekStart}
            onSeekMove={handleSeekMove}
            onSeekEnd={handleSeekEnd}
            onSeekCancel={handleSeekCancel}
            progressRef={progressRef}
          />
          <span className="w-9 text-[10px] tabular-nums text-[var(--color-text-secondary)]">{formatTime(duration)}</span>
        </div>
        {waveformLoading && <span className="sr-only" role="status">Generating waveform</span>}
      </div>

      <div className="flex items-center justify-end gap-3">
        {(trackDetails?.bpm || trackDetails?.key) && (
          <div className="mr-1 text-right text-[10px] tabular-nums text-[var(--color-text-muted)]">
            {trackDetails?.bpm && <div>{trackDetails.bpm.toFixed(1)} BPM</div>}
            {trackDetails?.key && <div className="font-semibold text-[var(--color-accent)]">{trackDetails.key}</div>}
          </div>
        )}
        <button className={controlButtonClass} onClick={() => onVolumeChange(volume > 0 ? 0 : 0.8)} title={volume > 0 ? "Mute" : "Unmute"} type="button">
          {volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
        <div className="player-volume-control relative h-1 w-[92px]">
          <input type="range" min="0" max="100" value={volumePercent} onChange={(event) => onVolumeChange(Number(event.target.value) / 100)} className="absolute left-0 top-0 z-[2] h-full w-full cursor-pointer opacity-0" aria-label="Volume" />
          <div className="player-volume-fill" style={{ width: `${volumePercent}%` }} />
        </div>
      </div>
    </footer>
  );
};
