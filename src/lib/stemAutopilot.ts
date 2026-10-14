/**
 * What the stem autopilot does next, given the upcoming tracks, the audio engineer's verdicts and what is known about
 * each track's separation job. Pure: the component (components/StemAutopilot.tsx) does the network calls and asks this
 * what to do, so the rules — nearest worthwhile track first, one job at a time, never re-run a failed one — can be
 * tested.
 */

import type { StemVerdict } from "@/lib/stemPlanner";

/** unknown = not looked up yet; none = looked up, no job exists. */
export type StemJobState = "unknown" | "none" | "processing" | "ready" | "failed";

/** Automatic jobs the client runs at once. (The server allows a couple more, as a backstop.) */
export const AUTOPILOT_MAX_IN_FLIGHT = 1;

export interface AutopilotPlan {
  /** Tracks whose job state has to be looked up first (the engineer wants them, nothing is known yet). */
  check: string[];
  /** The track to start a separation for now, or null. */
  start: string | null;
}

export function planStemAutopilot({
  verdicts,
  states,
  inFlight,
  maxInFlight = AUTOPILOT_MAX_IN_FLIGHT,
}: {
  /** In queue order, nearest first. */
  verdicts: StemVerdict[];
  states: Record<string, StemJobState | undefined>;
  /** Jobs currently running (this client's own, plus any known processing in the window). */
  inFlight: number;
  maxInFlight?: number;
}): AutopilotPlan {
  const check: string[] = [];
  let start: string | null = null;
  for (const verdict of verdicts) {
    if (!verdict.worthIt) continue;
    const state = states[verdict.trackId] ?? "unknown";
    if (state === "unknown") {
      check.push(verdict.trackId);
      continue;
    }
    // A failed job is not retried automatically: it would be billed again for the same likely failure.
    if (state === "none" && start == null && inFlight < maxInFlight) start = verdict.trackId;
  }
  return { check, start };
}

/** The job's server status string mapped to a StemJobState (`null` = the track has no job). */
export function stemStateFromJob(job: { status?: string } | null | undefined): StemJobState {
  if (!job) return "none";
  if (job.status === "ready") return "ready";
  if (job.status === "failed") return "failed";
  return "processing"; // "pending" | "processing"
}
