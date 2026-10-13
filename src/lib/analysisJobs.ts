/**
 * Which track the background analyser should work on next (DualDeckStage.tsx runs the job and calls this when the
 * previous one finishes). Pure so the rules can be tested.
 *
 * The window is the playing track plus the next `ahead` LOCAL tracks of the queue. YouTube tracks have no audio file
 * to decode, so they don't take a slot: in a mixed queue the next local track is still found even with several
 * YouTube tracks between. The scan itself is capped so a queue of thousands of YouTube tracks isn't walked.
 */

import { ANALYSIS_LOOKAHEAD } from "@/lib/lookahead";

/** One analysis job may take no longer than this before it is abandoned (and the track marked as unanalysable for now). */
export const ANALYSIS_JOB_TIMEOUT_MS = 90_000;
/** How many queue entries are looked at when searching for upcoming local tracks. */
const SCAN_LIMIT = 200;

export interface JobTrack {
  id: string;
  source: string;
}

export interface JobAnalysis {
  /** `undefined` = a song map was never attempted; `null` = tried, nothing usable; an object = has one. */
  songMap?: unknown;
}

export interface NextAnalysisJob<T> {
  track: T;
  /** "fresh": no analysis yet. "upgrade": persisted analysis from an earlier session that lacks a song map. */
  kind: "fresh" | "upgrade";
}

export function pickNextAnalysisJob<T extends JobTrack>({
  currentTrack,
  queue,
  trackAnalysis,
  inFlightId,
  ahead = ANALYSIS_LOOKAHEAD,
  scanLimit = SCAN_LIMIT,
}: {
  currentTrack: T | null | undefined;
  queue: T[];
  trackAnalysis: Record<string, JobAnalysis | undefined>;
  /** The id of the job running right now, or null. One at a time: nothing else starts while this is set. */
  inFlightId: string | null;
  ahead?: number;
  scanLimit?: number;
}): NextAnalysisJob<T> | null {
  if (inFlightId != null) return null;

  const window: T[] = [];
  if (currentTrack && currentTrack.source === "local") window.push(currentTrack);
  const limit = Math.min(queue.length, Math.max(0, Math.floor(scanLimit)));
  let locals = 0;
  for (let i = 0; i < limit && locals < Math.max(0, Math.floor(ahead)); i++) {
    if (queue[i].source !== "local") continue;
    window.push(queue[i]);
    locals++;
  }

  for (const track of window) {
    const existing = trackAnalysis[track.id];
    if (!existing) return { track, kind: "fresh" };
    if (existing.songMap === undefined) return { track, kind: "upgrade" };
  }
  return null;
}
