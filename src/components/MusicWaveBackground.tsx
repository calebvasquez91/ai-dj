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

export function MusicWaveBackground() {
  const isPlaying = useStore((s) => s.isPlaying);

  return (
    <div
      className={`music-wave-bg${isPlaying ? " is-playing" : ""}`}
      aria-hidden="true"
    >
      {BARS.map((bar, i) => (
        <span
          key={i}
          className="music-wave-bar"
          style={
            {
              left: `${bar.left}%`,
              "--wave-duration": `${bar.duration}s`,
              "--wave-delay": `${bar.delay}s`,
              "--wave-peak": `${bar.peak}%`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
