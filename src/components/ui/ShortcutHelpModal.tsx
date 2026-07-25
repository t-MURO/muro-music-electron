import { useEffect } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";

type ShortcutHelpModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const isMac = () => window.muro?.platform === "darwin";

/** "Mod" renders as ⌘ on macOS and Ctrl elsewhere. */
const renderKey = (key: string) => (key === "Mod" ? (isMac() ? "⌘" : "Ctrl") : key);

type ShortcutGroup = {
  titleKey: Parameters<typeof t>[0];
  shortcuts: { keys: string[]; labelKey: Parameters<typeof t>[0] }[];
};

const GROUPS: ShortcutGroup[] = [
  {
    titleKey: "shortcuts.group.playback",
    shortcuts: [
      { keys: ["Space"], labelKey: "shortcuts.togglePlay" },
      { keys: ["←"], labelKey: "shortcuts.previous" },
      { keys: ["→"], labelKey: "shortcuts.next" },
      { keys: ["Mod", "←"], labelKey: "shortcuts.seekBackward" },
      { keys: ["Mod", "→"], labelKey: "shortcuts.seekForward" },
      { keys: ["↑"], labelKey: "shortcuts.volumeUp" },
      { keys: ["↓"], labelKey: "shortcuts.volumeDown" },
      { keys: ["M"], labelKey: "shortcuts.mute" },
      { keys: ["S"], labelKey: "shortcuts.shuffle" },
      { keys: ["R"], labelKey: "shortcuts.repeat" },
    ],
  },
  {
    titleKey: "shortcuts.group.selection",
    shortcuts: [
      { keys: ["Mod", "A"], labelKey: "shortcuts.selectAll" },
      { keys: ["0", "–", "5"], labelKey: "shortcuts.rate" },
      { keys: ["Q"], labelKey: "shortcuts.queue" },
      { keys: ["N"], labelKey: "shortcuts.playNext" },
      { keys: ["Enter"], labelKey: "shortcuts.playSelected" },
      { keys: ["Delete"], labelKey: "shortcuts.remove" },
      { keys: ["Esc"], labelKey: "shortcuts.clearSelection" },
    ],
  },
  {
    titleKey: "shortcuts.group.library",
    shortcuts: [
      { keys: ["Mod", "F"], labelKey: "shortcuts.search" },
      { keys: ["Mod", "Z"], labelKey: "shortcuts.undo" },
      { keys: ["Mod", "⇧", "Z"], labelKey: "shortcuts.redo" },
      { keys: ["?"], labelKey: "shortcuts.help" },
    ],
  },
];

export const ShortcutHelpModal = ({ isOpen, onClose }: ShortcutHelpModalProps) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "?") {
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
        className="modal-panel-animate flex max-h-[80vh] w-full max-w-[640px] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-lg)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcuts.title")}
      >
        <div className="p-[var(--spacing-lg)]">
          <h2 className="text-[var(--font-size-md)] font-semibold text-[var(--color-text-primary)]">
            {t("shortcuts.title")}
          </h2>
          <p className="mt-[var(--spacing-xs)] text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {t("shortcuts.subtitle")}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-y border-[var(--color-border)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
          <div className="grid gap-[var(--spacing-lg)] sm:grid-cols-2">
            {GROUPS.map((group) => (
              <section key={group.titleKey}>
                <h3 className="mb-[var(--spacing-sm)] text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                  {t(group.titleKey)}
                </h3>
                <ul className="space-y-[var(--spacing-xs)]">
                  {group.shortcuts.map((shortcut) => (
                    <li
                      key={shortcut.labelKey}
                      className="flex items-center justify-between gap-[var(--spacing-md)]"
                    >
                      <span className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
                        {t(shortcut.labelKey)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {shortcut.keys.map((key, index) =>
                          key === "–" ? (
                            <span
                              key={index}
                              className="text-[10px] text-[var(--color-text-muted)]"
                            >
                              –
                            </span>
                          ) : (
                            <kbd
                              key={index}
                              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--color-text-muted)]"
                            >
                              {renderKey(key)}
                            </kbd>
                          )
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end p-[var(--spacing-lg)]">
          <button
            className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)]"
            onClick={onClose}
            type="button"
          >
            {t("shortcuts.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
