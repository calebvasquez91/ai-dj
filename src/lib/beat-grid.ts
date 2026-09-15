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
