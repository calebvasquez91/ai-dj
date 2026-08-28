export function formatTime(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const m = Math.floor(safeSeconds / 60);
  const s = Math.floor(safeSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** A track counts as newly added for this long after its addedAt timestamp. */
export const NEW_TRACK_WINDOW_MS = 2 * 60 * 60 * 1000;

export function isRecentlyAdded(addedAt: number, nowMs: number = Date.now()): boolean {
  return nowMs - addedAt < NEW_TRACK_WINDOW_MS;
}

/** Coarse "Added Xm ago" label — deliberately not second-precision since it's re-rendered on a periodic tick, not a live countdown. */
export function formatRelativeTime(fromMs: number, nowMs: number = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (diffSec < 60) return "Added just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Added ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Added ${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `Added ${diffDay}d ago`;
}
