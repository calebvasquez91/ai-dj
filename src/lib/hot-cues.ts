/**
 * Turns a track's analysis into the 8 standard "Hot Cue" positions pro DJs
 * expect at consistent structural spots — same shape on every track, so
 * (say) Cue 4 always means "first drop" whether you're looking at deck A
 * or deck B. Cues 1/2/7/8 are pure beat-grid math (placeable once there's
 * a usable BPM, regardless of track structure); cues 3-6 come from the
 * best-effort build/drop-pair detection in audio-analysis-core.ts and are
 * left unset — never guessed — when that detector can't find a confident
 * pair, which is expected for tracks that don't have a clean house/EDM
 * build→drop→build→drop shape.
 *
 * A YouTube track has no analysis at all (no fetchable audio buffer to run
 * this on — see YouTubeDeckStage.tsx), so every cue for one is manual-only:
 * computeAutoHotCues() naturally returns all-null whenever bpm isn't
 * usable, and the caller shouldn't invoke it for a YouTube track anyway.
 */
import { snapToBeatGrid } from "@/lib/beat-grid";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { Track } from "@/types/music";

export const HOT_CUE_LABELS = [
  "Intro",
  "Intro +8",
  "Build 1",
  "Drop 1",
  "Build 2",
  "Drop 2",
  "Outro",
  "Outro +8",
] as const;

export interface HotCueSlot {
  atSec: number | null;
  source: "auto" | "manual" | null;
}

const BARS_INTRO_OFFSET = 8;
const BARS_OUTRO_LOOKBACK = 16;
const BARS_OUTRO_OFFSET = 8;
/** Guards Cues 7/8 against a track too short for a 16-bar outro lookback to mean anything (they'd otherwise land before or right on top of the intro cues). */
const MIN_BARS_FOR_OUTRO_CUES = 32;

/**
 * The 8 auto-placed positions in seconds, or null at any index the
 * detector can't confidently place — before any manual overrides are
 * applied (see mergeHotCues). Returns all-null for a track with no usable
 * BPM at all (bpm <= 0 never legitimately occurs from real analysis, but
 * guards against a hand-built/fallback TrackAnalysis passed in by mistake).
 */
export function computeAutoHotCues(analysis: TrackAnalysis, durationSec: number): (number | null)[] {
  if (!(analysis.bpm > 0)) return new Array(8).fill(null);
  const barLen = (60 / analysis.bpm) * 4;
  const snap = (t: number) => snapToBeatGrid(t, analysis.beatGridOffsetSec, analysis.bpm);

  const cue1 = Math.max(0, analysis.beatGridOffsetSec);
  const cue2 = snap(cue1 + BARS_INTRO_OFFSET * barLen);

  const [pair1, pair2] = analysis.buildDropPairs;
  const cue3 = pair1 ? snap(pair1.buildAtSec) : null;
  const cue4 = pair1 ? snap(pair1.dropAtSec) : null;
  const cue5 = pair2 ? snap(pair2.buildAtSec) : null;
  const cue6 = pair2 ? snap(pair2.dropAtSec) : null;

  const hasRoomForOutro = durationSec > MIN_BARS_FOR_OUTRO_CUES * barLen;
  const cue7 = hasRoomForOutro ? snap(durationSec - BARS_OUTRO_LOOKBACK * barLen) : null;
  const cue8 = hasRoomForOutro ? snap(durationSec - BARS_OUTRO_OFFSET * barLen) : null;

  return [cue1, cue2, cue3, cue4, cue5, cue6, cue7, cue8];
}

/**
 * Merges auto placement with a track's manual overrides (1-indexed cue
 * numbers, matching how they're persisted) — a manual tap always wins,
 * whether it filled a gap the detector left empty or moved a cue it did
 * place.
 */
export function mergeHotCues(
  autoCues: (number | null)[],
  overrides: Record<number, number> | undefined
): HotCueSlot[] {
  return autoCues.map((auto, i) => {
    const manual = overrides?.[i + 1];
    if (typeof manual === "number") return { atSec: manual, source: "manual" };
    if (auto != null) return { atSec: auto, source: "auto" };
    return { atSec: null, source: null };
  });
}

/**
 * One-call version of computeAutoHotCues + mergeHotCues for a real Track —
 * the thing every caller actually wants (DeckView.tsx, mix-engine.ts). Never
 * attempts auto-placement for a YouTube track (no waveform to run the
 * detector on), matching the rule everywhere else in this app.
 */
export function resolveHotCues(track: Track, analysis: TrackAnalysis | undefined): HotCueSlot[] {
  const auto =
    track.source === "local" && analysis ? computeAutoHotCues(analysis, track.durationSec) : new Array(8).fill(null);
  return mergeHotCues(auto, track.hotCueOverrides);
}

/** Cue 4 (Drop 1) and Cue 6 (Drop 2) — the two drop-family cues, 0-indexed. */
const DROP_CUE_INDICES = [3, 5];

/**
 * The earliest placed drop-family cue (Cue 4 or Cue 6) at or after
 * `afterSec`, or null if neither is placed or both have already passed.
 * Two different uses read this the same way: `afterSec = 0` finds a fresh
 * (not-yet-playing) track's own first available drop — always Cue 4 if
 * it's set, since starting a new track by jumping straight to its *second*
 * drop would skip its intro/first build entirely; `afterSec = <current
 * playback position>` finds the *next* upcoming drop on a track that's
 * already playing, which is Cue 6 once Cue 4 has already gone by.
 */
export function upcomingDropCueAtSec(slots: HotCueSlot[], afterSec = 0): number | null {
  let best: number | null = null;
  for (const i of DROP_CUE_INDICES) {
    const atSec = slots[i]?.atSec;
    if (atSec == null || atSec < afterSec) continue;
    if (best == null || atSec < best) best = atSec;
  }
  return best;
}
