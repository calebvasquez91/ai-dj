/**
 * Pull-to-refresh arithmetic: how far the page follows a downward drag from the top, and whether a release refreshes.
 * The gesture itself is ui/usePullToRefresh.ts.
 */
export const PULL_THRESHOLD_PX = 72;
export const PULL_MAX_PX = 110;

/** How far the page follows a drag of `dragPx`: half as far (the pull feels heavy), never past the maximum, never negative. */
export function pullOffset(dragPx: number): number {
  if (!Number.isFinite(dragPx) || dragPx <= 0) return 0;
  return Math.min(PULL_MAX_PX, dragPx * 0.5);
}

/** Whether letting go at this offset refreshes. */
export function shouldRefresh(offsetPx: number): boolean {
  return offsetPx >= PULL_THRESHOLD_PX * 0.5;
}
