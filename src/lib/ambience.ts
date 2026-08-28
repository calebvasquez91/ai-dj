/**
 * Mid-track ambience: occasional, context-aware FX fired *during* normal
 * playback (never during a transition) — a filter-sweep/riser going into a
 * detected build, a short echo throw arriving at a detected breakdown.
 * Reuses the waveform-peak envelope already computed and cached per track
 * by audio-analysis.ts, so no new signal processing is needed here — this
 * module is pure decision logic (given the analysis + where we are in the
 * track, should something fire right now?), separate from the actual audio
 * execution in DualDeckStage.tsx, mirroring how mix-engine.ts's decision
 * logic is separate from its execution there too.
 */

import type { TrackAnalysis } from "@/lib/audio-analysis";

export type AmbienceFrequency = "off" | "occasional" | "frequent";

export type AmbienceEffect = "riser" | "echo-tail" | "vocal-echo" | "backspin" | "drum-break" | "acapella-drop";

export type AmbienceCue =
  | { effect: "riser"; windowSec: number }
  | { effect: "echo-tail"; windowSec: number }
  | { effect: "vocal-echo"; windowSec: number }
  | { effect: "backspin"; windowSec: number }
  /** A short, beat-aligned loop of the track's current (breakdown-adjacent) moment — repeated `repeatCount` times before releasing back into normal playback. */
  | { effect: "drum-break"; windowSec: number; barsCount: number; repeatCount: number }
  | { effect: "acapella-drop"; windowSec: number };

export interface AmbienceInput {
  analysis: TrackAnalysis;
  durationSec: number;
  currentTimeSec: number;
  /** Track-relative playback position (seconds) of the last ambience trigger for this track, or null if none yet. */
  lastTriggeredSec: number | null;
  frequency: AmbienceFrequency;
}

/** How far apart two ambience triggers must be, in seconds of playback, by frequency setting. */
const COOLDOWN_SEC_BY_FREQUENCY: Record<AmbienceFrequency, number> = {
  off: Infinity,
  occasional: 45,
  frequent: 18,
};

/** Short recent window (seconds) used to sample "the energy right now" from the peak envelope. */
const RECENT_WINDOW_SEC = 4;
/** A detected drop must be at most this many seconds ahead to count as "building toward" — otherwise a build cue would fire far too early. */
const BUILD_LOOKAHEAD_SEC = 20;
/** Recent energy must be at least this many times louder than the window just before it to read as a genuine rise, not noise. */
const BUILD_RISE_RATIO = 1.35;
/** How long after a detected breakdownAtSec still counts as "in" the breakdown. */
const BREAKDOWN_WINDOW_SEC = 6;
/** Recent energy at or below this fraction of the track's own average counts as a lull, when no breakdownAtSec was detected. */
const LOW_ENERGY_RATIO = 0.45;
/**
 * Weighted split of which effect a build/breakdown moment reaches for —
 * kept as explicit weights (not a flat random pick) so echo-tail stays the
 * common, low-key default and the bigger moments (vocal-echo, drum-break,
 * acapella-drop, backspin) read as rarer highlights, matching how a real
 * DJ would use a dramatic effect occasionally, not on every single cue.
 */
// TEMP: biased toward backspin for live listening verification — revert to
// riser 0.7 / backspin 0.3 once confirmed.
const BUILD_EFFECT_WEIGHTS: { effect: "riser" | "backspin"; weight: number }[] = [
  { effect: "riser", weight: 0.1 },
  { effect: "backspin", weight: 0.9 },
];
const BREAKDOWN_EFFECT_WEIGHTS: { effect: "echo-tail" | "vocal-echo" | "drum-break" | "acapella-drop"; weight: number }[] = [
  { effect: "echo-tail", weight: 0.4 },
  { effect: "vocal-echo", weight: 0.2 },
  { effect: "drum-break", weight: 0.2 },
  { effect: "acapella-drop", weight: 0.2 },
];
/** 2-4 bar loop, repeated 3-5 times — long enough to read as a deliberate "ride the break," short enough to release before it overstays. */
const DRUM_BREAK_MIN_BARS = 2;
const DRUM_BREAK_MAX_BARS = 4;
const DRUM_BREAK_MIN_REPEATS = 3;
const DRUM_BREAK_MAX_REPEATS = 5;

function weightedPick<T>(options: { effect: T; weight: number }[]): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * total;
  for (const option of options) {
    if (roll < option.weight) return option.effect;
    roll -= option.weight;
  }
  return options[options.length - 1].effect;
}

function averagePeaks(peaks: number[]): number {
  if (peaks.length === 0) return 0;
  return peaks.reduce((sum, v) => sum + v, 0) / peaks.length;
}

