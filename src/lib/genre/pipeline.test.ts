import { describe, expect, it, vi } from "vitest";
import {
  COMBINED_CAP,
  EARLY_STOP_CONFIDENCE,
  KEEP_CONFIDENCE,
  SOURCE_WEIGHT,
  combineSourceTags,
  disagreesWithManual,
  resolveGenreTags,
  sourcesConflict,
  statusFor,
} from "@/lib/genre/combine";
import { applyManualGenres, clearManualGenres, finalizeStored, mergeRun, suggestionsFrom, validPicks, type StoredGenre } from "@/lib/genre/stored";
import { classifyTrack, type PipelineDeps } from "@/lib/genre/pipeline";
import { BACKOFF_BASE_MS, MAX_JOB_ATTEMPTS, STALE_RUNNING_MS } from "@/lib/genre/constants";
import { backoffMs, runJobs, type JobRunnerDeps } from "@/lib/genre/jobs";
import { memoryGenreStore, memoryJobStore, memoryLog } from "@/lib/genre/memoryStores";
import type { GenreProvider, ProviderInput, ProviderResult } from "@/lib/genre/types";
import type { GenreTag, GenreTagSource } from "@/types/music";

const tag = (source: GenreTagSource, genre: string, confidence: number, subgenre?: string): GenreTag => ({ genre, ...(subgenre ? { subgenre } : {}), source, confidence, updatedAt: 1 });
const input: ProviderInput = { trackId: "t1", title: "Song", artist: "Artist", durationSec: 200, source: "local", storageKey: "k", mimeType: "audio/mpeg" };

describe("combining sources", () => {
  const w = SOURCE_WEIGHT;

  it("lets a lone tag keep (its weighted) confidence, so a lone low-confidence tag stays low", () => {
    const r = combineSourceTags([tag("file-tags", "Pop", 0.3)]);
    expect(r.best).toBeCloseTo(0.3 * w["file-tags"]);
    expect(r.genres).toEqual([]);
  });

  it("gains confidence when two independent sources agree", () => {
    const lone = combineSourceTags([tag("file-tags", "Pop", 0.6)]).best;
    const agreed = combineSourceTags([tag("file-tags", "Pop", 0.6), tag("lastfm", "Pop", 0.6)]).best;
    expect(agreed).toBeGreaterThan(lone);
    expect(agreed).toBeCloseTo(1 - (1 - 0.6 * w["file-tags"]) * (1 - 0.6 * w.lastfm));
    expect(combineSourceTags([tag("file-tags", "Pop", 0.4), tag("lastfm", "Pop", 0.4)]).best).toBeGreaterThan(0.4);
  });

  it("never goes above the cap, however many sources agree", () => {
    const many = (["file-tags", "musicbrainz", "lastfm", "audio-classifier"] as const).map((s) => tag(s, "Rock", 0.99));
    expect(combineSourceTags(many).best).toBe(COMBINED_CAP);
  });

  it("counts one source once for a genre it names twice", () => {
    const once = combineSourceTags([tag("musicbrainz", "Rock", 0.7)]).best;
    const twice = combineSourceTags([tag("musicbrainz", "Rock", 0.7), tag("musicbrainz", "Rock", 0.7)]).best;
    expect(twice).toBeCloseTo(once);
  });

  it("counts a subgenre tag, a little less, for its parent genre, and keeps the subgenre once it is sure enough", () => {
    const r = combineSourceTags([tag("musicbrainz", "Hip-Hop", 0.7, "Trap"), tag("lastfm", "Hip-Hop", 0.7, "Trap")]);
    expect(r.genres[0].genre).toBe("Hip-Hop");
    expect(r.genres[0].subgenres.map((s) => s.subgenre)).toEqual(["Trap"]);
    const lone = combineSourceTags([tag("audio-classifier", "Hip-Hop", 0.5, "Trap")]);
    expect(lone.genres).toEqual([]);
  });

  it("does not let the LLM compound with the sources it was shown", () => {
    const sources = combineSourceTags([tag("file-tags", "Pop", 0.6)]).best;
    const withLlm = combineSourceTags([tag("file-tags", "Pop", 0.6), tag("llm", "Pop", 0.6)]).best;
    const independent = combineSourceTags([tag("file-tags", "Pop", 0.6), tag("lastfm", "Pop", 0.6)]).best;
    expect(withLlm).toBeCloseTo(sources, 5);
    expect(withLlm).toBeLessThan(independent);
  });

  it("ignores tags that are not on the taxonomy", () => {
    expect(combineSourceTags([tag("musicbrainz", "Polka", 0.9), tag("musicbrainz", "Rock", 0.7, "Polka Rock")]).best).toBe(0);
  });

  it("orders genres best first and keeps those at or above 0.5", () => {
    const r = combineSourceTags([tag("musicbrainz", "Rock", 0.7), tag("musicbrainz", "Pop", 0.55), tag("musicbrainz", "Jazz", 0.3)]);
    expect(r.genres.map((g) => g.genre)).toEqual(["Rock", "Pop"]);
    expect(KEEP_CONFIDENCE).toBe(0.5);
  });
});

