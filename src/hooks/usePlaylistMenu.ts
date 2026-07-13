import { useCallback, useState } from "react";

export const usePlaylistMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [playlistId, setPlaylistId] = useState<string | null>(null);

  const openAt = useCallback(
    (event: React.MouseEvent<HTMLElement>, id: string) => {
      event.preventDefault();
      event.stopPropagation();
      setPosition({ x: event.clientX, y: event.clientY });
      setPlaylistId(id);
      setIsOpen(true);
    },
    []
  );

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setPlaylistId(null);
  }, []);

  return { closeMenu, isOpen, openAt, playlistId, position };
};
