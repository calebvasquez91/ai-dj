import { describe, expect, it, vi } from "vitest";
import type { TrackAnalysis } from "./audio-analysis-core";
import { fallbackAnalysis } from "./audio-analysis-core";
import { applyVetoes, buildMixabilityReport, energyAround, engineerVetoes, type MixabilityReport } from "./mixability";
import { CLEAR_MARGIN, decideTransition, leadsClearly, parsePickAnswer, sanitizePickRequest, type PickRequest } from "./transitionChoice";
import { rankTransitions, type PlannerSyncReport, type PlannerTrack, type RankedPlan } from "./transitionPlanner";
import type { TransitionTool } from "./genreTransitions";

const tagged = (genre: string): PlannerTrack => ({ genreTags: [{ genre, source: "file-tags", confidence: 0.9, updatedAt: 0 }] });
const TOOLS = new Set<TransitionTool>(["scratch", "eq", "echo", "instrumentalBridge"]);
const sync: PlannerSyncReport = { bpmDelta: 1, trackA_bpm: 124, tempoConfident: true, keyCompatibility: "perfect", keyConfident: true, bpmStrategy: "exact" };

const analysis = (over: Partial<TrackAnalysis> = {}): TrackAnalysis => ({ ...fallbackAnalysis(), fallback: false, bpm: 124, bpmConfidence: 0.9, key: "A minor", keyConfidence: 0.8, waveformPeaks: Array.from({ length: 100 }, () => 0.5), ...over });
const report = (over: Partial<MixabilityReport> = {}): MixabilityReport => ({
  ...buildMixabilityReport({ a: analysis(), b: analysis(), durationA: 200, durationB: 200, mixOutSec: 180, mixInSec: 10 }),
  ...over,
});

describe("the Audio Engineer's report", () => {
  it("reads confidence, key and energy at the mix points from the analysis", () => {
    const peaks = Array.from({ length: 100 }, (_, i) => (i < 50 ? 0.2 : 0.8));
    const r = buildMixabilityReport({ a: analysis({ waveformPeaks: peaks }), b: analysis({ waveformPeaks: peaks }), durationA: 100, durationB: 100, mixOutSec: 90, mixInSec: 10 });
    expect(r.beatConfidenceA).toBe(0.9);
    expect(r.keyConfidenceB).toBe(0.8);
    expect(r.energyAtMixOut).toBeCloseTo(0.8, 1);
    expect(r.energyAtMixIn).toBeCloseTo(0.2, 1);
    expect(r.mixability).toBeGreaterThan(0.5);
    expect(r.constraints).toEqual([]);
  });

  it("has no energy without a waveform, and unknown vocals stay null", () => {
    expect(energyAround({ waveformPeaks: [] }, 100, 50)).toBeNull();
    const r = buildMixabilityReport({ a: analysis(), b: analysis(), durationA: 200, durationB: 200, mixOutSec: 180, mixInSec: 10 });
    expect(r.vocalDensityAtMixOut).toBeNull();
    expect(r.instrumentalnessA).toBeNull();
  });

  it("lists what limits the pair in plain words and lowers the score", () => {
    const r = buildMixabilityReport({ a: analysis({ bpmConfidence: 0.2, keyConfidence: 0.1 }), b: analysis(), durationA: 200, durationB: 200, mixOutSec: 180, mixInSec: 10 });
    expect(r.constraints).toContain("the tempo is not certain");
    expect(r.constraints).toContain("the key is not certain");
    expect(r.mixability).toBeLessThan(0.6);
  });
});

describe("the Engineer's vetoes", () => {
  const ranked = (a: string, b: string) => rankTransitions(tagged(a), tagged(b), sync, undefined, { enabledTools: TOOLS });

  it("removes every beat-synced plan when beat confidence is low, and keeps the ones that need no grid", () => {
    const low = report({ beatConfidenceA: 0.3 });
    const { allowed, vetoed } = applyVetoes(ranked("Electronic", "Electronic"), low);
    expect(allowed.map((p) => p.style)).not.toContain("long-blend");
    expect(allowed.length).toBeGreaterThan(0);
    expect(vetoed.map((v) => v.plan.style)).toContain("long-blend");
    expect(vetoed.every((v) => v.reason === "beat confidence is below 0.5")).toBe(true);
  });

  it("removes beat-synced plans when the tempo is unsteady", () => {
    expect(engineerVetoes(report({ tempoStabilityB: 0.1 })).get("medium-blend")).toBe("the tempo is not stable");
  });

  it("removes a long blend when both ends have heavy vocals, but not a quick cut", () => {
    const v = engineerVetoes(report({ vocalDensityAtMixOut: 0.8, vocalDensityAtMixIn: 0.7 }));
    expect(v.get("long-blend")).toBe("both ends have heavy vocals");
    expect(v.has("quick-cut")).toBe(false);
    // only one heavy end: no veto
    expect(engineerVetoes(report({ vocalDensityAtMixOut: 0.8, vocalDensityAtMixIn: 0.1 })).has("long-blend")).toBe(false);
  });

  it("removes key-dependent blends when key confidence is low", () => {
    const v = engineerVetoes(report({ keyConfidenceA: 0.2 }));
    expect(v.get("long-blend")).toBe("the key is not certain");
    expect(v.has("quick-cut")).toBe(false);
    expect(v.has("fade")).toBe(false);
  });

  it("never vetoes what it cannot see: unknown vocals and a good analysis veto nothing", () => {
    expect([...engineerVetoes(report()).keys()]).toEqual([]);
  });

  it("always leaves something: a fade, cut or echo is never vetoed", () => {
    const worst = report({ beatConfidenceA: 0, tempoStabilityA: 0, keyConfidenceA: 0, vocalDensityAtMixOut: 1, vocalDensityAtMixIn: 1 });
    const { allowed } = applyVetoes(ranked("Electronic", "Pop"), worst);
    expect(allowed.length).toBeGreaterThan(0);
  });
});

