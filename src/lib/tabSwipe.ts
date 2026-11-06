/**
 * Swiping between the Now Playing sheet's tabs: which way a drag goes, and which tab that lands on. Pure; the touch
 * handling is in components/NowPlayingTabs.tsx.
 */
export const SWIPE_MIN_PX = 60;

/**
 * -1 for a swipe to the right (back one tab), 1 for a swipe to the left (forward one), 0 for anything else: too short, or
 * more up-and-down than sideways (a scroll, not a swipe).
 */
export function swipeDelta(dx: number, dy: number): -1 | 0 | 1 {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/** The tab `delta` steps from `current`, stopping at the ends; `current` itself if it is not in the list. */
export function moveTab<T extends string>(tabs: readonly T[], current: T, delta: number): T {
  const index = tabs.indexOf(current);
  if (index < 0) return current;
  return tabs[Math.min(tabs.length - 1, Math.max(0, index + delta))];
}
