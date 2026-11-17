/**
 * Classification jobs: a track is queued by an import, a "Re-classify" or the backfill, and a runner works through the
 * queue a few at a time. The queue and the stored results sit behind interfaces (the database in production, memory in
 * tests); the runner here holds the rules: oldest-priority first, one failure never stops the batch, a failed job waits and
 * tries again with growing delays, and it stops when its time budget (a serverless function's) is nearly spent.
 */
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, MAX_JOB_ATTEMPTS } from "@/lib/genre/constants";
import { resolveGenreTags } from "@/lib/genre/combine";
import { classifyTrack, type PipelineDeps, type SourceLog } from "@/lib/genre/pipeline";
import { mergeRun, type StoredGenre } from "@/lib/genre/stored";
import type { ProviderInput } from "@/lib/genre/types";

export type JobState = "queued" | "running" | "failed";

export interface ClaimedJob {
  id: string;
  trackId: string;
  /** Tries made before this one. */
  attempts: number;
}

export interface JobStore {
  /** Queues the tracks that have no queued or running job; returns how many were queued. A lower priority number runs first. */
  enqueue(trackIds: readonly string[], priority: number): Promise<number>;
  /** Takes up to `limit` due jobs (queued and past their wait, or running for too long), oldest priority first, and marks them running. `userId` limits it to that user's tracks. */
  claim(limit: number, now: Date, userId?: string): Promise<ClaimedJob[]>;
  complete(id: string, now: Date): Promise<void>;
  /** Counts a failed try. `retryAt` is when to try again; null gives the job up for good. */
  fail(id: string, error: string, retryAt: Date | null, now: Date): Promise<void>;
  /** Puts jobs back in the queue untouched (not counted as a try): the runner ran out of time before reaching them. */
  release(ids: readonly string[]): Promise<void>;
  /** The queued, running or failed job state of each given track (tracks with none are absent). */
  stateOf(trackIds: readonly string[]): Promise<Map<string, JobState>>;
}

export interface GenreStore {
  get(trackId: string): Promise<StoredGenre | null>;
  save(trackId: string, stored: StoredGenre): Promise<void>;
}

export interface ClassificationLog {
  trackId: string;
  status: string;
  genre: string | null;
  confidence: number | null;
  sources: SourceLog[];
  usedLlm: boolean;
}

export interface JobRunnerDeps {
  jobs: JobStore;
  store: GenreStore;
  pipeline: PipelineDeps;
  /** The track's metadata for the providers, or null when it no longer exists. */
  loadTrack(trackId: string): Promise<ProviderInput | null>;
  writeLog(entry: ClassificationLog): Promise<void>;
  now?: () => Date;
}

export interface RunOptions {
  maxJobs: number;
  /** Stop starting new jobs after this many ms (a job in progress is let finish). */
  budgetMs: number;
  userId?: string;
}

export interface RunSummary {
  processed: number;
  failed: number;
  retrying: number;
  /** Stopped before the queue was empty (the budget or maxJobs ran out). */
  more: boolean;
}

/** The wait before try number `attempts + 1`: 30 s, 60 s, 2 min, 4 min... up to an hour. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts));
}

export async function runJobs(deps: JobRunnerDeps, options: RunOptions): Promise<RunSummary> {
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const summary: RunSummary = { processed: 0, failed: 0, retrying: 0, more: false };
  const claimed = await deps.jobs.claim(options.maxJobs, now(), options.userId);
  for (let i = 0; i < claimed.length; i++) {
    const job = claimed[i];
    if (Date.now() - started > options.budgetMs) {
      // Out of time: put the rest back to be picked up on the next run, without counting a try.
      await deps.jobs.release(claimed.slice(i).map((rest) => rest.id));
      summary.more = true;
      break;
    }
    try {
      const input = await deps.loadTrack(job.trackId);
      if (!input) {
        await deps.jobs.complete(job.id, now());
        continue;
      }
      const existing = await deps.store.get(job.trackId);
      const outcome = await classifyTrack(input, deps.pipeline, { confirmed: existing?.status === "confirmed" });
      const stored = mergeRun(existing, outcome, now().getTime());
      await deps.store.save(job.trackId, stored);
      const resolution = resolveGenreTags(stored.tags);
      await deps.writeLog({ trackId: job.trackId, status: stored.status, genre: stored.genre ?? null, confidence: resolution.best || null, sources: outcome.sources, usedLlm: outcome.usedLlm });
      await deps.jobs.complete(job.id, now());
      summary.processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 300) : "error";
      const tries = job.attempts + 1;
      if (tries >= MAX_JOB_ATTEMPTS) {
        await deps.jobs.fail(job.id, message, null, now());
        summary.failed++;
      } else {
        await deps.jobs.fail(job.id, message, new Date(now().getTime() + backoffMs(job.attempts)), now());
        summary.retrying++;
      }
    }
  }
  if (!summary.more) summary.more = claimed.length >= options.maxJobs;
  return summary;
}