describe("conflict between sources", () => {
  it("is when the top two sources name genres with nothing in common", () => {
    expect(sourcesConflict([tag("file-tags", "Pop", 0.6), tag("lastfm", "Rock", 0.7)])).toBe(true);
  });
  it("is not when they share a genre, or when only one source is sure", () => {
    expect(sourcesConflict([tag("file-tags", "Pop", 0.6), tag("file-tags", "Rock", 0.45), tag("lastfm", "Rock", 0.7)])).toBe(false);
    expect(sourcesConflict([tag("file-tags", "Pop", 0.3), tag("lastfm", "Rock", 0.7)])).toBe(false);
    expect(sourcesConflict([tag("lastfm", "Rock", 0.7)])).toBe(false);
    expect(sourcesConflict([])).toBe(false);
  });
  it("looks only at the two most confident sources", () => {
    expect(sourcesConflict([tag("musicbrainz", "Rock", 0.7), tag("lastfm", "Rock", 0.65), tag("file-tags", "Jazz", 0.5)])).toBe(false);
  });
});

describe("resolving a track", () => {
  it("is auto when the best genre is at least 0.5 and the sources agree", () => {
    const r = resolveGenreTags([tag("musicbrainz", "Rock", 0.7)]);
    expect(r.autoStatus).toBe("auto");
    expect(r.genres.map((g) => g.genre)).toEqual(["Rock"]);
  });
  it("needs review when nothing reaches 0.5", () => {
    expect(resolveGenreTags([tag("file-tags", "Pop", 0.4)]).autoStatus).toBe("needs-review");
    expect(resolveGenreTags([]).autoStatus).toBe("needs-review");
    expect(resolveGenreTags(undefined).genres).toEqual([]);
  });
  it("needs review when the top two sources conflict, even though one is confident", () => {
    const r = resolveGenreTags([tag("file-tags", "Pop", 0.6), tag("lastfm", "Rock", 0.75)]);
    expect(r.conflict).toBe(true);
    expect(r.autoStatus).toBe("needs-review");
    expect(r.genres[0].genre).toBe("Rock");
  });
  it("is settled by an LLM that sides with one of them", () => {
    const r = resolveGenreTags([tag("file-tags", "Pop", 0.6), tag("lastfm", "Rock", 0.7), tag("llm", "Rock", 0.7)]);
    expect(r.conflict).toBe(false);
    expect(r.autoStatus).toBe("auto");
    const split = resolveGenreTags([tag("file-tags", "Pop", 0.6), tag("lastfm", "Rock", 0.7), tag("llm", "Jazz", 0.75)]);
    expect(split.autoStatus).toBe("needs-review");
  });
  it("resolves to a person's genres alone when they set any", () => {
    const r = resolveGenreTags([tag("manual", "Jazz", 1, "Bebop"), tag("lastfm", "Rock", 0.95), tag("musicbrainz", "Rock", 0.95)]);
    expect(r.manual).toBe(true);
    expect(r.genres).toEqual([{ genre: "Jazz", confidence: 1, subgenres: [{ subgenre: "Bebop", confidence: 1 }], sources: ["manual"] }]);
  });
  it("keeps a confirmation: statusFor never takes it back", () => {
    expect(statusFor([tag("musicbrainz", "Rock", 0.7)], "confirmed")).toBe("confirmed");
    expect(statusFor([tag("manual", "Rock", 1)], undefined)).toBe("confirmed");
    expect(statusFor([tag("musicbrainz", "Rock", 0.7)], "needs-review")).toBe("auto");
    expect(statusFor([], "auto")).toBe("needs-review");
  });
  it("flags a confirmed track whose sources now strongly point somewhere else, without changing it", () => {
    const tags = [tag("manual", "Jazz", 1), tag("musicbrainz", "Rock", 0.7), tag("lastfm", "Rock", 0.7)];
    expect(disagreesWithManual(tags)).toBe(true);
    expect(disagreesWithManual([tag("manual", "Rock", 1), ...tags.slice(1)])).toBe(false);
    expect(disagreesWithManual([tag("manual", "Jazz", 1), tag("lastfm", "Rock", 0.4)])).toBe(false);
    expect(disagreesWithManual([tag("musicbrainz", "Rock", 0.9)])).toBe(false);
  });
});

