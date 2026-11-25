/**
 * Vocal swap planning, from the two songs' vocal activity (the voice maps of lib/voiceMap.ts, built from the isolated vocal stem). A vocal swap is a
 * hand-off in which the outgoing song's vocals drop out while its instrumental carries on, then the incoming song's vocals enter. The one rule is: never
 * two lead vocals at once. So the swap is scheduled in a vocal gap: a stretch where the OUTGOING vocal is silent, and where the incoming vocal is silent
 * too, so neither is cut in the middle of a word. If the window has no such gap the plan is null and the planner picks another style.
 *
 * Pure. Times are seconds; the outgoing song's time and the incoming song's time are tied by the transition: when the outgoing song is at `windowStartSec`
 * the incoming song is at `incomingEntrySec`, and both advance together (the two are tempo-matched for a swap).
 */
import type { VoiceMap } from "@/lib/voiceMap";

/** A silence shorter than this is a breath, not a place to hand a vocal over. */
export const MIN_SWAP_GAP_SEC = 0.8;

/** Share (0-1) of [startSec, endSec] with a lead vocal; null when there is no map (unknown: never a reason to veto anything). */
export function vocalDensity(map: VoiceMap | null | undefined, startSec: number, endSec: number): number | null {
  if (!map || !(endSec > startSec)) return null;
  let voiced = 0;
  for (const [a, b] of map.segments) {
    const lo = Math.max(a, startSec);
    const hi = Math.min(b, endSec);
    if (hi > lo) voiced += hi - lo;
  }
  return Math.min(1, voiced / (endSec - startSec));
}

/** The quiet stretches of [fromSec, toSec]: where no voiced segment is, each at least `minSec` long, in order. */
export function vocalGaps(map: VoiceMap, fromSec: number, toSec: number, minSec: number = MIN_SWAP_GAP_SEC): [number, number][] {
  const out: [number, number][] = [];
  let cursor = fromSec;
  for (const [a, b] of [...map.segments].sort((x, y) => x[0] - y[0])) {
    if (b <= cursor) continue;
    if (a >= toSec) break;
    if (a - cursor >= minSec) out.push([cursor, Math.min(a, toSec)]);
    cursor = Math.max(cursor, b);
  }
  if (toSec - cursor >= minSec) out.push([cursor, toSec]);
  return out;
}

export interface VocalSwapPlan {
  /** Outgoing-song time at which its vocal is muted (the instrumental carries on). Inside a gap in the outgoing vocal. */
  outgoingVocalOffSec: number;
  /** Incoming-song time at which its vocal is let in: its first voiced moment at or after the hand-over. */
  incomingVocalOnSec: number;
  /** The gap in the outgoing vocal that holds the hand-over, in outgoing-song time. */
  gapSec: [number, number];
  /** How long both lead vocals are audible together. Always 0 for a plan this module returns. */
  overlapSec: number;
}

export interface VocalSwapInput {
  outgoing: VoiceMap;
  incoming: VoiceMap;
  /** The window the hand-over may happen in, outgoing-song time. */
  windowStartSec: number;
  windowEndSec: number;
  /** Incoming-song time when the outgoing song is at windowStartSec. */
  incomingEntrySec: number;
  minGapSec?: number;
}

/**
 * How long two lead vocals would be audible together if the outgoing vocal is let through up to `outgoingOffSec` and the incoming one from
 * `incomingOnSec` (both in outgoing-song time, the incoming one already mapped). Zero when the hand-over is clean.
 */
export function leadVocalOverlapSec(outgoing: VoiceMap, incoming: VoiceMap, offsetIncomingToOutgoing: number, outgoingOffSec: number, incomingOnOutgoingSec: number): number {
  let overlap = 0;
  for (const [oa, ob] of outgoing.segments) {
    const oLo = oa, oHi = Math.min(ob, outgoingOffSec);
    if (oHi <= oLo) continue;
    for (const [ia, ib] of incoming.segments) {
      const iLo = Math.max(ia + offsetIncomingToOutgoing, incomingOnOutgoingSec);
      const iHi = ib + offsetIncomingToOutgoing;
      const lo = Math.max(oLo, iLo), hi = Math.min(oHi, iHi);
      if (hi > lo) overlap += hi - lo;
    }
  }
  return overlap;
}

/**
 * The hand-over, or null when the window has no gap to put it in (so the planner must choose another style). It looks for a gap in the outgoing vocal
 * that is also quiet in the incoming vocal for the same stretch, takes the earliest such stretch that is long enough, and lets the incoming vocal in
 * at its first voiced moment after that point.
 */
export function planVocalSwap(input: VocalSwapInput): VocalSwapPlan | null {
  const { outgoing, incoming, windowStartSec, windowEndSec } = input;
  const minGap = input.minGapSec ?? MIN_SWAP_GAP_SEC;
  if (!(windowEndSec > windowStartSec)) return null;
  // incoming-song time t_in = t_out + shift
  const shift = input.incomingEntrySec - windowStartSec;
  const outGaps = vocalGaps(outgoing, windowStartSec, windowEndSec, minGap);
  const inGapsInOutgoingTime = vocalGaps(incoming, windowStartSec + shift, windowEndSec + shift, minGap).map(([a, b]): [number, number] => [a - shift, b - shift]);

  for (const [g0, g1] of outGaps) {
    for (const [h0, h1] of inGapsInOutgoingTime) {
      const lo = Math.max(g0, h0), hi = Math.min(g1, h1);
      if (hi - lo < minGap) continue;
      // The hand-over point: the middle of the shared quiet stretch, so neither vocal is clipped at either edge.
      const handOver = (lo + hi) / 2;
      const next = [...incoming.segments].sort((x, y) => x[0] - y[0]).find(([a]) => a - shift >= handOver);
      const incomingOn = next ? next[0] : handOver + shift;
      const overlap = leadVocalOverlapSec(outgoing, incoming, -shift, handOver, handOver);
      if (overlap > 0) continue;
      return { outgoingVocalOffSec: handOver, incomingVocalOnSec: incomingOn, gapSec: [g0, g1], overlapSec: 0 };
    }
  }
  return null;
}
