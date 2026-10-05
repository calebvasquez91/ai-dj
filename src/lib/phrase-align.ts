/**
 * Planner-facing helpers over a song map (song-map.ts): where in a bar is
 * the playhead, which bar line or phrase boundary is nearest a target, and
 * where to start the incoming track so that BOTH tracks sit on the same
 * beat of the bar when the transition begins — the "bar/phrase matching" a
 * DJ does, instead of the beat-level alignment snapToBeatGrid gives.
 *
 * Everything here is pure and returns null when the song map can't support
 * the answer, so callers fall back to the beat grid unchanged.
 */

import { isPhraseGridTrustworthy, type SongMap } from "@/lib/song-map";

/** A phrase boundary within this many bars of the target wins over the nearest bar line. */
const PHRASE_PREFERENCE_BARS = 2;

function barLength(map: SongMap, index: number): number {
  const d = map.downbeats;
  if (index + 1 < d.length) return d[index + 1] - d[index];
  if (index > 0) return d[index] - d[index - 1];
  return map.bpm > 0 ? (4 * 60) / map.bpm : 2;
}

/** Index of the last downbeat at or before `timeSec`; -1 when the time is before the first bar line. */
function barIndexAt(map: SongMap, timeSec: number): number {
  const d = map.downbeats;
  let lo = 0;
  let hi = d.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= timeSec + 1e-6) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Where `timeSec` falls within its bar, in beats (0 = on the downbeat, 3.5 = halfway through beat 4). Null when the map is untrustworthy or the time is before the first bar line. */
export function beatInBarAt(map: SongMap | null | undefined, timeSec: number): number | null {
  if (!isPhraseGridTrustworthy(map)) return null;
  const i = barIndexAt(map, timeSec);
  if (i < 0) return null;
  const len = barLength(map, i);
  if (len <= 0) return null;
  return Math.min(3.999, Math.max(0, (4 * (timeSec - map.downbeats[i])) / len));
}

/** The bar line nearest `timeSec` — or the 8-bar phrase boundary instead, when one is within two bars. Null when the map is untrustworthy. */
export function snapToDownbeatOrPhrase(
  map: SongMap | null | undefined,
  timeSec: number,
  { preferPhrase = true }: { preferPhrase?: boolean } = {}
): number | null {
  if (!isPhraseGridTrustworthy(map)) return null;
  let bar = map.downbeats[0];
  for (const t of map.downbeats) if (Math.abs(t - timeSec) < Math.abs(bar - timeSec)) bar = t;
  const barLen = barLength(map, Math.max(0, barIndexAt(map, bar)));
  let best = bar;
  if (preferPhrase && map.phrases.confidence > 0 && map.phrases.bars8.length > 0) {
    let phrase = map.phrases.bars8[0];
    for (const t of map.phrases.bars8) if (Math.abs(t - timeSec) < Math.abs(phrase - timeSec)) phrase = t;
    if (Math.abs(phrase - timeSec) <= PHRASE_PREFERENCE_BARS * barLen) best = phrase;
  }
  return best;
}

/**
 * Where to start the incoming track: on one of its bar lines (or phrase boundary) near `rawEntrySec`, shifted
 * forward by the outgoing track's current beat-in-bar so both tracks are on the same beat of their bar at the
 * moment the mix begins. `preferPhrase: false` keeps to the nearest bar line (use it when the entry point has to
 * land a specific moment, e.g. a drop, to within a bar). Null when either song map can't be trusted — the caller
 * keeps its beat-grid logic.
 */
export function alignEntryToBar(
  incoming: SongMap | null | undefined,
  rawEntrySec: number,
  outgoing: SongMap | null | undefined,
  outgoingTimeSec: number | null,
  options: { preferPhrase?: boolean } = {}
): number | null {
  if (outgoingTimeSec == null) return null;
  const outBeat = beatInBarAt(outgoing, outgoingTimeSec);
  const base = snapToDownbeatOrPhrase(incoming, rawEntrySec, options);
  if (outBeat == null || base == null || !incoming) return null;
  const i = barIndexAt(incoming, base);
  return base + (outBeat / 4) * barLength(incoming, Math.max(0, i));
}