describe("stored genres", () => {
  const stored = (tags: GenreTag[], status: StoredGenre["status"] = "auto", moods: string[] = []): StoredGenre => finalizeStored(tags, moods, status, 1);

  it("derives the summary and status from the tags", () => {
    const s = finalizeStored([tag("musicbrainz", "Hip-Hop", 0.7, "Trap"), tag("lastfm", "Hip-Hop", 0.7, "Trap")], ["chill"], undefined, 5);
    expect(s).toMatchObject({ status: "auto", genre: "Hip-Hop", subgenres: ["Trap"], moods: ["chill"], updatedAt: 5 });
  });

  it("a manual override survives a re-run, and the re-run only fills gaps", () => {
    const edited = applyManualGenres(stored([tag("lastfm", "Rock", 0.7)]), [{ genre: "Jazz", subgenre: "Bebop" }], 10)!;
    expect(edited.status).toBe("confirmed");
    expect(edited.tags.find((t) => t.source === "manual")).toMatchObject({ genre: "Jazz", subgenre: "Bebop", confidence: 1 });
    // The re-run says Rock, loudly, from two sources.
    const rerun = mergeRun(edited, { tags: [tag("musicbrainz", "Rock", 0.95), tag("lastfm", "Rock", 0.95), tag("file-tags", "Rock", 0.6)], moods: ["dark"] }, 20);
    expect(rerun.status).toBe("confirmed");
    expect(rerun.genre).toBe("Jazz");
    expect(rerun.subgenres).toEqual(["Bebop"]);
    expect(rerun.tags.filter((t) => t.source === "manual")).toEqual(edited.tags.filter((t) => t.source === "manual"));
    // ...but the new source tags were added (filling gaps), so the disagreement can be shown.
    expect(rerun.tags.some((t) => t.source === "musicbrainz")).toBe(true);
    expect(disagreesWithManual(rerun.tags)).toBe(true);
  });

  it("keeps a source's old tags when it gave nothing this time, and replaces them when it did", () => {
    const before = stored([tag("musicbrainz", "Rock", 0.7), tag("lastfm", "Pop", 0.6)]);
    const after = mergeRun(before, { tags: [tag("lastfm", "Jazz", 0.65)], moods: [] }, 2);
    expect(after.tags.filter((t) => t.source === "musicbrainz")).toHaveLength(1);
    expect(after.tags.filter((t) => t.source === "lastfm").map((t) => t.genre)).toEqual(["Jazz"]);
  });

  it("merges moods, newest first, up to five", () => {
    const m = mergeRun(stored([], "auto", ["sad", "dark", "focus", "sleep"]), { tags: [], moods: ["chill", "party", "dark"] }, 3);
    expect(m.moods).toEqual(["chill", "party", "dark", "sad", "focus"]);
  });

  it("only accepts a manual pick that is on the taxonomy, and returns null for none", () => {
    expect(applyManualGenres(null, [{ genre: "Polka" }, { genre: "Rock", subgenre: "Zzz" }], 1)).toBeNull();
    expect(validPicks([{ genre: "Rock" }, { genre: "Rock" }, { genre: "Hip-Hop", subgenre: "Trap" }, { genre: "Rock", subgenre: "Nope" }])).toEqual([{ genre: "Rock" }, { genre: "Hip-Hop", subgenre: "Trap" }]);
    const two = applyManualGenres(null, [{ genre: "Rock" }, { genre: "Pop" }], 1)!;
    expect(two.tags.filter((t) => t.source === "manual")).toHaveLength(2);
  });

  it("replaces an earlier manual edit, and can be cleared back to the sources", () => {
    const one = applyManualGenres(stored([tag("lastfm", "Rock", 0.7)]), [{ genre: "Jazz" }], 1)!;
    const two = applyManualGenres(one, [{ genre: "Blues" }], 2)!;
    expect(two.tags.filter((t) => t.source === "manual").map((t) => t.genre)).toEqual(["Blues"]);
    const cleared = clearManualGenres(two, 3);
    expect(cleared.status).toBe("auto");
    expect(cleared.genre).toBe("Rock");
    expect(cleared.tags.some((t) => t.source === "manual")).toBe(false);
  });

  it("lists the sources' own suggestions, best first, one per source and genre", () => {
    const s = suggestionsFrom([tag("lastfm", "Rock", 0.5), tag("lastfm", "Rock", 0.7), tag("musicbrainz", "Pop", 0.6), tag("manual", "Jazz", 1)]);
    expect(s.map((t) => `${t.source}:${t.genre}:${t.confidence}`)).toEqual(["lastfm:Rock:0.7", "musicbrainz:Pop:0.6"]);
  });
});

