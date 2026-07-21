import { Check, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import {
  countAdvancedTrackFilters,
  type AdvancedTrackFilters,
  type MissingMetadataField,
} from "../../utils/trackFilters";

type AdvancedFilterPopoverProps = {
  filters: AdvancedTrackFilters;
  formats: string[];
  onChange: (filters: AdvancedTrackFilters) => void;
  onReset: () => void;
  onClose: () => void;
};

const missingFields: Array<{ id: MissingMetadataField; label: string }> = [
  { id: "albumArtist", label: "Album artist" },
  { id: "album", label: "Album" },
  { id: "genre", label: "Genre" },
  { id: "year", label: "Year" },
  { id: "key", label: "Key" },
  { id: "bpm", label: "BPM" },
  { id: "artwork", label: "Artwork" },
  { id: "label", label: "Label" },
  { id: "comment", label: "Comment" },
];

const optionalNumber = (value: string) => value === "" ? null : Number(value);

const fieldClass =
  "h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-light)]";

export const AdvancedFilterPopover = ({
  filters,
  formats,
  onChange,
  onReset,
  onClose,
}: AdvancedFilterPopoverProps) => {
  const activeCount = countAdvancedTrackFilters(filters);
  const update = <K extends keyof AdvancedTrackFilters,>(
    key: K,
    value: AdvancedTrackFilters[K],
  ) => onChange({ ...filters, [key]: value });

  const toggleMissing = (field: MissingMetadataField) => {
    update(
      "missingMetadata",
      filters.missingMetadata.includes(field)
        ? filters.missingMetadata.filter((value) => value !== field)
        : [...filters.missingMetadata, field],
    );
  };

  return (
    <div
      className="absolute right-0 top-[calc(100%+8px)] z-[80] flex max-h-[min(680px,calc(100vh-110px))] w-[440px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-[0_18px_48px_rgba(0,0,0,0.5)]"
      role="dialog"
      aria-label="Advanced track filters"
      data-advanced-filter-popover
    >
      <div className="flex items-center gap-3 border-b border-[var(--color-border-light)] px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          <SlidersHorizontal className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-[13px] font-semibold text-[var(--color-text-primary)]">Advanced filters</strong>
          <small className="block text-[10px] text-[var(--color-text-muted)]">
            {activeCount === 0 ? "No filters applied" : `${activeCount} active ${activeCount === 1 ? "filter" : "filters"}`}
          </small>
        </span>
        {activeCount > 0 && (
          <button
            className="flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2 text-[10px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={onReset}
            data-advanced-filter-reset
            type="button"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        )}
        <button
          className="toolbar-icon-button h-7 w-7"
          onClick={onClose}
          aria-label="Close advanced filters"
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="overflow-y-auto p-4">
        <section>
          <div className="mb-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">Missing metadata</h4>
            <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">Selected fields must all be empty.</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {missingFields.map((field) => {
              const selected = filters.missingMetadata.includes(field.id);
              return (
                <button
                  key={field.id}
                  className={`flex h-8 min-w-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-2 text-left text-[10px] transition-colors ${selected ? "border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[var(--color-accent)]" : "border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
                  onClick={() => toggleMissing(field.id)}
                  role="checkbox"
                  aria-checked={selected}
                  data-missing-filter={field.id}
                  type="button"
                >
                  <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border ${selected ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-text-muted)]"}`}>
                    {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                  <span className="truncate">{field.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5 border-t border-[var(--color-border-light)] pt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">Analysis and file</h4>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-[var(--color-text-muted)]">
              <span className="mb-1 block">Key/BPM analysis</span>
              <select className={fieldClass} value={filters.analysis} onChange={(event) => update("analysis", event.target.value as AdvancedTrackFilters["analysis"])}>
                <option value="any">Any status</option>
                <option value="complete">Fully analyzed</option>
                <option value="incomplete">Missing key or BPM</option>
              </select>
            </label>
            <label className="text-[10px] text-[var(--color-text-muted)]">
              <span className="mb-1 block">File format</span>
              <select className={fieldClass} value={filters.format} onChange={(event) => update("format", event.target.value)}>
                <option value="">Any format</option>
                {formats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="mt-5 border-t border-[var(--color-border-light)] pt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">Ranges</h4>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <RangeFields label="BPM" min={filters.bpmMin} max={filters.bpmMax} minPlaceholder="Min" maxPlaceholder="Max" onMin={(value) => update("bpmMin", value)} onMax={(value) => update("bpmMax", value)} />
            <RangeFields label="Year" min={filters.yearMin} max={filters.yearMax} minPlaceholder="From" maxPlaceholder="To" onMin={(value) => update("yearMin", value)} onMax={(value) => update("yearMax", value)} />
            <RangeFields label="Duration (minutes)" min={filters.durationMinMinutes} max={filters.durationMaxMinutes} minPlaceholder="Min" maxPlaceholder="Max" step="0.5" onMin={(value) => update("durationMinMinutes", value)} onMax={(value) => update("durationMaxMinutes", value)} />
            <label className="text-[10px] text-[var(--color-text-muted)]">
              <span className="mb-1 block">Minimum rating</span>
              <select className={fieldClass} value={filters.ratingMin ?? ""} onChange={(event) => update("ratingMin", optionalNumber(event.target.value))}>
                <option value="">Any rating</option>
                {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}+ stars</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="mt-5 border-t border-[var(--color-border-light)] pt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">Text fields</h4>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-[var(--color-text-muted)]">
              <span className="mb-1 block">Genre contains</span>
              <input className={fieldClass} value={filters.genre} onChange={(event) => update("genre", event.target.value)} placeholder="e.g. techno" />
            </label>
            <label className="text-[10px] text-[var(--color-text-muted)]">
              <span className="mb-1 block">Label contains</span>
              <input className={fieldClass} value={filters.label} onChange={(event) => update("label", event.target.value)} placeholder="e.g. Kompakt" />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
};

type RangeFieldsProps = {
  label: string;
  min: number | null;
  max: number | null;
  minPlaceholder: string;
  maxPlaceholder: string;
  step?: string;
  onMin: (value: number | null) => void;
  onMax: (value: number | null) => void;
};

const RangeFields = ({ label, min, max, minPlaceholder, maxPlaceholder, step = "1", onMin, onMax }: RangeFieldsProps) => (
  <fieldset>
    <legend className="mb-1 text-[10px] text-[var(--color-text-muted)]">{label}</legend>
    <div className="grid grid-cols-2 gap-1.5">
      <input className={fieldClass} type="number" min="0" step={step} value={min ?? ""} onChange={(event) => onMin(optionalNumber(event.target.value))} placeholder={minPlaceholder} aria-label={`${label} ${minPlaceholder}`} />
      <input className={fieldClass} type="number" min="0" step={step} value={max ?? ""} onChange={(event) => onMax(optionalNumber(event.target.value))} placeholder={maxPlaceholder} aria-label={`${label} ${maxPlaceholder}`} />
    </div>
  </fieldset>
);
