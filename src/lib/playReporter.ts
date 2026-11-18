// How the player adds up listening time before it reports it. Time is counted from how far the song's PLAYBACK POSITION moved, not from
// how often a timer fired: a locked phone or a backgrounded tab looks rarely, but the position still shows how much really played,
// and a paused or stalled player does not move it at all. The movement is capped by the clock time that really passed, so seeking
// forward cannot count as listening. Pure, so the maths is tested without a browser (components/PlayStatsReporter.tsx does the
// subscribing and the sending).
import type { PlaySegment } from "@/lib/playStats";

export interface NowPlaying {
  trackId: string;
  playlistId: string | null;
  /** Where in the song playback is, in seconds. */
  positionSec: number;
}

export interface PlayAccumulator {
  /** Says what is playing now (or null when nothing is) and credits the progress since the previous call. */
  observe(now: number, current: NowPlaying | null): void;
  /** Seconds built up since the last drain. */
  pendingSeconds(): number;
  /** What has built up since the last call, as segments of at least one second; resets the totals. */
  drain(): PlaySegment[];
}

/**
 * `toleranceSec` is the slack allowed between how far the position moved and the clock time between two looks (timer jitter): the
 * credit is the smaller of the two, plus that slack, so a seek of a minute counts for a moment, not a minute.
 */
export function createPlayAccumulator(toleranceSec = 0.5): PlayAccumulator {
  let prev: (NowPlaying & { at: number }) | null = null;
  const sums = new Map<string, PlaySegment>();
  return {
    observe(now, current) {
      if (current && prev && prev.trackId === current.trackId && prev.playlistId === current.playlistId) {
        const progressed = current.positionSec - prev.positionSec;
        const elapsed = (now - prev.at) / 1000;
        const credit = Math.min(progressed, elapsed + toleranceSec);
        if (Number.isFinite(credit) && credit > 0) {
          const key = `${current.trackId}|${current.playlistId ?? ""}`;
          const existing = sums.get(key);
          if (existing) existing.seconds += credit;
          else sums.set(key, { trackId: current.trackId, playlistId: current.playlistId, seconds: credit });
        }
      }
      prev = current ? { ...current, at: now } : null;
    },
    pendingSeconds() {
      let total = 0;
      for (const s of sums.values()) total += s.seconds;
      return total;
    },
    drain() {
      const out = [...sums.values()].map((s) => ({ ...s, seconds: Math.round(s.seconds * 10) / 10 })).filter((s) => s.seconds >= 1);
      sums.clear();
      return out;
    },
  };
}
