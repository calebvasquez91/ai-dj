/**
 * Best-effort structural guess for tracks with no real per-sample analysis
 * — chiefly YouTube imports, which never get one (no raw audio buffer
 * access via the IFrame Player API, see types/music.ts's YouTubeTrack), but
 * also any track analysis simply hasn't finished for yet. Based on common
 * pop/EDM song-structure timing (a first drop/chorus a bit under a third of
 * the way in, a bridge/breakdown around two-thirds), not any actual signal
 * in the track — deliberately a lower-confidence fallback, used only when
 * there's no real detected dropAtSec/breakdownAtSec/waveformPeaks to work
 * with. Gives the mid-track ambience FX (lib/ambience.ts) and drop-targeted
 * transitions (lib/mix-engine.ts) something to react to instead of nothing,
 * on the large fraction of a typical library that can never be really
 * analyzed.
 */

export interface StructuralEstimate {
  estimatedDropAtSec: number;
  estimatedBreakdownAtSec: number;
}

const ESTIMATED_DROP_FRACTION = 0.3;
const ESTIMATED_BREAKDOWN_FRACTION = 0.65;

export function estimateStructuralCues(durationSec: number): StructuralEstimate {
  return {
    estimatedDropAtSec: durationSec * ESTIMATED_DROP_FRACTION,
    estimatedBreakdownAtSec: durationSec * ESTIMATED_BREAKDOWN_FRACTION,
  };
}
