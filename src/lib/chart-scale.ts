/**
 * Round tick values that cover [min, max], for example 61 to 64.4 gives
 * 60, 62, 64, 66. When min equals max the range is widened so the line is not
 * drawn on the edge, and an axis for values that are all non-negative never
 * starts below 0. `minStep` stops ticks from getting closer than that, for
 * example 1 for a count of reps.
 */
export function niceTicks(min: number, max: number, count = 5, minStep = 0): number[] {
  const allNonNegative = min >= 0;
  if (min === max) {
    // Widen a single value by 10% of its size, or by 1 when it is 0.
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  const step = Math.max(niceFraction * magnitude, minStep);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + (niceFraction === 2.5 ? 1 : 0));

  // A count or a total never goes below zero, so the axis should not either.
  const first = allNonNegative ? Math.max(0, Math.floor(min / step) * step) : Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= last + step / 2; value += step) {
    ticks.push(Number(value.toFixed(decimals)));
  }
  return ticks;
}

/** Up to `count` values spread evenly from min to max, or just one when they are equal. */
export function evenlySpaced(min: number, max: number, count: number): number[] {
  if (min === max || count < 2) return [min];
  return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
}