describe("the DJ's choice", () => {
  const plan = (style: RankedPlan["style"], score: number): RankedPlan => ({ style, bars: 4, tools: [], keepSync: false, reason: `${style} because`, confidence: 0.7, genrePair: { a: "Pop", b: "Rock" }, score });

  it("decides locally when the top plan leads clearly, and never calls Claude", async () => {
    const ask = vi.fn();
    const d = await decideTransition({ ranked: [plan("quick-cut", 2), plan("fade", 1)], mixability: report(), ask });
    expect(d.decidedBy).toBe("local");
    expect(d.plan.style).toBe("quick-cut");
    expect(d.plan.fallbackPlan?.style).toBe("fade");
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks Claude only when the top two are within the margin, and uses its pick and reason", async () => {
    const ask = vi.fn(async () => ({ style: "echo-out", reason: "The vocal ends clean, so let it ring out." }));
    const d = await decideTransition({ ranked: [plan("quick-cut", 1), plan("echo-out", 0.95)], mixability: report(), ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(d.decidedBy).toBe("claude");
    expect(d.plan.style).toBe("echo-out");
    expect(d.reason).toBe("The vocal ends clean, so let it ring out.");
    expect(d.plan.fallbackPlan?.style).toBe("quick-cut");
  });

  it("sends Claude only the Engineer's report and the two candidates", async () => {
    let seen: PickRequest | null = null;
    await decideTransition({ ranked: [plan("quick-cut", 1), plan("echo-out", 0.95), plan("fade", 0.9)], mixability: report(), ask: async (req) => { seen = req; return null; } });
    expect(seen!.candidates.map((c) => c.style)).toEqual(["quick-cut", "echo-out"]);
    expect(seen!.genrePair).toEqual({ a: "Pop", b: "Rock" });
  });

  it("falls back to the local winner when Claude is slow (2 s timeout), throws, or answers with a style it was not offered", async () => {
    const close = [plan("quick-cut", 1), plan("echo-out", 0.95)];
    const slow = await decideTransition({ ranked: close, mixability: report(), ask: () => new Promise(() => {}), timeoutMs: 20 });
    expect(slow.decidedBy).toBe("local-fallback");
    expect(slow.plan.style).toBe("quick-cut");
    const boom = await decideTransition({ ranked: close, mixability: report(), ask: async () => { throw new Error("down"); } });
    expect(boom.decidedBy).toBe("local-fallback");
    const wrong = await decideTransition({ ranked: close, mixability: report(), ask: async () => ({ style: "long-blend", reason: "nope" }) });
    expect(wrong.decidedBy).toBe("local-fallback");
    expect(wrong.plan.style).toBe("quick-cut");
  });

  it("chooses among the plans the Engineer did not veto, and reports the vetoes", async () => {
    const ranked = [plan("long-blend", 2), plan("quick-cut", 1)];
    const d = await decideTransition({ ranked, mixability: report({ beatConfidenceA: 0.1 }) });
    expect(d.plan.style).toBe("quick-cut");
    expect(d.vetoes).toEqual([{ style: "long-blend", reason: "beat confidence is below 0.5" }]);
  });

  it("with no ask function at all, a close call is the local winner", async () => {
    const d = await decideTransition({ ranked: [plan("quick-cut", 1), plan("echo-out", 0.95)], mixability: report() });
    expect(d.decidedBy).toBe("local-fallback");
    expect(d.plan.style).toBe("quick-cut");
  });

  it("measures a clear lead against the top score", () => {
    expect(leadsClearly({ score: 1 }, { score: 1 - CLEAR_MARGIN - 0.01 })).toBe(true);
    expect(leadsClearly({ score: 1 }, { score: 1 - CLEAR_MARGIN + 0.01 })).toBe(false);
    expect(leadsClearly({ score: 1 }, undefined)).toBe(true);
  });
});

describe("Claude's answer and the request", () => {
  it("accepts only an offered style with a reason", () => {
    expect(parsePickAnswer({ style: "fade", reason: " Soft landing. " }, ["fade", "quick-cut"])).toEqual({ style: "fade", reason: "Soft landing." });
    expect(parsePickAnswer({ style: "long-blend", reason: "x" }, ["fade", "quick-cut"])).toBeNull();
    expect(parsePickAnswer({ style: "fade", reason: "  " }, ["fade"])).toBeNull();
    expect(parsePickAnswer(null, ["fade"])).toBeNull();
  });

  it("sanitizes the request the browser sends, capping strings", () => {
    const cand = { style: "quick-cut", bars: 1, tools: ["echo"], keepSync: false, why: "x".repeat(500) };
    const ok = sanitizePickRequest({ genrePair: { a: "Pop", b: "Rock" }, mixability: { mixability: 0.7 }, candidates: [cand, { ...cand, style: "fade" }] });
    expect(ok?.candidates[0].why).toHaveLength(120);
    expect(sanitizePickRequest({ genrePair: { a: "Pop" }, mixability: {}, candidates: [cand, cand] })).toBeNull();
    expect(sanitizePickRequest({ genrePair: { a: "Pop", b: "Rock" }, mixability: {}, candidates: [cand] })).toBeNull();
    expect(sanitizePickRequest("nope")).toBeNull();
  });
});
