import { useCallback, useState } from "react";

export const usePlayerState = () => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [seekPosition, setSeekPosition] = useState(34);

  const togglePlay = useCallback(() => {
    setIsPlaying((current) => !current);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((current) => !current);
  }, []);

  const toggleRepeat = useCallback(() => {
    setRepeatMode((current) =>
      current === "off" ? "all" : current === "all" ? "one" : "off"
    );
  }, []);

  return {
    isPlaying,
    repeatMode,
    seekPosition,
    setSeekPosition,
    shuffleEnabled,
    togglePlay,
    toggleRepeat,
    toggleShuffle,
  };
};
