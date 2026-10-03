"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";

/**
 * Spooky Music's background: pure black with small twinkling glimmers.
 *
 * Two pieces, both keyed on `activePlaylistTheme === "spooky"`:
 *  - <SpookyBackdrop /> (mounted once in the (app) layout) flips a
 *    `data-spooky` attribute on <html>, which globals.css uses to re-point
 *    the color tokens at a black palette — so the page, cards and chrome all
 *    go black in light *and* dark mode — and renders the page-wide sparkle
 *    layer behind the app shell.
 *  - <SpookySparkles /> is the sparkle layer itself, reused inside the
 *    full-screen Now Playing panel (which paints its own opaque backdrop
 *    over the page-wide one).
 *
 * Sparkle placement/timing is derived from the index with small integer
 * arithmetic rather than Math.random(), same reasoning as
 * MusicWaveBackground: no hydration mismatch, and the pattern still reads as
 * scattered because no two neighbours share a position, size, or phase.
 * Everything animates only opacity/transform (compositor-only).
 */
const SPARKLE_COUNT = 56;
const TINTS = ["#ffffff", "#ffe9a8", "#d9b8ff", "#bfe9ff", "#fff3d6"];

const SPARKLES = Array.from({ length: SPARKLE_COUNT }, (_, i) => {
  // Every 7th is a larger four-point glint; the rest are small round dots.
  const glint = i % 7 === 3;
  return {
    glint,
    x: ((i * 618) % 1000) / 10,
    y: ((i * i * 37 + i * 113) % 1000) / 10,
    size: glint ? 11 + (i % 3) * 2 : 2 + (i % 3),
    duration: 2.6 + (i % 5) * 0.9,
    delay: -((i % 9) * 0.7),
    tint: TINTS[i % TINTS.length],
  };
});

// Built once at module load, not per render — nothing here changes.
const SPARKLE_ELEMENTS = SPARKLES.map((s, i) => (
  <span
    key={i}
    className={`spooky-sparkle${s.glint ? " glint" : ""}`}
    style={
      {
        "--x": `${s.x}%`,
        "--y": `${s.y}%`,
        "--size": `${s.size}px`,
        "--dur": `${s.duration}s`,
        "--delay": `${s.delay}s`,
        "--tint": s.tint,
      } as React.CSSProperties
    }
  />
));

/** The sparkle layer — fills its (positioned) parent; pass `className` to place it. */
export function SpookySparkles({ className = "" }: { className?: string }) {
  return (
    <div className={`spooky-sparkles ${className}`} aria-hidden="true">
      {SPARKLE_ELEMENTS}
    </div>
  );
}

export function SpookyBackdrop() {
  const spooky = useStore((s) => s.activePlaylistTheme === "spooky");

  useEffect(() => {
    const root = document.documentElement;
    if (spooky) root.setAttribute("data-spooky", "true");
    else root.removeAttribute("data-spooky");
    return () => root.removeAttribute("data-spooky");
  }, [spooky]);

  return <SpookySparkles className={`spooky-sparkles-page${spooky ? " is-on" : ""}`} />;
}
