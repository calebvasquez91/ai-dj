// How the player adds up listening time before it reports it: once a second it says what is playing (or nothing), the time since the
// last look is credited to that song and playlist, and every 30 seconds or so what has built up is handed over to be sent.
// Pure, so the maths is tested without a browser (components/PlayStatsReporter.tsx does the timing and the sending).
import type { PlaySegment } from "@/lib/playStats";

export interface NowPlaying {
  trackId: string;
  playlistId: string | null;
}

export interface PlayAccumulator {
  /** Credits the time since the previous look to `current` (nothing when nothing is playing or it is the first look). */
  tick(now: number, current: NowPlaying | null): void;
  /** What has built up since the last call, as segments of at least one second; resets the totals. */
  drain(): PlaySegment[];
}

/**
 * `maxGapMs` caps what one look may credit: a laptop that slept or a tab whose timers were frozen must not turn a few minutes away
 * into an hour of listening.
 */
export function createPlayAccumulator(maxGapMs = 5000): PlayAccumulator {
  let last: number | null = null;
  const sums = new Map<string, PlaySegment>();
  return {
    tick(now, current) {
      if (last != null && current) {
        const seconds = Math.min(Math.max(now - last, 0), maxGapMs) / 1000;
        if (seconds > 0) {
          const key = `${current.trackId}|${current.playlistId ?? ""}`;
          const existing = sums.get(key);
          if (existing) existing.seconds += seconds;
          else sums.set(key, { trackId: current.trackId, playlistId: current.playlistId, seconds });
        }
      }
      last = now;
    },
    drain() {
      const out = [...sums.values()].map((s) => ({ ...s, seconds: Math.round(s.seconds * 10) / 10 })).filter((s) => s.seconds >= 1);
      sums.clear();
      return out;
    },
  };
}
