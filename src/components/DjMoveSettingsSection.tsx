"use client";

import { useEffect } from "react";
import { useDjMoves } from "@/lib/djMovesStore";
import { DJ_EQ_ENABLED, SCRATCH_ENABLED, STUTTER_ENABLED } from "@/lib/featureFlags";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
    </label>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  );
}

/**
 * Settings for the DJ moves: a switch for each that is available (its feature flag is on), a frequency slider for stutter and scratch, and the
 * scratch volume. Renders nothing while all three flags are off. Manual EQ on the DJ board is unaffected by any of this.
 */
export function DjMoveSettingsSection() {
  const settings = useDjMoves((s) => s.settings);
  const update = useDjMoves((s) => s.update);
  const load = useDjMoves((s) => s.load);
  useEffect(load, [load]);
  if (!DJ_EQ_ENABLED && !STUTTER_ENABLED && !SCRATCH_ENABLED) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="dj-moves-heading">
      <h2 id="dj-moves-heading" className="text-sm font-semibold text-muted">
        DJ moves
      </h2>
      {DJ_EQ_ENABLED && <Toggle label="DJ EQ moves (you can still use manual EQ)" checked={settings.djEq} onChange={(djEq) => update({ djEq })} />}
      {STUTTER_ENABLED && (
        <>
          <Toggle label="Stutter" checked={settings.stutter} onChange={(stutter) => update({ stutter })} />
          <Slider label="Stutter frequency" value={settings.stutterFrequency} onChange={(stutterFrequency) => update({ stutterFrequency })} />
        </>
      )}
      {SCRATCH_ENABLED && (
        <>
          <Toggle label="Scratching" checked={settings.scratch} onChange={(scratch) => update({ scratch })} />
          <Slider label="Scratch frequency" value={settings.scratchFrequency} onChange={(scratchFrequency) => update({ scratchFrequency })} />
          <Slider label="Scratch volume" value={settings.scratchVolume} onChange={(scratchVolume) => update({ scratchVolume })} />
        </>
      )}
    </section>
  );
}
