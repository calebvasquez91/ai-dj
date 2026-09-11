// Manual tap-tempo — the fallback/override path for a YouTube track's bpm
// when there's no metadata match (lib/youtubeBpm.ts) or the match is
// wrong. computeBpmFromTaps is pure/tested on its own; useTapTempo just
// wraps it with the React state a tap button needs.
import { useCallback, useRef, useState } from "react";

const MIN_TAPS_FOR_ESTIMATE = 2;
/** A tap gap longer than this means the user paused/stopped — start a fresh reading instead of averaging across the gap. */
const RESET_GAP_MS = 2000;
/** Only the most recent taps count, so a stale early tap (or a brief mis-tap) doesn't keep dragging the average once a steadier rhythm is established. */
const MAX_TAPS = 8;
/** How many taps before a reading is considered stable enough to save. */
export const MIN_TAPS_TO_COMMIT = 4;

export function computeBpmFromTaps(tapTimestampsMs: number[]): number | null {
  if (tapTimestampsMs.length < MIN_TAPS_FOR_ESTIMATE) return null;
  const intervals: number[] = [];
  for (let i = 1; i < tapTimestampsMs.length; i++) {
    intervals.push(tapTimestampsMs[i] - tapTimestampsMs[i - 1]);
  }
  const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (avgMs <= 0) return null;
  return Math.round(60000 / avgMs);
}

export function useTapTempo() {
  const tapsRef = useRef<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const [tapCount, setTapCount] = useState(0);

  const tap = useCallback(() => {
    const now = performance.now();
    const taps = tapsRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > RESET_GAP_MS) {
      taps.length = 0; // stale gap since the last tap — this is a fresh reading, not a continuation
    }
    taps.push(now);
    if (taps.length > MAX_TAPS) taps.shift();
    setTapCount(taps.length);
    setBpm(computeBpmFromTaps(taps));
  }, []);

  const reset = useCallback(() => {
    tapsRef.current = [];
    setBpm(null);
    setTapCount(0);
  }, []);

  return { bpm, tapCount, canCommit: tapCount >= MIN_TAPS_TO_COMMIT, tap, reset };
}
