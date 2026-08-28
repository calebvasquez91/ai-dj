"use client";

import { useEffect, useState } from "react";

/**
 * Current time (ms), refreshed periodically and on tab focus/visibility —
 * for relative-time UI (e.g. "Added 12m ago", a "New" badge that should
 * fade on its own) that only needs to be roughly current, not a live
 * per-second countdown.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);

  return now;
}
