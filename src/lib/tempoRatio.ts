/**
 * Tempo-octave arithmetic shared by the mix engine and the analysis core. A leaf module on purpose: the analysis Web
 * Worker imports the core, and must not drag the mix engine's transition tables and cue logic in with it.
 */

/** BPM ratio (a/b) adjusted to whichever octave (1x, 2x, 0.5x) sits closest to 1 — treats double/half-tempo as compatible. */
export function bestTempoRatio(bpmA: number, bpmB: number): number {
  if (bpmA <= 0 || bpmB <= 0) return 1;
  const raw = bpmA / bpmB;
  const candidates = [raw, raw * 2, raw / 2];
  return candidates.reduce((best, r) => (Math.abs(r - 1) < Math.abs(best - 1) ? r : best));
}
