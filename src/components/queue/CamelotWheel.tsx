import { useMemo } from "react";
import { getCompatibleCamelotCodes } from "../../utils/camelot";

type CamelotWheelProps = {
  currentCode: string;
  selectedCode: string | null;
  onSelectCode: (code: string | null) => void;
};

const CENTER = 120;

const pointOnCircle = (radius: number, angle: number) => {
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTER + (radius * Math.cos(radians)),
    y: CENTER + (radius * Math.sin(radians)),
  };
};

const ringSegmentPath = (
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) => {
  const outerStart = pointOnCircle(outerRadius, startAngle);
  const outerEnd = pointOnCircle(outerRadius, endAngle);
  const innerEnd = pointOnCircle(innerRadius, endAngle);
  const innerStart = pointOnCircle(innerRadius, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
};

const segments = Array.from({ length: 12 }, (_, index) => {
  const number = index + 1;
  const centerAngle = -90 + (index * 30);
  return [
    {
      code: `${number}B`,
      path: ringSegmentPath(77, 111, centerAngle - 14.4, centerAngle + 14.4),
      label: pointOnCircle(94, centerAngle),
    },
    {
      code: `${number}A`,
      path: ringSegmentPath(45, 76, centerAngle - 14.4, centerAngle + 14.4),
      label: pointOnCircle(61, centerAngle),
    },
  ];
}).flat();

export const CamelotWheel = ({
  currentCode,
  selectedCode,
  onSelectCode,
}: CamelotWheelProps) => {
  const compatibleCodes = useMemo(
    () => new Set(getCompatibleCamelotCodes(currentCode)),
    [currentCode],
  );

  return (
    <div className="mx-auto w-full max-w-[280px]" data-camelot-wheel>
      <svg viewBox="0 0 240 240" className="block h-auto w-full" aria-label={`Camelot wheel, current key ${currentCode}`}>
        <circle cx={CENTER} cy={CENTER} r="112" fill="var(--color-bg-primary)" stroke="var(--color-border)" />
        {segments.map(({ code, path, label }) => {
          const isCurrent = code === currentCode;
          const isCompatible = compatibleCodes.has(code);
          const isSelected = code === selectedCode;
          const fill = isSelected || isCurrent
            ? "var(--color-accent)"
            : isCompatible
              ? "var(--color-accent-light)"
              : "var(--color-bg-tertiary)";
          const textFill = isSelected || isCurrent
            ? "#ffffff"
            : isCompatible
              ? "var(--color-accent)"
              : "var(--color-text-muted)";
          const activate = () => onSelectCode(isSelected ? null : code);
          return (
            <g
              key={code}
              className="camelot-segment cursor-pointer outline-none"
              role="button"
              tabIndex={0}
              aria-label={`${code}${isCurrent ? ", current key" : isCompatible ? ", compatible key" : ""}`}
              aria-pressed={isSelected}
              data-camelot-code={code}
              data-camelot-current={isCurrent ? "true" : undefined}
              data-camelot-compatible={isCompatible ? "true" : undefined}
              data-camelot-selected={isSelected ? "true" : undefined}
              onClick={activate}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate();
                }
              }}
            >
              <title>{code}{isCurrent ? " - current key" : isCompatible ? " - compatible mix" : ""}</title>
              <path
                d={path}
                fill={fill}
                stroke={isCurrent || isSelected ? "var(--color-accent)" : "var(--color-border)"}
                strokeWidth={isCurrent || isSelected ? 2.2 : 0.8}
                className="transition-opacity hover:opacity-80"
              />
              <text
                x={label.x}
                y={label.y}
                fill={textFill}
                fontSize="9.5"
                fontWeight={isCurrent || isSelected || isCompatible ? 700 : 500}
                textAnchor="middle"
                dominantBaseline="central"
                className="pointer-events-none select-none"
              >
                {code}
              </text>
            </g>
          );
        })}
        <g
          className="camelot-segment cursor-pointer outline-none"
          role="button"
          tabIndex={0}
          aria-label="Show automatic compatible matches"
          onClick={() => onSelectCode(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectCode(null);
            }
          }}
          data-camelot-auto
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r="40"
            fill={selectedCode === null ? "var(--color-accent-light)" : "var(--color-bg-primary)"}
            stroke={selectedCode === null ? "var(--color-accent)" : "var(--color-border)"}
            strokeWidth="1.5"
          />
          <text x={CENTER} y="116" fill="var(--color-text-primary)" fontSize="15" fontWeight="800" textAnchor="middle">{currentCode}</text>
          <text x={CENTER} y="131" fill="var(--color-text-muted)" fontSize="8.5" fontWeight="600" letterSpacing="1" textAnchor="middle">AUTO MIX</text>
        </g>
      </svg>
      <div className="mt-1 flex items-center justify-center gap-3 text-[9px] text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />Current</span>
        <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent-light)] ring-1 ring-[var(--color-accent)]" />Compatible</span>
        <span>Click to filter</span>
      </div>
    </div>
  );
};
