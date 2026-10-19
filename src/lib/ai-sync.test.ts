import { describe, expect, it } from "vitest";
import { listenerNoteFor, overridesFromReview, parseSyncReview, reviewSyncPlanLocally, sanitizeSyncReviewInput } from "./ai-sync";
import { planSongSync, type SongSyncPlan } from "./songSync";
import { buildSyncReport } from "./syncEngine";
import type { TrackAnalysis } from "./audio-analysis";
import type { Track } from "@/types/music";

function makeTrack(id: string): Track {
  return { id, title: id, artist: "Test Artist", durationSec: 200, addedAt: 0, source: "local", sourceUrl: `blob:${id}` };
}

function makeAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    bpm: 128,
    bpmConfidence: 0.8,
    beatGridOffsetSec: 0,
    energyOnsetSec: 8,
    key: "A minor",
    keyConfidence: 0.6,
    camelotKey: "8A",
    breakdownAtSec: null,
    dropAtSec: null,
    buildDropPairs: [],
    waveformPeaks: [],
    fallback: false,
    ...overrides,
  };
}

function setup(a: Partial<TrackAnalysis>, b: Partial<TrackAnalysis>, overrides = {}) {
  const report = buildSyncReport({
    current: { track: makeTrack("Solar Drift"), analysis: makeAnalysis(a) },
    next: { track: makeTrack("Midnight Pulse"), analysis: makeAnalysis(b) },
  });
  const result = planSongSync(report, overrides);
  if (!result.ok) throw new Error("no plan");
  return { report, plan: result.plan as SongSyncPlan, currentTitle: "Solar Drift", nextTitle: "Midnight Pulse" };
}

describe("listenerNoteFor", () => {
  it("describes a speed-up and a key lift", () => {
    const { plan } = setup({ bpm: 128, camelotKey: "8A" }, { bpm: 131, camelotKey: "5A" });
    expect(listenerNoteFor(plan, "Solar Drift", "Midnight Pulse")).toBe(
      "Easing Solar Drift up 3 BPM and lifting the key 3 semitones — you'll feel it tighten as Midnight Pulse takes over."
    );
  });

  it("describes a slow-down with a key drop", () => {
    const { plan } = setup({ bpm: 132, camelotKey: "5A" }, { bpm: 128, camelotKey: "8A" });
    const note = listenerNoteFor(plan, "A", "B");
    expect(note).toContain("down 4 BPM");
    expect(note).toContain("lowering the key 3 semitones");
    expect(note).toContain("relax");
  });

  it("describes holding the tempo, and leaves the key out when it isn't shifted", () => {
    const { plan } = setup({ bpm: 128 }, { bpm: 128 });
    const note = listenerNoteFor(plan, "A", "B");
    expect(note).toBe("Holding A at its tempo — you'll feel it settle as B takes over.");
  });

  it("says one semitone in the singular", () => {
    const { plan } = setup({ bpm: 128, camelotKey: "8A" }, { bpm: 128, camelotKey: "8A" }, { pitchShiftSemitones: 1 });
    expect(listenerNoteFor(plan, "A", "B")).toContain("lifting the key 1 semitone ");
  });
});

describe("reviewSyncPlanLocally", () => {
  it("confirms a compatible pair as it is", () => {
    const input = setup({ bpm: 128, camelotKey: "8A" }, { bpm: 131, camelotKey: "9A" });
    const review = reviewSyncPlanLocally(input);
    expect(review.confirm).toBe(true);
    expect(review.override).toBeNull();
    expect(review.usedFallback).toBe(true);
    expect(review.listenerNote).toContain("Midnight Pulse");
  });

  it("extends a wide tempo gap with no octave reading to a long, 16-bar morph", () => {
    const input = setup({ bpm: 100 }, { bpm: 118 });
    // the plan already uses 16 bars for a gap over 12 BPM; force a short one to see the override
    const short = { ...input, plan: { ...input.plan, morphBars: 12 } };
    const review = reviewSyncPlanLocally(short);
    expect(review.confirm).toBe(false);
    expect(review.override).toEqual({ morphBars: 16 });
    expect(review.listenerNote).toContain("16 bars");
  });

  it("notes a long morph for a wide gap even when the plan already uses 16 bars (what the planner really produces)", () => {
    const input = setup({ bpm: 100 }, { bpm: 118 });
    expect(input.plan.morphBars).toBe(16);
    const review = reviewSyncPlanLocally(input);
    expect(review.override).toBeNull();
    expect(review.confirm).toBe(true);
    expect(review.listenerNote).toContain("16 bars");
  });

  it("does not stretch the morph for a half-time reading, however big the raw gap looks", () => {
    const input = setup({ bpm: 128 }, { bpm: 66 });
    const review = reviewSyncPlanLocally({ ...input, plan: { ...input.plan, morphBars: 4 } });
    expect(review.override).toBeNull();
  });

  it("flags a different track when the key move is past the limit", () => {
    const input = setup({ bpm: 128, camelotKey: "8A" }, { bpm: 128, camelotKey: "2A" });
    const wide = { ...input, report: { ...input.report, morphPitchShiftSemitones: 7 } };
    const review = reviewSyncPlanLocally(wide);
    expect(review.override?.recommendDifferentTrack).toBe(true);
    expect(review.confirm).toBe(false);
    expect(review.listenerNote).toContain("different next track");
  });

  it("flags a different track for the largest move the plan can make, a tritone (what the planner really produces)", () => {
    // 8A -> 2A is six wheel-steps' worth of semitones apart: the pitch move is the full 6
    const input = setup({ bpm: 128, camelotKey: "8A" }, { bpm: 128, camelotKey: "2A" });
    expect(Math.abs(input.plan.pitchTargetSemitones)).toBe(6);
    const review = reviewSyncPlanLocally(input);
    expect(review.override?.recommendDifferentTrack).toBe(true);
    expect(review.listenerNote).toContain("different next track");
  });

  it("does not flag a five-semitone move", () => {
    const input = setup({ bpm: 128, camelotKey: "8A" }, { bpm: 128, camelotKey: "7A" });
    const review = reviewSyncPlanLocally({ ...input, report: { ...input.report, keyCompatibility: "tension", morphPitchShiftSemitones: 5 } });
    expect(review.override?.recommendDifferentTrack).toBeUndefined();
  });

  it("keeps the note to one short paragraph", () => {
    const review = reviewSyncPlanLocally(setup({ bpm: 128 }, { bpm: 131 }));
    expect(review.listenerNote.length).toBeLessThanOrEqual(240);
  });
});

