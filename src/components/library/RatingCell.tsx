import { memo, useState } from "react";

type RatingCellProps = {
  trackId: string;
  title: string;
  rating: number;
  onRate: (id: string, rating: number) => void;
};

export const RatingCell = memo(
  ({ trackId, title, rating, onRate }: RatingCellProps) => {
    const [hoverValue, setHoverValue] = useState<number | null>(null);
    const displayRating = hoverValue ?? rating;

    return (
      <div
        className="flex h-[var(--table-row-height)] items-center px-[var(--spacing-md)]"
        title={`${rating} / 5`}
        onMouseLeave={() => setHoverValue(null)}
        role="cell"
      >
        <div
          className="flex items-center gap-1 rounded-[var(--radius-sm)] -ml-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          aria-label={`Rating for ${title}`}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={rating}
          aria-valuetext={`${rating} out of 5`}
          onKeyDown={(event) => {
            const step = 0.5;
            if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              event.preventDefault();
              onRate(trackId, rating + step);
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              event.preventDefault();
              onRate(trackId, rating - step);
            }
            if (event.key === "Home") {
              event.preventDefault();
              onRate(trackId, 0);
            }
            if (event.key === "End") {
              event.preventDefault();
              onRate(trackId, 5);
            }
          }}
        >
          <button
            aria-label="Clear rating"
            className="flex h-5 w-5 items-center justify-center opacity-0"
            onClick={(event) => {
              event.stopPropagation();
              onRate(trackId, 0);
            }}
            onMouseMove={() => setHoverValue(0)}
            tabIndex={-1}
            title="Clear rating"
            type="button"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                fill="var(--color-text-muted)"
              />
            </svg>
          </button>
          {[1, 2, 3, 4, 5].map((star) => {
            const fill = Math.max(0, Math.min(1, displayRating - (star - 1)));
            return (
              <button
                key={star}
                aria-hidden="true"
                className="relative h-5 w-5 select-none focus:outline-none"
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const isHalf = event.clientX - rect.left < rect.width / 2;
                  onRate(trackId, isHalf ? star - 0.5 : star);
                }}
                onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const isHalf = event.clientX - rect.left < rect.width / 2;
                  setHoverValue(isHalf ? star - 0.5 : star);
                }}
                type="button"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
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
    );
  }
);
