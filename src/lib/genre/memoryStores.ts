/** In-memory versions of the job queue and the genre store, for tests (the database ones are in prismaStore.ts). */
import { STALE_RUNNING_MS } from "@/lib/genre/constants";
import type { ClaimedJob, ClassificationLog, GenreStore, JobState, JobStore } from "@/lib/genre/jobs";
import type { StoredGenre } from "@/lib/genre/stored";

export function memoryGenreStore(initial: Record<string, StoredGenre> = {}): GenreStore & { all(): Map<string, StoredGenre> } {
  const rows = new Map<string, StoredGenre>(Object.entries(initial));
  return {
    async get(trackId) {
      const row = rows.get(trackId);
      return row ? structuredClone(row) : null;
    },
    async save(trackId, stored) {
      rows.set(trackId, structuredClone(stored));
    },
    all: () => rows,
  };
}

interface MemJob {
  id: string;
  trackId: string;
  status: "queued" | "running" | "failed";
  priority: number;
  attempts: number;
  runAfter: number;
  startedAt: number | null;
  lastError: string | null;
  seq: number;
}

export function memoryJobStore(ownerOf: (trackId: string) => string | undefined = () => undefined): JobStore & { jobs: MemJob[] } {
  const jobs: MemJob[] = [];
  let seq = 0;
  return {
    jobs,
    async enqueue(trackIds, priority) {
      let queued = 0;
      for (const trackId of trackIds) {
        // A job that gave up is cleared when the track is asked for again, so a later success is not shadowed by it.
        for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].trackId === trackId && jobs[i].status === "failed") jobs.splice(i, 1);
        if (jobs.some((j) => j.trackId === trackId && (j.status === "queued" || j.status === "running"))) continue;
        jobs.push({ id: `job${++seq}`, trackId, status: "queued", priority, attempts: 0, runAfter: 0, startedAt: null, lastError: null, seq });
        queued++;
      }
      return queued;
    },
    async claim(limit, now, userId): Promise<ClaimedJob[]> {
      const t = now.getTime();
      const due = jobs
        .filter((j) => (j.status === "queued" && j.runAfter <= t) || (j.status === "running" && j.startedAt != null && j.startedAt < t - STALE_RUNNING_MS))
        .filter((j) => userId == null || ownerOf(j.trackId) === userId)
        .sort((a, b) => a.priority - b.priority || a.seq - b.seq)
        .slice(0, limit);
      for (const j of due) {
        j.status = "running";
        j.startedAt = t;
      }
      return due.map((j) => ({ id: j.id, trackId: j.trackId, attempts: j.attempts }));
    },
    async complete(id) {
      const i = jobs.findIndex((x) => x.id === id);
      if (i >= 0) jobs.splice(i, 1);
    },
    async fail(id, error, retryAt) {
      const j = jobs.find((x) => x.id === id);
      if (!j) return;
      j.attempts++;
      j.lastError = error;
      if (retryAt) {
        j.status = "queued";
        j.runAfter = retryAt.getTime();
      } else {
        j.status = "failed";
      }
    },
    async release(ids) {
      for (const j of jobs) if (ids.includes(j.id)) j.status = "queued";
    },
    async stateOf(trackIds) {
      const out = new Map<string, JobState>();
      for (const trackId of trackIds) {
        const latest = [...jobs].filter((j) => j.trackId === trackId).sort((a, b) => b.seq - a.seq)[0];
        if (latest) out.set(trackId, latest.status);
      }
      return out;
    },
  };
}

export function memoryLog(): { entries: ClassificationLog[]; write: (e: ClassificationLog) => Promise<void> } {
  const entries: ClassificationLog[] = [];
  return { entries, write: async (e) => void entries.push(e) };
}
