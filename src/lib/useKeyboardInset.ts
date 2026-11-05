"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
}

/**
 * How much of the bottom of the layout viewport the visual viewport has left uncovered. Pinch-zoomed in, the visual
 * viewport is smaller than the layout one too, but nothing covers the page (and the numbers mean something else), so
 * that is no keyboard: 0.
 */
export function keyboardInset(layoutHeight: number, vv: { height: number; offsetTop: number; scale: number }): number {
  if (vv.scale > 1.01) return 0;
  return Math.max(0, Math.round(layoutHeight - vv.height - vv.offsetTop));
}

// One primitive string ("inset|height") so useSyncExternalStore sees a stable snapshot between changes.
function snapshot(): string {
  const vv = window.visualViewport;
  if (!vv) return "0|0";
  return `${keyboardInset(window.innerHeight, vv)}|${Math.round(vv.height)}`;
}

/**
 * How much of the bottom of the page the on-screen keyboard covers (px), and the height still visible. A phone's
 * keyboard shrinks the visual viewport, not the layout one, so a bar pinned to the bottom of the page ends up under
 * it; a bar that uses `inset` as its `bottom` rides just above the keys instead. 0 where there is no keyboard (desktop).
 */
export function useKeyboardInset(): { inset: number; visibleHeight: number } {
  const value = useSyncExternalStore(subscribe, snapshot, () => "0|0");
  const [inset, visibleHeight] = value.split("|").map(Number);
  return { inset, visibleHeight };
}
