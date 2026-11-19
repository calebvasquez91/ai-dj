// The shared ground of the DJ moves (EQ, stutter, scratch, echo-out, instrumental bridges): where the beat, bar and phrase boundaries of a song
// are, how energetic it is at a moment, how long a gap between two moves has to be, and how strongly a genre or an occasion calls for a move. Every
// move is locked to the beat grid, rate-limited and gated by energy; none is ever random. Pure.
import type { TrackAnalysis } from "@/lib/audio-analysis";
import { energyProfileFromPeaks, zoneOfEnergy, type EnergyZone } from "@/lib/energyProfile";
import { isPhraseGridTrustworthy } from "@/lib/song-map";
import type { DjSetMode } from "@/lib/mix-engine";

export const BEATS_PER_BAR = 4;

export type BoundaryKind = "beat" | "bar" | "phrase";

/** The length of one beat in seconds. */
export function beatLengthSec(bpm: number): number {
  return bpm > 0 ? 60 / bpm : 0.5;
}

/** Seconds in a number of bars at this tempo. */
export function barsToSec(bars: number, bpm: number): number {
  return bars * BEATS_PER_BAR * beatLengthSec(bpm);
}

/**
 * The first beat, bar or 8-bar phrase boundary at or after `fromSec`, from the song's own grid (its tracked beats and bar lines when it has a
 * trustworthy one, else its tempo and grid offset). Null when the analysis has no usable tempo, so a move can wait rather than guess.
 */
export function nextBoundary(analysis: Pick<TrackAnalysis, "bpm" | "beatGridOffsetSec" | "fallback" | "songMap">, fromSec: number, kind: BoundaryKind): number | null {
  if (analysis.fallback || !(analysis.bpm > 0)) return null;
  const epsilon = 1e-6;
  const map = analysis.songMap;
  if (isPhraseGridTrustworthy(map)) {
    const list = kind === "beat" ? map.beats : kind === "bar" ? map.downbeats : map.phrases.bars8;
    const found = list.find((t) => t >= fromSec - epsilon);
    if (found !== undefined) return found;
  }
  const period = beatLengthSec(analysis.bpm) * (kind === "beat" ? 1 : kind === "bar" ? BEATS_PER_BAR : BEATS_PER_BAR * 8);
  const steps = Math.ceil((fromSec - analysis.beatGridOffsetSec - epsilon) / period);
  return analysis.beatGridOffsetSec + Math.max(0, steps) * period;
}

/** Whether a time sits on a beat of the song's grid (within a few milliseconds). */
export function isOnBeat(analysis: Pick<TrackAnalysis, "bpm" | "beatGridOffsetSec" | "fallback" | "songMap">, timeSec: number, toleranceSec = 0.012): boolean {
  const next = nextBoundary(analysis, timeSec - toleranceSec, "beat");
  return next != null && Math.abs(next - timeSec) <= toleranceSec;
}

/** 0-1 energy of the song at a moment (stretched to its own quietest and loudest), or null when its waveform is too short or too even to say. */
export function energyAt(analysis: Pick<TrackAnalysis, "waveformPeaks">, timeSec: number, durationSec: number): number | null {
  if (!(durationSec > 0)) return null;
  const profile = energyProfileFromPeaks(analysis.waveformPeaks);
  if (profile.length === 0) return null;
  const index = Math.min(profile.length - 1, Math.max(0, Math.floor((timeSec / durationSec) * profile.length)));
  return profile[index];
}

export function energyZoneOf(value: number | null): EnergyZone | null {
  return value == null ? null : zoneOfEnergy(value);
}

/** Whether a gap since the last move is long enough: no move can fire before `minGapSec` has passed. A move that has never fired may. */
export function gapElapsed(lastAtSec: number | null, nowSec: number, minGapSec: number): boolean {
  return lastAtSec == null || nowSec - lastAtSec >= minGapSec;
}

/** How strongly a genre calls for a move such as a stutter or a scratch: full for hip-hop, rap and electronic, a lower rate for the rest. */
export function genreMoveWeight(genre: string | null | undefined): number {
  const g = (genre ?? "").toLowerCase();
  if (/hip.?hop|rap|trap|drill|r&b.*hip/.test(g)) return 1;
  if (/electronic|house|techno|edm|dance|dubstep|drum.?(and|&).?bass|trance|club/.test(g)) return 1;
  return 0.4;
}

/** How hard an occasion leans into big moves (from its DJ set mode): party, club and open-format high, wedding and chill low. */
export function modeIntensity(mode: DjSetMode | null | undefined): number {
  switch (mode) {
    case "club":
    case "party":
      return 1;
    case "open-format":
      return 0.7;
    case "auto":
    case undefined:
    case null:
      return 0.6;
    case "wedding":
      return 0.3;
    case "chill":
      return 0.2;
  }
}

/** Seconds from now to a moment, as a count of whole bars (rounded), for a reason line such as "drop in 4 bars". */
export function barsUntil(targetSec: number, nowSec: number, bpm: number): number {
  return Math.max(0, Math.round((targetSec - nowSec) / barsToSec(1, bpm)));
}