describe("overridesFromReview", () => {
  it("passes through only the numbers the plan can use", () => {
    expect(overridesFromReview({ override: { morphBars: 16, pitchShiftSemitones: 2, recommendDifferentTrack: true } })).toEqual({
      morphBars: 16,
      pitchShiftSemitones: 2,
    });
    expect(overridesFromReview({ override: null })).toEqual({});
    expect(overridesFromReview({ override: { recommendDifferentTrack: true } })).toEqual({});
  });
});

describe("parseSyncReview", () => {
  it("accepts a confirm with a note", () => {
    expect(parseSyncReview({ confirm: true, override: null, listenerNote: " Easing along. " })).toEqual({
      confirm: true,
      override: null,
      listenerNote: "Easing along.",
    });
  });

  it("treats a stated override as not-a-plain-confirm, and drops junk fields", () => {
    const r = parseSyncReview({
      confirm: true,
      override: { morphBars: 16, pitchShiftSemitones: "lots", recommendDifferentTrack: true, extra: 1 },
      listenerNote: "A long one.",
    });
    expect(r?.override).toEqual({ morphBars: 16, recommendDifferentTrack: true });
    expect(r?.confirm).toBe(false);
  });

  it("rejects a reply with no usable note", () => {
    expect(parseSyncReview({ confirm: true, override: null })).toBeNull();
    expect(parseSyncReview({ confirm: true, override: null, listenerNote: "   " })).toBeNull();
    expect(parseSyncReview(null)).toBeNull();
    expect(parseSyncReview("nope")).toBeNull();
  });

  it("clips a very long note", () => {
    const r = parseSyncReview({ confirm: true, override: null, listenerNote: "x".repeat(1000) });
    expect(r?.listenerNote.length).toBe(240);
  });
});

describe("sanitizeSyncReviewInput", () => {
  const good = () => {
    const { report, plan } = setup({ bpm: 128, camelotKey: "8A" }, { bpm: 131, camelotKey: "5A" });
    return { currentTitle: "A", nextTitle: "B", report, plan };
  };

  it("accepts a real request and keeps the plan and the report's flat fields", () => {
    const out = sanitizeSyncReviewInput(JSON.parse(JSON.stringify(good())));
    expect(out).not.toBeNull();
    expect(out?.plan.morphBars).toBe(good().plan.morphBars);
    expect((out?.report as unknown as Record<string, unknown>).keyCompatibility).toBe(good().report.keyCompatibility);
  });

  it("drops nested objects and arrays from the report", () => {
    const out = sanitizeSyncReviewInput(JSON.parse(JSON.stringify(good())));
    const report = out?.report as unknown as Record<string, unknown>;
    expect(report.stemPitchShifts).toBeUndefined();
    expect(report.stemSwapOrder).toBeUndefined();
  });

  it("caps long strings, the number of fields, and the titles", () => {
    const body = good() as unknown as Record<string, unknown>;
    const big: Record<string, unknown> = { note: "x".repeat(10_000) };
    for (let i = 0; i < 500; i++) big[`f${i}`] = i;
    const out = sanitizeSyncReviewInput({ ...body, currentTitle: "t".repeat(5000), report: big });
    const report = out?.report as unknown as Record<string, unknown>;
    expect((report.note as string).length).toBeLessThanOrEqual(60);
    expect(Object.keys(report).length).toBeLessThanOrEqual(40);
    expect(out?.currentTitle.length).toBe(200);
  });

  it("rejects a body that isn't a review request", () => {
    expect(sanitizeSyncReviewInput(null)).toBeNull();
    expect(sanitizeSyncReviewInput("hi")).toBeNull();
    expect(sanitizeSyncReviewInput({ ...good(), currentTitle: 3 })).toBeNull();
    expect(sanitizeSyncReviewInput({ ...good(), report: [] })).toBeNull();
    expect(sanitizeSyncReviewInput({ ...good(), plan: { ...good().plan, morphBars: "8" } })).toBeNull();
    expect(sanitizeSyncReviewInput({ ...good(), plan: { ...good().plan, direction: "sideways" } })).toBeNull();
  });
});
