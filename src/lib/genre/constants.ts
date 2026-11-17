/** Numbers the pipeline and the job runner share. */

/** Below this best combined confidence (or when the sources conflict) the LLM reconciler is asked. */
export const LLM_LOW_CONFIDENCE = 0.6;

/** Job priorities: lower runs first. */
export const PRIORITY_REQUESTED = 0;
export const PRIORITY_BACKFILL = 5;

/** A job is retried with growing waits (BACKOFF_BASE_MS * 2^attempts, at most BACKOFF_MAX_MS) and given up after this many tries. */
export const MAX_JOB_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 60 * 60 * 1000;

/** A job still "running" this long after it started was abandoned (the function was cut off); it is picked up again. */
export const STALE_RUNNING_MS = 10 * 60 * 1000;
