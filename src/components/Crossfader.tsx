"use client";

import { useStore } from "@/lib/store";

/** A read-only mirror of the crossfade between decks A/B — not user-draggable. It reflects whatever DualDeckStage.tsx's transition/mashup/tempo-ramp automation is actually doing to both decks' real gain nodes; the user's only input into a mix is Mix Now / the Auto-DJ toggle. */
export function Crossfader() {
  const position = useStore((s) => s.crossfaderPosition);

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-1">
      <div className="w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted">
        <span>A</span>
        <span>Crossfader</span>
        <span>B</span>
      </div>
      <div className="mixer-readonly-bar mixer-readonly-bar-horizontal w-full" title="Live crossfader position">
        <div
          className="mixer-readonly-bar-fill mixer-readonly-bar-fill-horizontal"
          style={{ width: `${position * 100}%` }}
        />
        <div className="mixer-readonly-bar-thumb" style={{ left: `${position * 100}%` }} />
      </div>
    </div>
  );
}
