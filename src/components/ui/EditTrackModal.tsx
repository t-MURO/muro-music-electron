import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@muro/desktop/runtime";
import { convertFileSrc } from "@muro/desktop/runtime";
import { open } from "@muro/desktop/dialogs";
import { Disc3, Download, ImagePlus, LoaderCircle } from "lucide-react";
import { t } from "../../i18n";
import { notify } from "../../stores";
import type { Track, TrackMetadataUpdates } from "../../types";
import { Popover, PopoverHeader, PopoverItem } from "./Popover";

type FetchedCoverArt = {
  fullPath: string;
  thumbPath: string;
  sourceUrl?: string | null;
};

type EditTrackModalProps = {
  isOpen: boolean;
  tracks: Track[];
  onClose: () => void;
  onSave: (trackIds: string[], updates: TrackMetadataUpdates) => Promise<void>;
  onFetchCoverArt: (
    trackId: string,
    metadata: { album?: string; artist?: string },
  ) => Promise<FetchedCoverArt | null>;
};

type FormState = {
  title: string;
  artist: string;
  artists: string;
  album: string;
  trackNumber: string;
  trackTotal: string;
  discNumber: string;
  discTotal: string;
  year: string;
  genre: string;
  bpm: string;
  key: string;
  rating: number | null;
  comment: string;
  label: string;
  coverArtPath: string | null;
  coverArtThumbPath: string | null;
};

const EMPTY_FORM: FormState = {
  title: "",
  artist: "",
  artists: "",
  album: "",
  trackNumber: "",
  trackTotal: "",
  discNumber: "",
  discTotal: "",
  year: "",
  genre: "",
  bpm: "",
  key: "",
  rating: null,
  comment: "",
  label: "",
  coverArtPath: null,
  coverArtThumbPath: null,
};

const trackToForm = (track: Track): FormState => ({
  title: track.title ?? "",
  artist: track.artist ?? "",
  artists: track.artists ?? "",
  album: track.album ?? "",
  trackNumber: track.trackNumber != null ? String(track.trackNumber) : "",
  trackTotal: track.trackTotal != null ? String(track.trackTotal) : "",
  discNumber: track.discNumber != null ? String(track.discNumber) : "",
  discTotal: track.discTotal != null ? String(track.discTotal) : "",
  year: track.year != null ? String(track.year) : "",
  genre: track.genre ?? "",
  bpm: track.bpm != null ? String(track.bpm) : "",
  key: track.key ?? "",
  rating: track.rating,
  comment: track.comment ?? "",
  label: track.label ?? "",
  coverArtPath: track.coverArtPath ?? null,
  coverArtThumbPath: track.coverArtThumbPath ?? null,
});

