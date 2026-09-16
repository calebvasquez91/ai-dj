"use client";

import { useStore } from "@/lib/store";
import type { DeckId } from "@/types/music";

/**
 * A read-only spinning platter for one deck — rotation angle mirrors that
 * deck's real <audio> element (see DualDeckStage.tsx's read-back poll), so
 * it genuinely slows/speeds up during brake and spin-up transitions instead
 * of just running a fixed CSS animation. Not draggable — the AI drives
 * playback, same as every other control in this panel.
 */
export function JogWheel({ deckId }: { deckId: DeckId }) {
  const angle = useStore((s) => s.deckJogAngle[deckId]);
  const activeDeckId = useStore((s) => s.activeDeckId);

  return (
    <div
      className="jog-wheel"
      data-live={activeDeckId === deckId}
      title={`Deck ${deckId} platter — spins with real playback`}
    >
      <div className="jog-wheel-disc" style={{ transform: `rotate(${angle}deg)` }}>
        <span className="jog-wheel-marker" />
        <span className="jog-wheel-label">{deckId}</span>
      </div>
    </div>
  );
}
