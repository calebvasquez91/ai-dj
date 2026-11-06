/**
 * Moods for the Home screen's mixes and filter chips (Energize, Chill, Workout, Party), worked out on the device from what
 * the app already knows about a track: its analysed tempo and loudness, or the tags the user gave it. No AI call and no
 * stored mood: the same library always gives the same mixes. The thresholds are a plain heuristic, tuned to feel right
 * (slow and quiet is Chill, fast is Workout), not a measurement of anything.
 */
import type { TrackAnalysis } from "@/lib/audio-analysis-core";
import type { Track } from "@/types/music";

export type Mood = "energize" | "chill" | "workout" | "party";

export const MOODS: readonly { id: Mood; label: string }[] = [
  { id: "energize", label: "Energize" },
  { id: "chill", label: "Chill" },
  { id: "workout", label: "Workout" },
  { id: "party", label: "Party" },
];

/** What the mood rules look at: tempo in BPM and loudness 0-1, each null when unknown. */
export interface TrackFeel {
  bpm: number | null;
  energy: number | null;
}

/** The mean of a 0-1 peak array (the waveform), or null when there is none. */
export function meanPeak(peaks: readonly number[] | undefined): number | null {
  if (!peaks || peaks.length === 0) return null;
  let sum = 0;
  for (const p of peaks) sum += p;
  return sum / peaks.length;
}

/**
 * A track's tempo and loudness: from its real analysis when it has one, else the BPM stored on a local track; loudness is
 * only known from an analysis. An analysis that fell back to the neutral default (fallback) is not trusted.
 */
export function trackFeel(track: Track, analysis: TrackAnalysis | undefined): TrackFeel {
  const analysed = analysis != null && !analysis.fallback;
  const bpm = analysed ? analysis.bpm : track.source === "local" ? (track.bpm ?? null) : null;
  return { bpm: bpm != null && bpm > 0 ? bpm : null, energy: analysed ? meanPeak(analysis.waveformPeaks) : null };
}

const TAG_MOODS: Record<string, Mood> = {
  chill: "chill",
  relax: "chill",
  relaxing: "chill",
  calm: "chill",
  mellow: "chill",
  workout: "workout",
  gym: "workout",
  run: "workout",
  running: "workout",
  party: "party",
  dance: "party",
  club: "party",
  energy: "energize",
  energize: "energize",
  hype: "energize",
};

/** Which moods a track belongs to (it can be in several, or none): its tags first, then its tempo and loudness. */
export function moodsFor(track: Track, feel: TrackFeel): Mood[] {
  const found = new Set<Mood>();
  for (const tag of track.tags ?? []) {
    const mood = TAG_MOODS[tag.trim().toLowerCase()];
    if (mood) found.add(mood);
  }
  const { bpm, energy } = feel;
  if (bpm != null) {
    if (bpm < 105 && (energy == null || energy < 0.5)) found.add("chill");
    if (bpm >= 120 && bpm <= 170) found.add("workout");
    if (bpm >= 118 && (energy == null || energy >= 0.4)) found.add("energize");
    if (bpm >= 108 && bpm <= 135 && (energy == null || energy >= 0.3)) found.add("party");
  }
  return MOODS.map((m) => m.id).filter((id) => found.has(id));
}

export interface MoodMix {
  mood: Mood;
  label: string;
  tracks: Track[];
}

/** Slowest to fastest, so a mix builds; tracks with no known tempo go last, in their library order. */
function byTempo(a: { feel: TrackFeel }, b: { feel: TrackFeel }): number {
  const x = a.feel.bpm ?? Number.POSITIVE_INFINITY;
  const y = b.feel.bpm ?? Number.POSITIVE_INFINITY;
  return x === y ? 0 : x - y;
}

/**
 * The mixes the library can make: one per mood that has at least `minTracks` songs (a "mix" of one or two is not a mix),
 * each ordered slow to fast. Songs marked Do-Not-Play are left out.
 */
export function buildMixes(tracks: readonly Track[], analysis: Record<string, TrackAnalysis>, minTracks = 3): MoodMix[] {
  const rows = tracks
    .filter((t) => t.playPreference !== "do-not")
    .map((track) => {
      const feel = trackFeel(track, analysis[track.id]);
      return { track, feel, moods: moodsFor(track, feel) };
    });
  return MOODS.map(({ id, label }) => ({
    mood: id,
    label,
    tracks: rows
      .filter((r) => r.moods.includes(id))
      .sort(byTempo)
      .map((r) => r.track),
  })).filter((mix) => mix.tracks.length >= minTracks);
}

/** The tracks that belong to one mood, in library order. */
export function tracksForMood(tracks: readonly Track[], analysis: Record<string, TrackAnalysis>, mood: Mood): Track[] {
  return tracks.filter((t) => moodsFor(t, trackFeel(t, analysis[t.id])).includes(mood));
}
