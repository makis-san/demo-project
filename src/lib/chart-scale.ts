/**
 * Round tick values that cover [min, max], for example 61 to 64.4 gives
 * 60, 62, 64, 66. When min equals max the range is widened so the line is not
 * drawn on the edge.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const rawStep = (max - min) / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  const step = niceFraction * magnitude;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + (niceFraction === 2.5 ? 1 : 0));

  const first = Math.floor(min / step) * step;
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
