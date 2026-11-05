/**
 * A short tap of vibration on the key controls (play, the tabs): the web's version of a haptic. Browsers without the
 * Vibration API (iOS Safari, desktop) simply do nothing, and it stays silent for anyone who asked for reduced motion.
 */
export type HapticKind = "light" | "medium";

const DURATION_MS: Record<HapticKind, number> = { light: 8, medium: 16 };

/** Whether this browser can vibrate and the user has not asked for reduced motion. */
export function hapticsAvailable(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  }
  return true;
}

export function haptic(kind: HapticKind = "light"): void {
  if (!hapticsAvailable()) return;
  try {
    navigator.vibrate(DURATION_MS[kind]);
  } catch {
    // a browser that refuses (no user activation yet) — a missing buzz is harmless
  }
}
