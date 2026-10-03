"use client";

import { useStore } from "@/lib/store";

/**
 * Small "what's layered under the music" status for Spooky Music: three
 * short orange bars with the label "Ambience" while the Halloween loop is
 * playing, replaced by a purple pulse and "FX Playing" while a transition
 * FX is firing. Renders nothing when neither is active (and so, outside
 * Spooky Music, never shows). Driven by the store's ambienceActive /
 * fxPlaying flags, which DualDeckStage writes from the real audio layers.
 */
export function LayerIndicator({ className = "" }: { className?: string }) {
  const ambienceActive = useStore((s) => s.ambienceActive);
  const fxPlaying = useStore((s) => s.fxPlaying);

  if (!fxPlaying && !ambienceActive) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`layer-indicator flex items-center gap-2 text-xs font-semibold ${className}`}
      style={{ color: fxPlaying ? "#c084fc" : "#ff6b00" }}
    >
      {fxPlaying ? (
        <>
          <span className="layer-pulse" aria-hidden="true" />
          FX Playing
        </>
      ) : (
        <>
          <span className="layer-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Ambience
        </>
      )}
    </div>
  );
}