/** A provider that answers a fixed result and records that it was called. */
function fake(id: GenreTagSource, result: Partial<ProviderResult> | (() => ProviderResult | Promise<ProviderResult>), calls?: string[]): GenreProvider {
  return {
    id,
    async classify() {
      calls?.push(id);
      const r = typeof result === "function" ? await result() : result;
      return { tags: [], moods: [], ...r };
    },
  };
}

function deps(over: Partial<PipelineDeps> = {}, calls: string[] = []): PipelineDeps {
  return {
    fileTags: fake("file-tags", {}, calls),
    fingerprint: null,
    musicbrainz: fake("musicbrainz", {}, calls),
    lastfm: fake("lastfm", {}, calls),
    audioClassifier: null,
    llm: fake("llm", {}, calls),
    clock: () => 0,
    ...over,
  };
}

describe("the pipeline", () => {
  it("runs the providers in order: file tags, MusicBrainz, Last.fm, audio classifier, LLM", async () => {
    const calls: string[] = [];
    await classifyTrack(input, deps({ audioClassifier: fake("audio-classifier", {}, calls) }, calls));
    expect(calls).toEqual(["file-tags", "musicbrainz", "lastfm", "audio-classifier", "llm"]);
  });

  it("stops early once the answer is confident, and does not ask the rest", async () => {
    const calls: string[] = [];
    const out = await classifyTrack(
      input,
      deps({ fileTags: fake("file-tags", { tags: [tag("file-tags", "Rock", 0.6)] }, calls), musicbrainz: fake("musicbrainz", { tags: [tag("musicbrainz", "Rock", 0.7)] }, calls) }, calls)
    );
    expect(calls).toEqual(["file-tags", "musicbrainz"]);
    expect(out.stoppedEarly).toBe(true);
    expect(out.usedLlm).toBe(false);
    expect(combineSourceTags(out.tags).best).toBeGreaterThanOrEqual(EARLY_STOP_CONFIDENCE);
    expect(out.sources.find((s) => s.source === "lastfm")).toMatchObject({ ran: false, note: "already confident" });
  });

  it("asks the LLM only when the sources disagree or nothing is sure", async () => {
    const calls: string[] = [];
    await classifyTrack(input, deps({ musicbrainz: fake("musicbrainz", { tags: [tag("musicbrainz", "Rock", 0.7)] }, calls) }, calls));
    expect(calls).not.toContain("llm");

    const conflictCalls: string[] = [];
    const conflict = await classifyTrack(
      input,
      deps({ fileTags: fake("file-tags", { tags: [tag("file-tags", "Pop", 0.6)] }, conflictCalls), lastfm: fake("lastfm", { tags: [tag("lastfm", "Rock", 0.7)] }, conflictCalls) }, conflictCalls)
    );
    expect(conflictCalls).toContain("llm");
    expect(conflict.usedLlm).toBe(true);

    const lowCalls: string[] = [];
    await classifyTrack(input, deps({ lastfm: fake("lastfm", { tags: [tag("lastfm", "Jazz", 0.4)] }, lowCalls) }, lowCalls));
    expect(lowCalls).toContain("llm");
  });

  it("shows the LLM what the other sources said", async () => {
    const seen: ProviderInput[] = [];
    const llm: GenreProvider = { id: "llm", async classify(i) { seen.push(i); return { tags: [], moods: [] }; } };
    await classifyTrack(input, deps({ fileTags: fake("file-tags", { tags: [tag("file-tags", "Pop", 0.6)], meta: { album: "A", year: 1999 } }), lastfm: fake("lastfm", { tags: [tag("lastfm", "Rock", 0.7)], moods: ["chill"] }), llm }));
    expect(seen[0].album).toBe("A");
    expect(seen[0].year).toBe(1999);
    expect(seen[0].evidence?.map((e) => e.source)).toEqual(["file-tags", "musicbrainz", "lastfm"]);
    expect(seen[0].evidence?.find((e) => e.source === "lastfm")?.moods).toEqual(["chill"]);
  });

  it("does not ask the LLM about a track a person has already confirmed", async () => {
    const calls: string[] = [];
    await classifyTrack(input, deps({}, calls), { confirmed: true });
    expect(calls).not.toContain("llm");
  });

  it("resolves a track whose sources conflict to needs-review", async () => {
    const out = await classifyTrack(input, deps({ fileTags: fake("file-tags", { tags: [tag("file-tags", "Pop", 0.6)] }), lastfm: fake("lastfm", { tags: [tag("lastfm", "Rock", 0.7)] }), llm: null }));
    expect(mergeRun(null, out, 1).status).toBe("needs-review");
  });

  it("fingerprints only a file with no usable tags, and gives MusicBrainz the recording it found", async () => {
    const resolve = vi.fn(async () => ({ recordingMbid: "mbid-1" }));
    const seen: (string | null | undefined)[] = [];
    const mb: GenreProvider = { id: "musicbrainz", async classify(i) { seen.push(i.recordingMbid); return { tags: [tag("musicbrainz", "Rock", 0.7)], moods: [] }; } };
    await classifyTrack(input, deps({ fingerprint: { resolve }, musicbrainz: mb }));
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["mbid-1"]);

    const withTags = vi.fn(async () => ({ recordingMbid: "x" }));
    await classifyTrack(input, deps({ fingerprint: { resolve: withTags }, fileTags: fake("file-tags", { tags: [tag("file-tags", "Rock", 0.6)] }) }));
    expect(withTags).not.toHaveBeenCalled();
  });

  it("carries on when one provider throws, and when the fingerprint lookup throws", async () => {
    const boom: GenreProvider = { id: "musicbrainz", async classify() { throw new Error("down"); } };
    const out = await classifyTrack(input, deps({ musicbrainz: boom, fingerprint: { resolve: async () => Promise.reject(new Error("x")) }, lastfm: fake("lastfm", { tags: [tag("lastfm", "Rock", 0.7)] }) }));
    expect(out.tags.map((t) => t.genre)).toEqual(["Rock"]);
    expect(out.sources.find((s) => s.source === "musicbrainz")?.note).toMatch(/failed: down/);
  });

  it("logs every step, with timing and why a step found nothing", async () => {
    let t = 0;
    const out = await classifyTrack(input, deps({ clock: () => (t += 5), lastfm: fake("lastfm", { note: "LASTFM_API_KEY is not set" }) }));
    expect(out.sources.map((s) => s.source)).toEqual(["file-tags", "fingerprint", "musicbrainz", "lastfm", "audio-classifier", "llm"].filter((s) => s !== "fingerprint"));
    expect(out.sources.find((s) => s.source === "lastfm")).toMatchObject({ ran: true, tags: 0, note: "LASTFM_API_KEY is not set" });
    expect(out.sources.find((s) => s.source === "audio-classifier")?.note).toBe("not available");
  });

  it("collects the moods the sources named, once each", async () => {
    const out = await classifyTrack(input, deps({ lastfm: fake("lastfm", { moods: ["chill", "sad"] }), llm: fake("llm", { moods: ["sad", "late-night"] }) }));
    expect(out.moods).toEqual(["chill", "sad", "late-night"]);
  });

  it("does not need the audio classifier: off, the other sources still classify the track", async () => {
    const out = await classifyTrack(input, deps({ audioClassifier: null, musicbrainz: fake("musicbrainz", { tags: [tag("musicbrainz", "Jazz", 0.7)] }), lastfm: fake("lastfm", { tags: [tag("lastfm", "Jazz", 0.7)] }) }));
    expect(resolveGenreTags(out.tags).genres[0].genre).toBe("Jazz");
  });
});