/** Average peak value across a [fromSec, toSec) window, mapping seconds onto the fixed-length peak array via the track's total duration. */
function peakWindowAverage(peaks: number[], durationSec: number, fromSec: number, toSec: number): number {
  if (peaks.length === 0 || durationSec <= 0) return 0;
  const clampedFrom = Math.max(0, fromSec);
  const clampedTo = Math.max(clampedFrom, toSec);
  const startIdx = Math.min(peaks.length - 1, Math.floor((clampedFrom / durationSec) * peaks.length));
  const endIdx = Math.min(peaks.length, Math.max(startIdx + 1, Math.ceil((clampedTo / durationSec) * peaks.length)));
  let sum = 0;
  for (let i = startIdx; i < endIdx; i++) sum += peaks[i];
  return sum / (endIdx - startIdx);
}

function detectBuild(analysis: TrackAnalysis, durationSec: number, currentTimeSec: number): boolean {
  const { waveformPeaks, dropAtSec } = analysis;
  if (waveformPeaks.length === 0) return false;
  // A detected drop at or before t=0 (the loudest moment in the track being
  // its very intro, e.g. a cold-open hit) isn't a meaningful lookahead
  // target — treat it the same as "no drop known" rather than letting it
  // permanently disqualify every later timestamp in the track.
  if (dropAtSec != null && dropAtSec > 0) {
    const timeToDrop = dropAtSec - currentTimeSec;
    if (timeToDrop <= 0 || timeToDrop > BUILD_LOOKAHEAD_SEC) return false;
  }
  const recent = peakWindowAverage(waveformPeaks, durationSec, currentTimeSec - RECENT_WINDOW_SEC, currentTimeSec);
  const earlier = peakWindowAverage(
    waveformPeaks,
    durationSec,
    currentTimeSec - RECENT_WINDOW_SEC * 2,
    currentTimeSec - RECENT_WINDOW_SEC
  );
  if (earlier <= 0) return false;
  return recent / earlier >= BUILD_RISE_RATIO;
}

function detectBreakdown(analysis: TrackAnalysis, durationSec: number, currentTimeSec: number): boolean {
  const { waveformPeaks, breakdownAtSec } = analysis;
  if (waveformPeaks.length === 0) return false;
  if (breakdownAtSec != null) {
    return currentTimeSec >= breakdownAtSec && currentTimeSec < breakdownAtSec + BREAKDOWN_WINDOW_SEC;
  }
  const overall = averagePeaks(waveformPeaks);
  if (overall <= 0) return false;
  const recent = peakWindowAverage(waveformPeaks, durationSec, currentTimeSec - RECENT_WINDOW_SEC, currentTimeSec);
  return recent / overall <= LOW_ENERGY_RATIO;
}

/**
 * Decides whether an ambience FX should fire right now. Checks a build cue
 * before a breakdown cue since a build is the more specific/rarer signal
 * (tied to a detected drop when one exists); returns null when nothing
 * should fire, including whenever the cooldown for `frequency` hasn't
 * elapsed since `lastTriggeredSec`.
 */
export function shouldTriggerAmbience({
  analysis,
  durationSec,
  currentTimeSec,
  lastTriggeredSec,
  frequency,
}: AmbienceInput): AmbienceCue | null {
  if (frequency === "off") return null;
  const cooldownSec = COOLDOWN_SEC_BY_FREQUENCY[frequency];
  if (lastTriggeredSec != null && currentTimeSec - lastTriggeredSec < cooldownSec) return null;

  if (detectBuild(analysis, durationSec, currentTimeSec)) {
    const effect = weightedPick(BUILD_EFFECT_WEIGHTS);
    if (effect === "backspin") return { effect: "backspin", windowSec: 2 };
    return { effect: "riser", windowSec: 6 };
  }
  if (detectBreakdown(analysis, durationSec, currentTimeSec)) {
    const effect = weightedPick(BREAKDOWN_EFFECT_WEIGHTS);
    if (effect === "vocal-echo") return { effect: "vocal-echo", windowSec: 9 };
    if (effect === "acapella-drop") return { effect: "acapella-drop", windowSec: 8 };
    if (effect === "drum-break") {
      const barsCount = DRUM_BREAK_MIN_BARS + Math.round(Math.random() * (DRUM_BREAK_MAX_BARS - DRUM_BREAK_MIN_BARS));
      const repeatCount =
        DRUM_BREAK_MIN_REPEATS + Math.round(Math.random() * (DRUM_BREAK_MAX_REPEATS - DRUM_BREAK_MIN_REPEATS));
      const effectiveBpm = analysis.bpm > 0 ? analysis.bpm : 120;
      const windowSec = (barsCount * repeatCount * 4 * 60) / effectiveBpm;
      return { effect: "drum-break", windowSec, barsCount, repeatCount };
    }
    return { effect: "echo-tail", windowSec: 3 };
  }
  return null;
}
