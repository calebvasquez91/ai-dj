"use client";

import { useDjMoves } from "@/lib/djMovesStore";
import { STUTTER_NOTE_SETTINGS, type StutterNoteSetting } from "@/lib/djMoveSettings";

const LABELS: Record<StutterNoteSetting, string> = {
  auto: "Auto (follows the song and mood)",
  "1/4": "1/4 note (slowest repeat)",
  "1/8": "1/8 note",
  "1/16": "1/16 note (fastest repeat)",
};

/**
 * Picks which note a stutter repeats: a quarter, eighth or sixteenth of a beat-note, or Auto to let the song's occasion and genre choose. It sets the same
 * Settings value in both places it is shown (Settings and beside the "Stutter now" button), and applies to the automatic stutters and the button alike.
 */
export function StutterNoteSelect({ className = "" }: { className?: string }) {
  const note = useDjMoves((s) => s.settings.stutterNote);
  const update = useDjMoves((s) => s.update);
  return (
    <label className={`flex flex-col gap-1 text-xs text-muted ${className}`}>
      Stutter note
      <select value={note} onChange={(e) => update({ stutterNote: e.target.value as StutterNoteSetting })} aria-label="Stutter note" className="bg-surface shadow-elevate-sm rounded-full text-xs text-muted px-2 py-1.5 outline-none">
        {STUTTER_NOTE_SETTINGS.map((n) => (
          <option key={n} value={n}>
            {LABELS[n]}
          </option>
        ))}
      </select>
    </label>
  );
}
