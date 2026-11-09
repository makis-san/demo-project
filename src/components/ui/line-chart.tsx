import { useEffect, useId, useRef } from "react";
import { evenlySpaced, niceTicks } from "@/lib/chart-scale";

export type ChartPoint = {
  /** Position on the x axis, for example a time in milliseconds. */
  x: number;
  y: number;
  /** Text shown when hovering the point. */
  title: string;
};

type LineChartProps = {
  points: ChartPoint[];
  formatX: (x: number) => string;
  formatY?: (y: number) => string;
  /** Smallest gap between y axis labels, for example 1 so a count of reps never shows 7.5. */
  minTickStep?: number;
  ariaLabel: string;
};

// The chart is drawn in a fixed coordinate system and scaled with the viewBox,
// so it renders the same on the server and in the browser without measuring.
// It never gets narrower than that drawing, so its text stays at the size it is drawn at (11px). On a screen
// narrower than the drawing it scrolls sideways inside its card, because scaled down to a phone's width the
// text would be about 5px. It opens scrolled to the end, where the latest reading and the last date are, and the
// y axis labels are a column that sticks to the left edge, so they stay in view while the plot moves.
const width = 640;
const height = 280;
const margin = { top: 16, right: 24, bottom: 36, left: 56 };
const plotWidth = width - margin.left - margin.right;
const plotHeight = height - margin.top - margin.bottom;

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function LineChart({
  points,
  formatX,
  formatY = (y) => numberFormat.format(y),
  minTickStep = 0,
  ariaLabel,
}: LineChartProps) {
  // useId gives characters like ":" that a url(#...) reference cannot hold.
  const gradientId = `chart-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);

  const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 5, minTickStep);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];

  const scaleX = (x: number) =>
    margin.left + (xMax === xMin ? plotWidth / 2 : ((x - xMin) / (xMax - xMin)) * plotWidth);
  const scaleY = (y: number) => margin.top + plotHeight - ((y - yMin) / (yMax - yMin)) * plotHeight;

  // Evenly spaced labels, skipping any that repeat the previous text.
  const xLabels = evenlySpaced(xMin, xMax, Math.min(5, points.length))
    .map((x) => ({ x, label: formatX(x) }))
    .filter((tick, i, all) => i === 0 || tick.label !== all[i - 1].label);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`)
    .join(" ");

  const baseline = margin.top + plotHeight;
  const area =
    points.length > 1
      ? `${path} L${scaleX(points[points.length - 1].x).toFixed(1)},${baseline} L${scaleX(points[0].x).toFixed(1)},${baseline} Z`
      : "";

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [points.length]);

  return (
    <div
      ref={scroller}
      className="grid overflow-x-auto rounded-2xl"
      style={{ gridTemplateColumns: `minmax(${width}px, 1fr)` }}
      tabIndex={0}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="col-start-1 row-start-1 h-auto w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => (
          <line
            key={tick}
            x1={margin.left}
            x2={width - margin.right}
            y1={scaleY(tick)}
            y2={scaleY(tick)}
            className="stroke-line"
            strokeDasharray="2 6"
            strokeLinecap="round"
          />
        ))}
        {xLabels.map((tick) => (
          <text
            key={tick.x}
            x={scaleX(tick.x)}
            y={height - 12}
            textAnchor="middle"
            className="num fill-faint text-[11px]">
            {tick.label}
          </text>
        ))}
        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {points.length > 1 && (
          <path
            d={path}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-primary"
          />
        )}
        {points.map((p, i) => (
          <circle
            key={`${p.x}-${p.y}-${i}`}
            cx={scaleX(p.x)}
            cy={scaleY(p.y)}
            r={4.5}
            strokeWidth={2}
            // The latest reading is filled, the rest are rings.
            className={`${i === points.length - 1 ? "fill-primary" : "fill-ground"} stroke-primary hover:fill-primary`}>
            <title>{p.title}</title>
          </circle>
        ))}
      </svg>
      <div
        aria-hidden="true"
        className="pointer-events-none sticky left-0 z-10 col-start-1 row-start-1 bg-gradient-to-r from-ground/60 via-ground/30 to-transparent"
        style={{ width: `${((margin.left + 8) / width) * 100}%` }}>
        {yTicks.map((tick) => (
          <span
            key={tick}
            className="num absolute text-right text-[11px] text-faint lg:text-[13px]"
            style={{
              top: `${(scaleY(tick) / height) * 100}%`,
              width: `${(margin.left / width) * 100}%`,
              paddingRight: `${(8 / width) * 100}%`,
              transform: "translateY(-50%)",
            }}>
            {formatY(tick)}
          </span>
        ))}
      </div>
    </div>
  );
}