export const EditTrackModal = ({
  isOpen,
  tracks,
  onClose,
  onSave,
  onFetchCoverArt,
}: EditTrackModalProps) => {
  const isBatch = tracks.length > 1;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverMenuPosition, setCoverMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [isFetchingCover, setIsFetchingCover] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  // Stable key: only re-init when the modal opens with new track IDs
  const trackIdKey = tracks.map((t) => t.id).join(",");

  // Initialize form when modal opens (or track selection changes)
  useEffect(() => {
    if (!isOpen || tracks.length === 0) return;

    if (isBatch) {
      setForm(EMPTY_FORM);
      setDirtyFields(new Set());
    } else {
      setForm(trackToForm(tracks[0]));
      setDirtyFields(new Set());
    }
    setCoverPreview(null);
    setCoverMenuPosition(null);
    setIsFetchingCover(false);
    setIsSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, trackIdKey]);

  // Auto-focus title input
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (coverMenuPosition) {
          setCoverMenuPosition(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [coverMenuPosition, isOpen, onClose]);

  const updateField = useCallback(
    (field: keyof FormState, value: string | number | null) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      if (isBatch) {
        setDirtyFields((prev) => new Set(prev).add(field));
      }
    },
    [isBatch]
  );

  // Cover art from current track(s) for display
  const existingCoverSrc = useMemo(() => {
    if (coverPreview) return coverPreview;
    if (!isBatch && tracks[0]?.coverArtPath) {
      return convertFileSrc(tracks[0].coverArtPath);
    }
    return null;
  }, [coverPreview, isBatch, tracks]);

  const handleCoverArtClick = useCallback(async () => {
    try {
      const result = await open({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "webp", "gif"],
          },
        ],
      });

      if (!result) return;

      const filePath = Array.isArray(result) ? result[0] : result;
      const cached = await invoke<{ fullPath: string; thumbPath: string }>(
        "cache_cover_art_from_file",
        { filePath }
      );

      updateField("coverArtPath", cached.fullPath);
      updateField("coverArtThumbPath", cached.thumbPath);
      setCoverPreview(convertFileSrc(cached.fullPath));
    } catch (error) {
      console.error("Failed to cache cover art:", error);
    }
  }, [updateField]);

  const handleFetchCoverArt = useCallback(async () => {
    const track = tracks[0];
    if (!track || isFetchingCover) return;
    setCoverMenuPosition(null);
    setIsFetchingCover(true);
    try {
      const cached = await onFetchCoverArt(track.id, {
        album: form.album.trim() || track.album,
        artist: form.artists.trim() || form.artist.trim() || track.artists || track.artist,
      });
      if (!cached) {
        notify.info(t("edit.coverArtFetchNotFound"));
        return;
      }
      updateField("coverArtPath", cached.fullPath);
      updateField("coverArtThumbPath", cached.thumbPath);
      setCoverPreview(convertFileSrc(cached.fullPath));
      notify.success(t("edit.coverArtFetched"));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : t("edit.coverArtFetchFailed"));
    } finally {
      setIsFetchingCover(false);
    }
  }, [form.album, form.artist, form.artists, isFetchingCover, onFetchCoverArt, tracks, updateField]);

  const handleRatingClick = useCallback(
    (event: React.MouseEvent, star: number) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const isHalf = event.clientX - rect.left < rect.width / 2;
      const newRating = isHalf ? star - 0.5 : star;
      // Toggle off if clicking same value
      const currentRating = form.rating;
      updateField("rating", currentRating === newRating ? 0 : newRating);
    },
    [form.rating, updateField]
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);

    try {
      const updates: TrackMetadataUpdates = {};

      if (isBatch) {
        // Only send dirty fields
        for (const field of dirtyFields) {
          assignUpdate(updates, field as keyof FormState, form);
        }
      } else {
        // Send all fields for single track
        assignUpdate(updates, "title", form);
        assignUpdate(updates, "artist", form);
        assignUpdate(updates, "artists", form);
        assignUpdate(updates, "album", form);
        assignUpdate(updates, "trackNumber", form);
        assignUpdate(updates, "trackTotal", form);
        assignUpdate(updates, "discNumber", form);
        assignUpdate(updates, "discTotal", form);
        assignUpdate(updates, "year", form);
        assignUpdate(updates, "genre", form);
        assignUpdate(updates, "bpm", form);
        assignUpdate(updates, "key", form);
        assignUpdate(updates, "rating", form);
        assignUpdate(updates, "comment", form);
        assignUpdate(updates, "label", form);
        if (form.coverArtPath !== null) {
          updates.coverArtPath = form.coverArtPath;
        }
        if (form.coverArtThumbPath !== null) {
          updates.coverArtThumbPath = form.coverArtThumbPath;
        }
      }

      // For batch, always include cover art if changed
      if (isBatch && dirtyFields.has("coverArtPath") && form.coverArtPath !== null) {
        updates.coverArtPath = form.coverArtPath;
        updates.coverArtThumbPath = form.coverArtThumbPath ?? undefined;
      }

      const trackIds = tracks.map((t) => t.id);
      await onSave(trackIds, updates);
      onClose();
    } catch (error) {
      console.error("Failed to save metadata:", error);
    } finally {
      setIsSaving(false);
    }
  }, [form, dirtyFields, isBatch, tracks, onSave, onClose]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  const displayRating = form.rating ?? 0;

  return createPortal(
    <div
      className="modal-overlay-animate fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-[var(--spacing-lg)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="modal-panel-animate flex max-h-[85vh] w-full max-w-[640px] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-[var(--shadow-lg)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[var(--color-border)] p-[var(--spacing-lg)]">
          <h2 className="text-[var(--font-size-md)] font-semibold text-[var(--color-text-primary)]">
            {isBatch
              ? t("edit.title.batch", { count: String(tracks.length) })
              : t("edit.title.single")}
          </h2>
          <p className="mt-[var(--spacing-xs)] text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
            {isBatch
              ? t("edit.subtitle.batch")
              : t("edit.subtitle.single")}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-[var(--spacing-lg)]">
          <div className="flex gap-[var(--spacing-lg)]">
            {/* Cover art (left column) */}
            <button
              type="button"
              className="group relative h-[140px] w-[140px] flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] transition-colors hover:border-[var(--color-accent)]"
              onClick={handleCoverArtClick}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setCoverMenuPosition({ x: event.clientX, y: event.clientY });
              }}
              title={t("edit.coverArt")}
              data-cover-art-field
            >
              {existingCoverSrc ? (
                <img
                  src={existingCoverSrc}
                  alt="Cover art"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-[var(--spacing-sm)] text-[var(--color-text-muted)]">
                  <Disc3 className="h-10 w-10 opacity-30" />
                </div>
              )}
              <div className={`absolute inset-0 flex items-center justify-center transition-colors ${isFetchingCover ? "bg-black/45" : "bg-black/0 group-hover:bg-black/40"}`}>
                {isFetchingCover ? (
                  <LoaderCircle className="h-6 w-6 animate-spin text-white" aria-label={t("edit.coverArtFetching")} />
                ) : (
                  <ImagePlus className="h-6 w-6 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </div>
            </button>

            {/* Right column: title, artist, album artist, album */}
            <div className="flex flex-1 flex-col gap-[var(--spacing-sm)]">
              <Field
                label={t("edit.field.title")}
                value={form.title}
                placeholder={isBatch ? t("edit.placeholder.keep") : ""}
                onChange={(v) => updateField("title", v)}
                inputRef={titleRef}
              />
              <Field
                label={t("edit.field.artist")}
                value={form.artist}
                placeholder={isBatch ? t("edit.placeholder.keep") : ""}
                onChange={(v) => updateField("artist", v)}
              />
              <Field
                label={t("edit.field.albumArtist")}
                value={form.artists}
                placeholder={isBatch ? t("edit.placeholder.keep") : ""}
                onChange={(v) => updateField("artists", v)}
              />
              <Field
                label={t("edit.field.album")}
                value={form.album}
                placeholder={isBatch ? t("edit.placeholder.keep") : ""}
                onChange={(v) => updateField("album", v)}
              />
            </div>
          </div>

          {/* Grid of smaller fields */}
          <div className="mt-[var(--spacing-md)] grid grid-cols-2 gap-x-[var(--spacing-md)] gap-y-[var(--spacing-sm)]">
            <div className="flex gap-[var(--spacing-sm)]">
              <Field
                label={t("edit.field.track")}
                value={form.trackNumber}
                placeholder={isBatch ? "--" : ""}
                onChange={(v) => updateField("trackNumber", v)}
                type="number"
                className="flex-1"
              />
              <Field
                label={t("edit.field.of")}
                value={form.trackTotal}
                placeholder={isBatch ? "--" : ""}
                onChange={(v) => updateField("trackTotal", v)}
                type="number"
                className="flex-1"
              />
            </div>
            <div className="flex gap-[var(--spacing-sm)]">
              <Field
                label={t("edit.field.disc")}
                value={form.discNumber}
                placeholder={isBatch ? "--" : ""}
                onChange={(v) => updateField("discNumber", v)}
                type="number"
                className="flex-1"
              />
              <Field
                label={t("edit.field.of")}
                value={form.discTotal}
                placeholder={isBatch ? "--" : ""}
                onChange={(v) => updateField("discTotal", v)}
                type="number"
                className="flex-1"
              />
            </div>
            <Field
              label={t("edit.field.year")}
              value={form.year}
              placeholder={isBatch ? t("edit.placeholder.keep") : ""}
              onChange={(v) => updateField("year", v)}
              type="number"
            />
            <Field
              label={t("edit.field.genre")}
              value={form.genre}
              placeholder={isBatch ? t("edit.placeholder.keep") : ""}
              onChange={(v) => updateField("genre", v)}
            />
            <Field
              label={t("edit.field.bpm")}
              value={form.bpm}
              placeholder={isBatch ? t("edit.placeholder.keep") : ""}
              onChange={(v) => updateField("bpm", v)}
              type="number"
            />
            <Field
              label={t("edit.field.key")}
              value={form.key}
              placeholder={isBatch ? t("edit.placeholder.keep") : ""}
              onChange={(v) => updateField("key", v)}
            />
          </div>

          {/* Rating */}
          <div className="mt-[var(--spacing-sm)]">
            <label className="mb-[var(--spacing-xs)] block text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
              {t("edit.field.rating")}
            </label>
            <div
              className="flex items-center gap-1"
              onMouseLeave={() => {}}
            >
              {[1, 2, 3, 4, 5].map((star) => {
                const fill = Math.max(0, Math.min(1, displayRating - (star - 1)));
                return (
                  <button
                    key={star}
                    type="button"
                    className="relative h-6 w-6 select-none focus:outline-none"
                    onClick={(e) => handleRatingClick(e, star)}
                  >
                    <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                        fill="var(--color-text-muted)"
                        opacity="0.3"
                      />
                      <path
                        d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                        fill="var(--color-accent)"
                        style={{ clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` }}
                      />
                    </svg>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Label */}
          <div className="mt-[var(--spacing-sm)]">
            <Field
              label={t("edit.field.label")}
              value={form.label}
              placeholder={isBatch ? t("edit.placeholder.keep") : ""}
              onChange={(v) => updateField("label", v)}
            />
          </div>

          {/* Comment */}
          <div className="mt-[var(--spacing-sm)]">
            <Field
              label={t("edit.field.comment")}
              value={form.comment}
              placeholder={isBatch ? t("edit.placeholder.keep") : ""}
              onChange={(v) => updateField("comment", v)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--color-border)] p-[var(--spacing-lg)]">
          <div className="flex items-center justify-end gap-[var(--spacing-sm)]">
            <button
              className="rounded-[var(--radius-md)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
              onClick={onClose}
              type="button"
            >
              {t("edit.cancel")}
            </button>
            <button
              className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleSave}
              disabled={isSaving}
              type="button"
            >
              {isSaving ? t("edit.saving") : t("edit.save")}
            </button>
          </div>
        </div>
        <Popover
          isOpen={coverMenuPosition !== null}
          position={coverMenuPosition ?? { x: 0, y: 0 }}
          className="w-52 py-1"
          onClose={() => setCoverMenuPosition(null)}
        >
          <PopoverHeader>{t("edit.coverArtMenu")}</PopoverHeader>
          <PopoverItem
            onClick={() => { void handleFetchCoverArt(); }}
            dataTestId="fetch-cover-art-menu-item"
          >
            <Download className="h-4 w-4 opacity-60" />
            {t("edit.fetchCoverArt")}
          </PopoverItem>
        </Popover>
      </div>
    </div>,
    document.body
  );
};

// ---------- Helpers ----------

type FieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
};

const Field = ({
  label,
  value,
  placeholder,
  onChange,
  type = "text",
  className,
  inputRef,
}: FieldProps) => (
  <div className={className}>
    <label className="mb-[var(--spacing-xs)] block text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)]">
      {label}
    </label>
    <input
      ref={inputRef}
      className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-[var(--spacing-md)] py-[var(--spacing-sm)] text-[var(--font-size-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

function assignUpdate(
  updates: TrackMetadataUpdates,
  field: keyof FormState,
  form: FormState
) {
  switch (field) {
    case "title":
      updates.title = form.title;
      break;
    case "artist":
      updates.artist = form.artist;
      break;
    case "artists":
      updates.artists = form.artists;
      break;
    case "album":
      updates.album = form.album;
      break;
    case "trackNumber":
      updates.trackNumber = form.trackNumber ? Number(form.trackNumber) : undefined;
      break;
    case "trackTotal":
      updates.trackTotal = form.trackTotal ? Number(form.trackTotal) : undefined;
      break;
    case "discNumber":
      updates.discNumber = form.discNumber ? Number(form.discNumber) : undefined;
      break;
    case "discTotal":
      updates.discTotal = form.discTotal ? Number(form.discTotal) : undefined;
      break;
    case "year":
      updates.year = form.year ? Number(form.year) : undefined;
      break;
    case "genre":
      updates.genre = form.genre;
      break;
    case "bpm":
      updates.bpm = form.bpm ? Number(form.bpm) : undefined;
      break;
    case "key":
      updates.key = form.key;
      break;
    case "rating":
      updates.rating = form.rating ?? undefined;
      break;
    case "comment":
      updates.comment = form.comment;
      break;
    case "label":
      updates.label = form.label;
      break;
    case "coverArtPath":
      if (form.coverArtPath !== null) {
        updates.coverArtPath = form.coverArtPath;
      }
      break;
    case "coverArtThumbPath":
      if (form.coverArtThumbPath !== null) {
        updates.coverArtThumbPath = form.coverArtThumbPath;
      }
      break;
  }
}
