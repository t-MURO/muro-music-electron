import { t } from "../../i18n";

type InboxBannerProps = {
  selectedCount: number;
  onAccept: () => void;
  onReject: () => void;
};

export const InboxBanner = ({ selectedCount, onAccept, onReject }: InboxBannerProps) => {
  return (
    <div className="px-[var(--spacing-lg)] pb-[var(--spacing-md)]">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-primary)] px-5 py-4 text-[var(--font-size-sm)]">
        <div className="text-[var(--font-size-xs)] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {t("inbox.review")}
        </div>
        <div className="flex items-center gap-2 rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-[var(--font-size-xs)]">
          <span className="text-[var(--color-text-secondary)]">{t("inbox.selected")}</span>
          <span className="font-bold text-[var(--color-accent)]">
            {selectedCount}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            disabled={selectedCount === 0}
            onClick={onAccept}
            className="flex h-[var(--button-height)] items-center rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-semibold text-white transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-40"
          >
            {t("inbox.accept")}
          </button>
          <button
            disabled={selectedCount === 0}
            onClick={onReject}
            className="flex h-[var(--button-height)] items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-bg-hover)] disabled:pointer-events-none disabled:opacity-40"
          >
            {t("inbox.reject")}
          </button>
        </div>
      </div>
    </div>
  );
};
