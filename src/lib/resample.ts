/**
 * Squeezes a series of values into `count` buckets (each bucket covers an equal slice of the source), reducing every
 * slice with its max (peaks, for drawing a waveform) or its mean (levels, for an energy profile). Fewer source values
 * than buckets are returned as they are. Non-finite source values count as 0.
 */
export function resampleBuckets(values: number[], count: number, reduce: "max" | "mean"): number[] {
  if (count <= 0) return [];
  if (values.length <= count) return values.slice();
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * values.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / count));
    let acc = 0;
    for (let j = from; j < to; j++) {
      const v = Number.isFinite(values[j]) ? values[j] : 0;
      acc = reduce === "max" ? Math.max(acc, v) : acc + v;
    }
    return reduce === "max" ? acc : acc / (to - from);
  });
}
