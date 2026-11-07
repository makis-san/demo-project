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

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="w-full h-auto">
      {yTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={scaleY(tick)}
            y2={scaleY(tick)}
            className="stroke-slate-200"
          />
          <text
            x={margin.left - 8}
            y={scaleY(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-slate-500 text-[11px]">
            {formatY(tick)}
          </text>
        </g>
      ))}
      {xLabels.map((tick) => (
        <text
          key={tick.x}
          x={scaleX(tick.x)}
          y={height - 12}
          textAnchor="middle"
          className="fill-slate-500 text-[11px]">
          {tick.label}
        </text>
      ))}
      {points.length > 1 && <path d={path} fill="none" strokeWidth={2} className="stroke-primary" />}
      {points.map((p, i) => (
        <circle key={`${p.x}-${p.y}-${i}`} cx={scaleX(p.x)} cy={scaleY(p.y)} r={4} className="fill-primary">
          <title>{p.title}</title>
        </circle>
      ))}
    </svg>
  );
}
