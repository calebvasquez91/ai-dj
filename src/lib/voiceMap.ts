/**
 * A track's voice map: the stretches where somebody is singing or speaking, and the rule that turns it into "this
 * song has run out of voices, move on". The audio engineer's second job after picking stem candidates.
 *
 * Voices come from one of two places, best first:
 *  - "stem": the isolated vocal stem (lib/stemPlanner.ts decides which tracks get one). Accurate: the energy of the
 *    stem IS the vocal.
 *  - "lyrics": time-stamped lyric lines (lib/syncedLyrics.ts). Only the time ranges are kept, never the words.
 * A track with neither has no voice map and is left to play out as before. Listening for singing in a finished mix
 * is not reliable enough to act on, so that is deliberately not attempted.
 *
 * The cut-off is measured from the LAST voice in the whole track, not from "any quiet 10 seconds": a long
 * instrumental break in the middle of a song is left alone because singing comes back after it.
 */

export type VoiceSource = "stem" | "lyrics";

export interface VoiceMap {
  source: VoiceSource;
  /** Length of the audio the map was built from (a stem's duration, or the lyrics service's) — checked against the track's own. */
  durationSec: number;
  /** [startSec, endSec] of each voiced stretch, in order. */
  segments: [number, number][];
}

/** How long after the last voice the song moves on. */
export const VOICE_SILENCE_CUT_SEC = 10;
/** A map with less voiced time than this isn't a vocal track (noise, a spoken sample) — never acted on. */
const MIN_VOICED_TOTAL_SEC = 15;
/**
 * How far into the track the last voice must end for the cut-off to be believed, as a share of its length. Time-stamped
 * lyrics can be misaligned (a different edit, community-made timing), so a lyrics map claiming the singing stopped
 * early is more likely wrong than a song with a long instrumental ending; an isolated vocal stem is the actual vocal,
 * so it is trusted much earlier.
 */
const MIN_CUT_FRACTION: Record<VoiceSource, number> = { lyrics: 0.5, stem: 0.1 };
/** Whatever the source, never cut a song before this much of it has played. */
const MIN_CUTOFF_SEC = 30;
/** A map built from audio of a different length (an edit, a live version) isn't trusted against this track. */
const DURATION_TOLERANCE = 0.03;
/** If the cut-off lands this close to the end of the file the natural transition will do it anyway. */
const NATURAL_END_MARGIN_SEC = 5;

/** Shortest voiced stretch kept, and the longest quiet gap bridged (a breath between phrases). */
const MIN_SEGMENT_SEC = 0.25;
const MERGE_GAP_SEC = 1.0;
/** Voiced = louder than this share of the stem's loud level, and above an absolute floor. */
const VOICED_RELATIVE_LEVEL = 0.12;
const VOICED_ABSOLUTE_FLOOR = 0.002;

const ENVELOPE_HOP_SEC = 0.05;

/** RMS of each ENVELOPE_HOP_SEC slice of mono samples. */
export function envelopeFromSamples(samples: ArrayLike<number>, sampleRate: number, hopSec: number = ENVELOPE_HOP_SEC): number[] {
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const out: number[] = [];
  for (let start = 0; start < samples.length; start += hop) {
    const end = Math.min(samples.length, start + hop);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      sum += v * v;
    }
    out.push(Math.sqrt(sum / (end - start)));
  }
  return out;
}

/** Voiced stretches from a level envelope: above a share of the stem's own loud level, with breaths bridged and blips dropped. */
export function segmentsFromEnvelope(envelope: number[], hopSec: number = ENVELOPE_HOP_SEC): [number, number][] {
  if (envelope.length === 0) return [];
  const sorted = [...envelope].sort((a, b) => a - b);
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
  const threshold = Math.max(VOICED_ABSOLUTE_FLOOR, VOICED_RELATIVE_LEVEL * loud);
  if (loud < VOICED_ABSOLUTE_FLOOR) return []; // a silent stem

  const raw: [number, number][] = [];
  let open: number | null = null;
  for (let i = 0; i < envelope.length; i++) {
    const voiced = envelope[i] > threshold;
    if (voiced && open == null) open = i;
    if (!voiced && open != null) {
      raw.push([open * hopSec, i * hopSec]);
      open = null;
    }
  }
  if (open != null) raw.push([open * hopSec, envelope.length * hopSec]);

  const merged: [number, number][] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && seg[0] - last[1] <= MERGE_GAP_SEC) last[1] = seg[1];
    else merged.push([seg[0], seg[1]]);
  }
  return merged.filter(([a, b]) => b - a >= MIN_SEGMENT_SEC).map(([a, b]) => [round3(a), round3(b)]);
}

/** A voice map from an isolated vocal stem's mono samples. */
export function voiceMapFromStem(samples: ArrayLike<number>, sampleRate: number): VoiceMap {
  return {
    source: "stem",
    durationSec: round3(samples.length / sampleRate),
    segments: segmentsFromEnvelope(envelopeFromSamples(samples, sampleRate)),
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function totalVoicedSec(map: VoiceMap): number {
  return map.segments.reduce((sum, [a, b]) => sum + (b - a), 0);
}

/** End of the final voiced stretch, or null for a map with none. */
export function lastVoiceEndSec(map: VoiceMap | null | undefined): number | null {
  if (!map || map.segments.length === 0) return null;
  return map.segments.reduce((end, [, b]) => Math.max(end, b), 0);
}

/**
 * When the song should move on because its voices are done: `silenceSec` after the last voice ends. Null — leave the
 * track alone — when there is no usable map, the map doesn't match this track's length, there is too little voiced
 * time to be a vocal track, the claimed end of singing is implausibly early, or the natural end is about as soon.
 */
export function voiceCutoffSec(
  map: VoiceMap | null | undefined,
  trackDurationSec: number,
  silenceSec: number = VOICE_SILENCE_CUT_SEC
): number | null {
  if (!map || !(trackDurationSec > 0)) return null;
  if (Math.abs(map.durationSec - trackDurationSec) > trackDurationSec * DURATION_TOLERANCE) return null;
  if (totalVoicedSec(map) < MIN_VOICED_TOTAL_SEC) return null;
  const lastEnd = lastVoiceEndSec(map);
  if (lastEnd == null) return null;
  if (lastEnd < trackDurationSec * MIN_CUT_FRACTION[map.source]) return null;
  const cutoff = lastEnd + silenceSec;
  if (cutoff < MIN_CUTOFF_SEC) return null;
  if (cutoff >= trackDurationSec - NATURAL_END_MARGIN_SEC) return null;
  return round3(cutoff);
}
