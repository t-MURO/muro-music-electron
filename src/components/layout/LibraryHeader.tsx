import {
  ArrowUpDown,
  Filter,
  LayoutGrid,
  List,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";

type LibraryHeaderProps = {
  title: string;
  subtitle: string;
  isSettings: boolean;
  resultCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onAddMusic: () => void;
  onShowColumns: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onSort: () => void;
};

export const LibraryHeader = ({
  title,
  subtitle,
  isSettings,
  resultCount,
  searchQuery,
  onSearchChange,
  onAddMusic,
  onShowColumns,
  onSort,
}: LibraryHeaderProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchShortcut = window.muro?.platform === "darwin" ? "⌘F" : "Ctrl F";
  const [compactTable, setCompactTable] = useState(
    () => window.localStorage.getItem("muro-table-density") === "compact"
  );
  const focusSearch = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "f" || event.key === "k")) {
        event.preventDefault();
        focusSearch();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        onSearchChange("");
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusSearch, onSearchChange]);

  useEffect(() => {
    const density = compactTable ? "compact" : "comfortable";
    document.documentElement.dataset.tableDensity = density;
    window.localStorage.setItem("muro-table-density", density);
  }, [compactTable]);

  return (
    <header className="library-command-bar shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div className={`min-h-[68px] items-center px-4 ${isSettings ? "flex" : "library-command-bar-inner"}`}>
        <div className="library-command-title min-w-0 shrink-0">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <h2 className="truncate text-[18px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">{title}</h2>
              {!isSettings && <span className="text-xs tabular-nums text-[var(--color-text-muted)]">{resultCount.toLocaleString()} tracks</span>}
            </div>
            {isSettings && subtitle && <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{subtitle}</p>}
          </div>
        </div>

        {!isSettings && (
          <>
            <div className="command-search-shell relative min-w-[210px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                ref={inputRef}
                className="command-search h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] pl-9 pr-14 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-light)]"
                placeholder="Search library"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
              />
              {searchQuery ? (
                <button className="toolbar-icon-button absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2" onClick={() => onSearchChange("")} aria-label={t("search.clear")} type="button"><X className="h-3.5 w-3.5" /></button>
              ) : (
                <kbd
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
                  data-search-shortcut-hint
                >
                  {searchShortcut}
                </kbd>
              )}
            </div>
            <button className="toolbar-button toolbar-button--ghost" onClick={focusSearch} title="Filter the current library view" type="button"><Filter className="h-4 w-4" /><span>Filters</span></button>
            <button className="toolbar-button toolbar-button--ghost" onClick={onSort} title="Cycle title sorting" type="button"><ArrowUpDown className="h-4 w-4" /><span>Sort</span></button>
            <button className="toolbar-button toolbar-button--primary" onClick={onAddMusic} type="button"><Plus className="h-4 w-4" /><span>Add Music</span></button>
            <div className="library-view-toggle">
              <button className="toolbar-icon-button toolbar-view-button" onClick={onShowColumns} title="Choose visible columns" aria-label="Choose visible columns" type="button"><LayoutGrid className="h-4 w-4" /></button>
              <button className={`toolbar-icon-button ${compactTable ? "toolbar-view-button" : ""}`} onClick={() => setCompactTable((value) => !value)} title="Toggle compact table" aria-label="Toggle compact table" aria-pressed={compactTable} type="button"><List className="h-4 w-4" /></button>
            </div>
          </>
        )}
      </div>
    </header>
  );
};
