"use client";

import { useStore } from "@/lib/store";
import { EQ_DB_MIN, EQ_DB_MAX } from "@/lib/mixer-controls";
import type { DeckId } from "@/types/music";

function VerticalBar({ label, value, min, max, title }: { label: string; value: number; min: number; max: number; title: string }) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="mixer-vertical-slider mixer-readonly-bar" title={title}>
        <div className="mixer-readonly-bar-fill" style={{ height: `${percent}%` }} />
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

function Meter({ level }: { level: number }) {
  return (
    <div className="mixer-meter" title="Channel level">
      <div className="mixer-meter-fill" style={{ height: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

/**
 * One deck's read-only channel strip — a live mirror of the low-EQ cut,
 * one-knob filter sweep, and output level the AI's own transition
 * automation is actually driving in DualDeckStage.tsx (see store.ts's
 * mixer slice). Nothing here is user-adjustable; the user's only input
 * stays Mix Now / the Auto-DJ toggle.
 */
export function ChannelStrip({ deckId }: { deckId: DeckId }) {
  const eqLowDb = useStore((s) => s.deckEqLowDb[deckId]);
  const filterPos = useStore((s) => s.deckFilterPos[deckId]);
  const meterLevel = useStore((s) => s.deckMeterLevel[deckId]);
  const activeDeckId = useStore((s) => s.activeDeckId);

  const filterLabel = filterPos > 0.02 ? "highpass" : filterPos < -0.02 ? "lowpass" : "off";

  return (
    <div className="card p-4 flex flex-col items-center gap-4 w-full max-w-[220px]">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent-purple flex items-center gap-1.5">
        Deck {deckId}
        {activeDeckId === deckId && <span className="text-accent-teal" title="Currently audible">● Live</span>}
      </p>
      <div className="flex items-end gap-3">
        <VerticalBar
          label="Low"
          value={eqLowDb}
          min={EQ_DB_MIN}
          max={EQ_DB_MAX}
          title={`Low: ${eqLowDb > 0 ? "+" : ""}${eqLowDb.toFixed(1)} dB`}
        />
        <div className="flex flex-col items-center gap-1.5">
          <Meter level={meterLevel ?? 0} />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Level</span>
        </div>
      </div>
      <div className="w-full flex flex-col items-center gap-1">
        <div className="mixer-readonly-bar mixer-readonly-bar-horizontal w-full" title={`Filter (${filterLabel})`}>
          <div
            className="mixer-readonly-bar-fill mixer-readonly-bar-fill-horizontal"
            style={{ width: `${((filterPos + 1) / 2) * 100}%` }}
          />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Filter {filterLabel !== "off" && `— ${filterLabel}`}
        </span>
      </div>
    </div>
  );
}
