"use client";

import { useDjMoves, type DjMoveKind } from "@/lib/djMovesStore";
import { DJ_EQ_ENABLED, ECHO_OUT_ENABLED, INSTRUMENTAL_BRIDGE_ENABLED, SCRATCH_ENABLED, STUTTER_ENABLED } from "@/lib/featureFlags";
import { useEffect } from "react";

const ROWS: { kind: DjMoveKind; label: string; enabled: boolean; on: (s: ReturnType<typeof useDjMoves.getState>["settings"]) => boolean }[] = [
  { kind: "eq", label: "DJ EQ moves", enabled: DJ_EQ_ENABLED, on: (s) => s.djEq },
  { kind: "stutter", label: "Stutter", enabled: STUTTER_ENABLED, on: (s) => s.stutter },
  { kind: "scratch", label: "Scratch", enabled: SCRATCH_ENABLED, on: (s) => s.scratch },
  { kind: "echoOut", label: "Echo-out", enabled: ECHO_OUT_ENABLED, on: () => true },
  { kind: "bridge", label: "Instrumental bridge", enabled: INSTRUMENTAL_BRIDGE_ENABLED, on: () => true },
];

/**
 * The DJ board's readout of the new DJ moves: for each one whose flag is on, whether it is on, and the move it last planned with the reason
 * ("energy 0.82, 128 BPM, drop in 4 bars"). Renders nothing while every flag is off.
 */
export function DjMovesReadout() {
  const settings = useDjMoves((s) => s.settings);
  const readout = useDjMoves((s) => s.readout);
  const load = useDjMoves((s) => s.load);
  const requestManualStutter = useDjMoves((s) => s.requestManualStutter);
  useEffect(load, [load]);
  const rows = ROWS.filter((r) => r.enabled);
  if (rows.length === 0) return null;
  return (
    <section className="card p-3 flex flex-col gap-2" aria-label="DJ moves">
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">DJ moves</h3>
      <ul className="flex flex-col gap-1 text-xs">
        {rows.map((r) => (
          <li key={r.kind} className="flex flex-wrap items-baseline gap-x-2">
            <span className={`font-semibold ${r.on(settings) ? "text-accent-teal" : "text-muted"}`}>{r.label}: {r.on(settings) ? "on" : "off"}</span>
            {readout[r.kind] && <span className="text-muted break-words">{readout[r.kind]}</span>}
          </li>
        ))}
      </ul>
      {STUTTER_ENABLED && (
        <button type="button" className="btn-outline !text-xs self-start" onClick={requestManualStutter} title="Stutter the playing song on the next beat">
          Stutter now
        </button>
      )}
    </section>
  );
}
