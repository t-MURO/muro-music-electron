import { useEffect } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import type { Track } from "../../types";

type DuplicateTracksModalProps = {
  isOpen: boolean;
  duplicateTracks: Track[];
  onClose: () => void;
  onConfirm: () => void;
};

export const DuplicateTracksModal = ({
  isOpen,
  duplicateTracks,
  onClose,
  onConfirm,
}: DuplicateTracksModalProps) => {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="modal-overlay-animate fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-[var(--spacing-lg)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="modal-panel-animate flex max-h-[80vh] w-full max-w-[400px] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-lg)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-[var(--spacing-lg)]">
          <h2 className="text-[var(--font-size-md)] font-semibold text-[var(--color-text-primary)]">
            {t("playlist.duplicates.title")}
          </h2>
          <p className="mt-[var(--spacing-xs)] text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("playlist.duplicates.subtitle")}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-y border-[var(--color-border)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
          <ul className="space-y-[var(--spacing-sm)]">
            {duplicateTracks.map((track, index) => (
              <li
                key={`${track.id}-${index}`}
                className="flex items-center gap-[var(--spacing-sm)] text-[var(--font-size-sm)]"
              >
                <span className="truncate font-medium text-[var(--color-text-primary)]">
                  {track.title}
                </span>
                <span className="truncate text-[var(--color-text-muted)]">
                  {track.artist}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-end gap-[var(--spacing-sm)] p-[var(--spacing-lg)]">
          <button
            className="rounded-[var(--radius-md)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            onClick={onClose}
            type="button"
          >
            {t("playlist.duplicates.cancel")}
          </button>
          <button
            className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)]"
            onClick={onConfirm}
            type="button"
          >
            {t("playlist.duplicates.addAnyway")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
