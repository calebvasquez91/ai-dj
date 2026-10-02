"use client";

import { useStore } from "@/lib/store";

/**
 * Ambient, decorative equalizer-bar wash pinned to the viewport bottom,
 * behind every route's content (mounted once in the (app) layout). Purely
 * atmospheric — the real levels live in Mixer's actual meters — so this
 * never reads track data, just whether *something* is playing.
 *
 * Bar timing is derived from index with small integer modulos rather than
 * Math.random(): this is a client component whose first render still has to
 * match the server-rendered HTML during hydration, and per-bar randomness
 * would produce a different pattern each time, causing a hydration
 * mismatch. The modulo pattern still reads as organic (no two adjacent
 * bars share a phase) without ever being non-deterministic.
 */
const BAR_COUNT = 48;
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => ({
  left: (i / BAR_COUNT) * 100,
  duration: 1.1 + (i % 7) * 0.17,
  delay: -((i % 11) * 0.13),
  peak: 28 + ((i * 37) % 55),
}));

// Built once at module load, not per-render/per-mount: none of these values
// depend on isPlaying (only the wrapper div's className does), so there's
// no reason to re-map BARS into fresh <span>/style objects on every
// play/pause toggle — isPlaying is exactly what this component subscribes
// to, so it re-renders on every one.
const BAR_ELEMENTS = BARS.map((bar, i) => (
  <span
    key={i}
    className="music-wave-bar"
    style={
      {
        left: `${bar.left}%`,
        "--wave-duration": `${bar.duration}s`,
        "--wave-delay": `${bar.delay}s`,
        // Unitless, not a percentage — globals.css's .music-wave-bar
        // divides it in calc() to derive the resting scaleY ratio.
        "--wave-peak": `${bar.peak}`,
      } as React.CSSProperties
    }
  />
));

export function MusicWaveBackground() {
  const isPlaying = useStore((s) => s.isPlaying);
  // Spooky Music tints the bars orange/purple/green/red (see globals.css).
  const spooky = useStore((s) => s.activePlaylistTheme === "spooky");

  return (
    <div
      className={`music-wave-bg${isPlaying ? " is-playing" : ""}${spooky ? " spooky" : ""}`}
      aria-hidden="true"
    >
      {BAR_ELEMENTS}
    </div>
  );
}
