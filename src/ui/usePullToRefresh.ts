"use client";

import { useEffect, useRef, useState } from "react";
import { pullOffset, shouldRefresh } from "@/lib/pullToRefresh";

/**
 * Pull-to-refresh for a screen inside the app's scrolling <main>: a downward drag that starts with the page scrolled to
 * the top moves `offset` (for an indicator) and, let go far enough, calls `onRefresh`. Touch only; a mouse and the
 * keyboard have their own ways to reload. Put `rootRef` on the screen's outermost element.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef(onRefresh);
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    latest.current = onRefresh;
  });

  useEffect(() => {
    const scroller = rootRef.current?.closest("main");
    if (!scroller) return;
    let startY: number | null = null;
    let current = 0;

    const onStart = (e: TouchEvent) => {
      startY = scroller.scrollTop <= 0 ? e.touches[0].clientY : null;
      current = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null) return;
      current = pullOffset(e.touches[0].clientY - startY);
      setOffset(current);
    };
    const onEnd = async () => {
      if (startY == null) return;
      startY = null;
      const refresh = shouldRefresh(current);
      current = 0;
      setOffset(0);
      if (!refresh) return;
      setRefreshing(true);
      try {
        await latest.current();
      } finally {
        setRefreshing(false);
      }
    };
    const onCancel = () => {
      startY = null;
      current = 0;
      setOffset(0);
    };

    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: true });
    scroller.addEventListener("touchend", onEnd);
    scroller.addEventListener("touchcancel", onCancel);
    return () => {
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
      scroller.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  return { rootRef, offset, refreshing };
}
