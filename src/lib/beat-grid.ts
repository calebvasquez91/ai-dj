/**
 * Beat-grid snapping, split out of mix-engine.ts into its own leaf module so
 * hot-cues.ts can depend on it without creating a cycle: mix-engine.ts needs
 * hot-cues.ts's resolveHotCues/upcomingDropCueAtSec for Hot-Cue-aware
 * transitions, and hot-cues.ts needs this snapping math — both can't import
 * directly from each other. mix-engine.ts re-exports this for every
 * existing call site that imports snapToBeatGrid from there.
 */
export function snapToBeatGrid(timeSec: number, beatGridOffsetSec: number, bpm: number): number {
  if (bpm <= 0) return Math.max(0, timeSec);
  const beatLenSec = 60 / bpm;
  const beatsSinceOffset = (timeSec - beatGridOffsetSec) / beatLenSec;
  const snappedBeats = Math.round(beatsSinceOffset);
  return Math.max(0, beatGridOffsetSec + snappedBeats * beatLenSec);
}

/** Beat Jump's fixed nudge size — a real CDJ lets you choose 1/2/4/8/16/32; this ships one sensible default rather than a picker. Shared between DualDeckStage.tsx (the actual seek) and DeckView.tsx (the button labels) so they can never drift apart. */
export const BEAT_JUMP_COUNT = 4;

/**
 * Beat Jump: moves a playhead forward/back by a fixed number of beats,
 * instantly (no restart) — the CDJ control of the same name. A beat's
 * length doesn't depend on the grid's phase offset (only its tempo), so
 * this doesn't need beatGridOffsetSec the way snapToBeatGrid does — a
 * caller wanting the result quantized can pass it through snapToBeatGrid
 * afterward. `beatCount` may be negative (jump back). Clamped to the
 * track's actual bounds — a jump never runs off either end.
 */
export function jumpBeats(currentSec: number, bpm: number, beatCount: number, durationSec: number): number {
  if (bpm <= 0) return Math.max(0, Math.min(durationSec, currentSec));
  const beatLenSec = 60 / bpm;
  const target = currentSec + beatCount * beatLenSec;
  return Math.max(0, Math.min(durationSec, target));
}
