import { FileAudio, FolderOpen } from "lucide-react";

type TableEmptyStateProps = {
  title: string;
  description: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
};

export const TableEmptyState = ({
  title,
  description,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}: TableEmptyStateProps) => {
  return (
    <div className="flex min-h-[240px] items-center justify-center px-[var(--spacing-lg)] py-10">
      <div className="max-w-md rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-6 py-5 text-center">
        <div className="text-[var(--font-size-md)] font-semibold text-[var(--color-text-primary)]">
          {title}
        </div>
        <div className="mt-2 text-[var(--font-size-sm)] leading-relaxed text-[var(--color-text-secondary)]">
          {description}
        </div>
        {(primaryActionLabel || secondaryActionLabel) && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {primaryActionLabel && onPrimaryAction && (
              <button
                className="flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-white transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-accent-hover)]"
                type="button"
                onClick={onPrimaryAction}
              >
                <FileAudio className="h-4 w-4" />
                {primaryActionLabel}
              </button>
            )}
            {secondaryActionLabel && onSecondaryAction && (
              <button
                className="flex h-[var(--button-height)] items-center gap-[var(--spacing-sm)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-[var(--spacing-md)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)] transition-all duration-[var(--transition-fast)] hover:bg-[var(--color-bg-hover)]"
                type="button"
                onClick={onSecondaryAction}
              >
                <FolderOpen className="h-4 w-4" />
                {secondaryActionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