describe("the job runner", () => {
  const times = () => {
    let now = new Date("2026-11-17T12:00:00Z").getTime();
    return { now: () => new Date(now), advance: (ms: number) => (now += ms) };
  };
  const runnerDeps = (opts: { loadTrack?: JobRunnerDeps["loadTrack"]; pipeline?: PipelineDeps; owner?: (id: string) => string | undefined; clock?: () => Date } = {}) => {
    const jobs = memoryJobStore(opts.owner);
    const store = memoryGenreStore();
    const log = memoryLog();
    const d: JobRunnerDeps = {
      jobs,
      store,
      pipeline: opts.pipeline ?? deps({ musicbrainz: fake("musicbrainz", { tags: [tag("musicbrainz", "Rock", 0.8)] }), lastfm: fake("lastfm", { tags: [tag("lastfm", "Rock", 0.8)] }) }),
      loadTrack: opts.loadTrack ?? (async (trackId) => ({ ...input, trackId })),
      writeLog: log.write,
      now: opts.clock,
    };
    return { d, jobs, store, log };
  };

  it("classifies the queued tracks, stores the result and writes a log line for each", async () => {
    const { d, jobs, store, log } = runnerDeps();
    await jobs.enqueue(["a", "b"], 0);
    const r = await runJobs(d, { maxJobs: 10, budgetMs: 60_000 });
    expect(r).toMatchObject({ processed: 2, failed: 0, retrying: 0, more: false });
    expect(store.all().get("a")).toMatchObject({ status: "auto", genre: "Rock" });
    expect(log.entries.map((e) => e.trackId)).toEqual(["a", "b"]);
    expect(log.entries[0]).toMatchObject({ status: "auto", genre: "Rock", usedLlm: false });
    expect(log.entries[0].confidence).toBeGreaterThan(0.7);
    expect(jobs.jobs.every((j) => j.status === "done")).toBe(true);
  });

  it("runs the requests before the backfill, and does not queue a track twice", async () => {
    const { d, jobs } = runnerDeps();
    await jobs.enqueue(["backfill1", "backfill2"], 5);
    await jobs.enqueue(["asked"], 0);
    expect(await jobs.enqueue(["asked", "backfill1"], 0)).toBe(0);
    const order: string[] = [];
    d.loadTrack = async (trackId) => (order.push(trackId), { ...input, trackId });
    await runJobs(d, { maxJobs: 10, budgetMs: 60_000 });
    expect(order).toEqual(["asked", "backfill1", "backfill2"]);
  });

  it("retries a failed job after a growing wait, and gives it up after the last try", async () => {
    const clock = times();
    const { d, jobs } = runnerDeps({ clock: clock.now, loadTrack: async () => Promise.reject(new Error("storage down")) });
    await jobs.enqueue(["a"], 0);
    for (let attempt = 0; attempt < MAX_JOB_ATTEMPTS - 1; attempt++) {
      const r = await runJobs(d, { maxJobs: 5, budgetMs: 60_000 });
      expect(r.retrying).toBe(1);
      const nothingYet = await runJobs(d, { maxJobs: 5, budgetMs: 60_000 });
      expect(nothingYet.processed + nothingYet.retrying).toBe(0);
      clock.advance(backoffMs(attempt) + 1);
    }
    const last = await runJobs(d, { maxJobs: 5, budgetMs: 60_000 });
    expect(last).toMatchObject({ failed: 1, retrying: 0 });
    expect(jobs.jobs[0]).toMatchObject({ status: "failed", attempts: MAX_JOB_ATTEMPTS });
    expect(jobs.jobs[0].lastError).toBe("storage down");
    expect(await jobs.stateOf(["a"])).toEqual(new Map([["a", "failed"]]));
  });

  it("backs off 30 s, 60 s, 2 min... up to an hour", () => {
    expect(backoffMs(0)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(1)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffMs(2)).toBe(BACKOFF_BASE_MS * 4);
    expect(backoffMs(20)).toBe(60 * 60 * 1000);
  });

  it("does not let one failing track stop the others", async () => {
    const { d, jobs, store } = runnerDeps({ loadTrack: async (id) => (id === "bad" ? Promise.reject(new Error("corrupt")) : { ...input, trackId: id }) });
    await jobs.enqueue(["a", "bad", "c"], 0);
    const r = await runJobs(d, { maxJobs: 10, budgetMs: 60_000 });
    expect(r).toMatchObject({ processed: 2, retrying: 1 });
    expect([...store.all().keys()]).toEqual(["a", "c"]);
  });

  it("completes a job for a track that has been deleted", async () => {
    const { d, jobs } = runnerDeps({ loadTrack: async () => null });
    await jobs.enqueue(["gone"], 0);
    expect(await runJobs(d, { maxJobs: 5, budgetMs: 60_000 })).toMatchObject({ processed: 0, failed: 0, retrying: 0 });
    expect(jobs.jobs[0].status).toBe("done");
  });

  it("puts back, uncounted, the jobs it had no time for", async () => {
    const { d, jobs } = runnerDeps();
    await jobs.enqueue(["a", "b", "c"], 0);
    const r = await runJobs(d, { maxJobs: 5, budgetMs: -1 });
    expect(r.more).toBe(true);
    expect(jobs.jobs.map((j) => [j.status, j.attempts])).toEqual([["queued", 0], ["queued", 0], ["queued", 0]]);
  });

  it("says there is more when it hit its job limit", async () => {
    const { d, jobs } = runnerDeps();
    await jobs.enqueue(["a", "b", "c"], 0);
    expect((await runJobs(d, { maxJobs: 2, budgetMs: 60_000 })).more).toBe(true);
    expect((await runJobs(d, { maxJobs: 2, budgetMs: 60_000 })).more).toBe(false);
  });

  it("picks up a job that was running when its function was cut off", async () => {
    const clock = times();
    const { d, jobs } = runnerDeps({ clock: clock.now });
    await jobs.enqueue(["a"], 0);
    await jobs.claim(1, clock.now());
    expect((await runJobs(d, { maxJobs: 5, budgetMs: 60_000 })).processed).toBe(0);
    clock.advance(STALE_RUNNING_MS + 1000);
    expect((await runJobs(d, { maxJobs: 5, budgetMs: 60_000 })).processed).toBe(1);
  });

  it("works only on one user's tracks when asked to", async () => {
    const owner = (id: string) => (id.startsWith("mine") ? "me" : "you");
    const { d, jobs } = runnerDeps({ owner });
    await jobs.enqueue(["mine1", "yours1", "mine2"], 0);
    const r = await runJobs(d, { maxJobs: 10, budgetMs: 60_000, userId: "me" });
    expect(r.processed).toBe(2);
    expect(jobs.jobs.find((j) => j.trackId === "yours1")?.status).toBe("queued");
  });

  it("keeps a confirmed track confirmed through a run, without calling the LLM for it", async () => {
    const calls: string[] = [];
    const llm = fake("llm", { tags: [tag("llm", "Pop", 0.8)] }, calls);
    const { d, jobs, store } = runnerDeps({ pipeline: deps({ llm, lastfm: fake("lastfm", { tags: [tag("lastfm", "Rock", 0.4)] }) }) });
    await store.save("a", applyManualGenres(null, [{ genre: "Jazz" }], 1)!);
    await jobs.enqueue(["a"], 0);
    await runJobs(d, { maxJobs: 5, budgetMs: 60_000 });
    expect(calls).toEqual([]);
    expect(store.all().get("a")).toMatchObject({ status: "confirmed", genre: "Jazz" });
  });

  it("reports which tracks are queued, running or failed, and nothing for a finished one", async () => {
    const { d, jobs } = runnerDeps();
    await jobs.enqueue(["a", "b"], 0);
    expect(await jobs.stateOf(["a", "b", "c"])).toEqual(new Map([["a", "queued"], ["b", "queued"]]));
    await runJobs(d, { maxJobs: 5, budgetMs: 60_000 });
    expect((await jobs.stateOf(["a", "b"])).size).toBe(0);
  });
});

