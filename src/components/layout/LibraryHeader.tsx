import { Search, X } from "lucide-react";
import { useCallback, useRef, useEffect } from "react";
import { t } from "../../i18n";

type LibraryHeaderProps = {
  title: string;
  subtitle: string;
  isSettings: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
};

export const LibraryHeader = ({
  title,
  subtitle,
  isSettings,
  searchQuery,
  onSearchChange,
}: LibraryHeaderProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = useCallback(() => {
    onSearchChange("");
    inputRef.current?.focus();
  }, [onSearchChange]);

  // Keyboard shortcuts: Cmd/Ctrl+F or Cmd/Ctrl+K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "k")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      // Escape to clear and blur
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        onSearchChange("");
        inputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSearchChange]);

  return (
    <header
      className="flex items-start justify-between border-b border-[var(--color-border-light)] bg-[var(--color-bg-primary)] p-[var(--spacing-lg)] pt-12"
    >
      <div className="flex flex-col gap-[var(--spacing-xs)]">
        <h2 className="text-[var(--font-size-xl)] font-semibold text-[var(--color-text-primary)]">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
            {subtitle}
          </p>
        )}
      </div>
      {!isSettings && (
        <div className="flex items-center gap-[var(--spacing-md)]">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-[var(--spacing-md)] h-4 w-4 text-[var(--color-text-muted)]" />
            <input
              ref={inputRef}
              className="h-[var(--input-height)] w-60 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] pl-[calc(var(--spacing-md)+24px)] pr-[calc(var(--spacing-md)+24px)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-light)]"
              placeholder={t("search.placeholder")}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute right-[var(--spacing-md)] flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                onClick={handleClear}
                type="button"
                aria-label={t("search.clear")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