describe("year and content advisory", () => {
  it("takes them from the file's tags, and MusicBrainz's year only when the file has none", async () => {
    const a = await classifyTrack(input, deps({ fileTags: fake("file-tags", { meta: { year: 1994, explicit: "clean" } }), musicbrainz: fake("musicbrainz", { meta: { year: 1999 } }) }));
    expect(a).toMatchObject({ year: 1994, explicit: "clean" });
    const b = await classifyTrack(input, deps({ musicbrainz: fake("musicbrainz", { meta: { year: 1999 } }) }));
    expect(b).toMatchObject({ year: 1999, explicit: null });
  });
  it("keeps them through a re-run that finds nothing new, and through a person's edit", () => {
    const first = mergeRun(null, { tags: [tag("musicbrainz", "Rock", 0.7)], moods: [], year: 1994, explicit: "explicit" }, 1);
    expect(first).toMatchObject({ year: 1994, explicit: "explicit" });
    const second = mergeRun(first, { tags: [], moods: [], year: null, explicit: null }, 2);
    expect(second).toMatchObject({ year: 1994, explicit: "explicit" });
    expect(applyManualGenres(second, [{ genre: "Jazz" }], 3)).toMatchObject({ year: 1994, explicit: "explicit" });
    expect(clearManualGenres(applyManualGenres(second, [{ genre: "Jazz" }], 3)!, 4)).toMatchObject({ year: 1994, explicit: "explicit" });
  });
});
