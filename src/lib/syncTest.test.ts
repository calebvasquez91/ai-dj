import { describe, expect, it } from "vitest";
import type { SongSyncPhase, SongSyncPlan } from "./songSync";
import { songSyncStateAt } from "./songSync";
import {
  PHASE_LOCK_MAX_MS,
  describeDownbeatGrid,
  evaluateBpmMorph,
  evaluateCrossfade,
  evaluatePhaseLock,
  evaluatePitchMorph,
  evaluateReport,
  exportFileName,
  fixFor,
  foldedBpmGap,
  formatLog,
  gridInfo,
  pairStatus,
  pickHardestPair,
  planFromStatus,
  planFixes,
  skippedStages,
  summarize,
  type GridInfo,
  type PairResult,
  type PlaybackEvent,
  type ReportFacts,
  type StageResult,
  type SyncSample,
} from "./syncTest";

const plan = (over: Partial<SongSyncPlan> = {}): SongSyncPlan => ({
  morphBars: 4,
  bpmFrom: 120,
  bpmTo: 124,
  rateTarget: 124 / 120,
  direction: "faster",
  pitchTargetSemitones: 0,
  keyFrom: "A minor",
  keyTo: "A minor",
  bpmB: 124,
  ...over,
});

const report = (over: Partial<ReportFacts> = {}): ReportFacts => ({
  trackA_bpm: 120,
  trackB_bpm: 124,
  trackB_bpmMatched: 124,
  bpmDelta: 4,
  tempoConfident: true,
  morphPitchShiftSemitones: 0,
  ...over,
});

const goodGrid: GridInfo = { hasMap: true, downbeats: 100, downbeatConfidence: 0.8, tempoConfidence: 0.8, trustworthy: true };
const weakGrid: GridInfo = { hasMap: true, downbeats: 100, downbeatConfidence: 0.06, tempoConfidence: 0.34, trustworthy: false };

/** A clean run of the morph as the DJ board would show it: a sample per bar, then the phases after it. */
function cleanSamples(p: SongSyncPlan, lockMs = 3): SyncSample[] {
  const out: SyncSample[] = [];
  let t = 0;
  for (let bar = 0; bar < p.morphBars; bar++) {
    const st = songSyncStateAt(p, bar + 0.5);
    out.push({ tMs: (t += 2000), phase: "morphing", bar, bpmNow: st.bpm, pitchNow: st.pitchSemitones, phaseErrorMs: null });
  }
  const end = songSyncStateAt(p, p.morphBars);
  for (const phase of ["aligning", "locked", "crossfading", "done"] as SongSyncPhase[]) {
    out.push({
      tMs: (t += 2000),
      phase,
      bar: p.morphBars,
      bpmNow: end.bpm,
      pitchNow: end.pitchSemitones,
      phaseErrorMs: phase === "aligning" ? 40 : lockMs,
    });
  }
  return out;
}

describe("evaluateReport (stage A)", () => {
  const a = { bpm: 120, bpmConfidence: 0.8 };
  const b = { bpm: 124, bpmConfidence: 0.7 };

  it("passes a valid report with a plan", () => {
    const r = evaluateReport(report(), { ok: true, plan: plan() }, a, b);
    expect(r.stage.status).toBe("pass");
    expect(r.fix).toBeNull();
    expect(r.stage.detail).toContain("speed up 3.3%");
  });

  it("fails on a non-finite field", () => {
    const r = evaluateReport(report({ bpmDelta: Number.NaN }), { ok: true, plan: plan() }, a, b);
    expect(r.stage.status).toBe("fail");
    expect(r.stage.detail).toContain("BPM gap");
  });

  it("fails an implausible tempo and asks for a re-read", () => {
    const r = evaluateReport(report({ trackA_bpm: 30 }), { ok: true, plan: plan() }, a, b);
    expect(r.stage.status).toBe("fail");
    expect(r.fix).toBe("reanalyze");
  });

  it("fails a refusal for an untrusted tempo, quoting both confidences, and asks for a re-read", () => {
    const r = evaluateReport(report({ tempoConfident: false }), { ok: false, reason: "tempo-unknown" }, { bpm: 120, bpmConfidence: 0.04 }, b);
    expect(r.stage.status).toBe("fail");
    expect(r.stage.detail).toContain("0.04");
    expect(r.fix).toBe("reanalyze");
  });

  it("treats a tempo-gap refusal as by design: a warning for a normal pair, a pass for the hardest-jump pair", () => {
    const gap = report({ trackB_bpmMatched: 170 });
    expect(evaluateReport(gap, { ok: false, reason: "tempo-gap" }, a, b).stage.status).toBe("warn");
    const hardest = evaluateReport(gap, { ok: false, reason: "tempo-gap" }, a, b, "hardest");
    expect(hardest.stage.status).toBe("pass");
    expect(hardest.fix).toBeNull();
  });

  it("fails a plan whose bar count is out of range", () => {
    expect(evaluateReport(report(), { ok: true, plan: plan({ morphBars: 20 }) }, a, b).stage.status).toBe("fail");
  });
});

describe("planFromStatus", () => {
  const status = { morphBars: 8, bpmFrom: 120, bpmTo: 126, keyFrom: "A minor", keyTo: "C minor", pitchTarget: 3 };

  it("reads the plan back from what the player announced", () => {
    expect(planFromStatus(status)).toMatchObject({
      morphBars: 8,
      bpmFrom: 120,
      bpmTo: 126,
      rateTarget: 1.05,
      direction: "faster",
      pitchTargetSemitones: 3,
      keyFrom: "A minor",
      keyTo: "C minor",
    });
  });

  it("reads a slow-down and a hold", () => {
    expect(planFromStatus({ ...status, bpmTo: 114 }).direction).toBe("slower");
    const hold = planFromStatus({ ...status, bpmTo: 120, pitchTarget: 0 });
    expect(hold.direction).toBe("hold");
    expect(hold.rateTarget).toBe(1);
  });
});

describe("gridInfo and describeDownbeatGrid", () => {
  it("reads a missing map as untrustworthy", () => {
    expect(gridInfo(null)).toMatchObject({ hasMap: false, trustworthy: false });
    expect(gridInfo(undefined).downbeats).toBe(0);
  });

  it("flags weak grids in the diagnostic", () => {
    expect(describeDownbeatGrid(goodGrid, goodGrid).ok).toBe(true);
    const d = describeDownbeatGrid(weakGrid, goodGrid);
    expect(d.ok).toBe(false);
    expect(d.text).toContain("(weak)");
    expect(describeDownbeatGrid({ ...goodGrid, hasMap: false, trustworthy: false }, goodGrid).text).toContain("no song map");
  });
});

describe("evaluateBpmMorph (stage B)", () => {
  const p = plan();
  const grid = { a: goodGrid, b: goodGrid };

  it("passes a clean morph on a trusted grid", () => {
    expect(evaluateBpmMorph(cleanSamples(p), p, grid).status).toBe("pass");
  });

  it("warns, not fails, when the morph is right but the downbeat grid is weak", () => {
    const r = evaluateBpmMorph(cleanSamples(p), p, { a: weakGrid, b: goodGrid });
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("Bar 1 may not be the true downbeat");
  });

  it("passes a held tempo", () => {
    const hold = plan({ bpmTo: 120, rateTarget: 1, direction: "hold" });
    expect(evaluateBpmMorph(cleanSamples(hold), hold, grid).status).toBe("pass");
  });

  it("passes a slow-down", () => {
    const slow = plan({ bpmTo: 116, rateTarget: 116 / 120, direction: "slower" });
    expect(evaluateBpmMorph(cleanSamples(slow), slow, grid).status).toBe("pass");
  });

  it("fails when no bar was observed", () => {
    expect(evaluateBpmMorph([], p, grid).status).toBe("fail");
  });

  it("fails when the morph stops part-way", () => {
    const cut = cleanSamples(p).filter((s) => s.phase === "morphing").slice(0, 2);
    const r = evaluateBpmMorph(cut, p, grid);
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("stopped at bar");
  });

  it("fails a tempo that jumps off the planned line", () => {
    const s = cleanSamples(p);
    s[1] = { ...s[1], bpmNow: 130 };
    expect(evaluateBpmMorph(s, p, grid).status).toBe("fail");
  });

  it("fails a tempo that goes the wrong way while staying inside the planned band", () => {
    const wrong = plan({ bpmFrom: 120, bpmTo: 130, rateTarget: 130 / 120, morphBars: 8 });
    // Bar 4 reads 124.0 BPM: inside the band around the plan (123.75 to 126.3) but below bar 3's 124.4, while speeding up.
    const bad = cleanSamples(wrong).map((x, i) => (x.phase === "morphing" && i === 4 ? { ...x, bpmNow: x.bpmNow - 1.6 } : x));
    const r = evaluateBpmMorph(bad, wrong, grid);
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("wrong way");
  });

  it("fails a tempo that arrives off the target", () => {
    const s = cleanSamples(p).map((x) => (x.phase === "done" ? { ...x, bpmNow: 119 } : x));
    const r = evaluateBpmMorph(s, p, grid);
    expect(r.status).toBe("fail");
  });
});

describe("evaluatePitchMorph (stage C)", () => {
  it("skips when no pitch move was planned", () => {
    expect(evaluatePitchMorph(cleanSamples(plan()), plan()).status).toBe("skip");
  });

  it("passes a pitch that walks to its target", () => {
    const p = plan({ pitchTargetSemitones: 3, morphBars: 8, bpmTo: 120, rateTarget: 1, direction: "hold" });
    expect(evaluatePitchMorph(cleanSamples(p), p).status).toBe("pass");
  });

  it("passes a downward shift", () => {
    const p = plan({ pitchTargetSemitones: -2, morphBars: 4 });
    expect(evaluatePitchMorph(cleanSamples(p), p).status).toBe("pass");
  });

  it("fails a pitch that stops short", () => {
    const p = plan({ pitchTargetSemitones: 3, morphBars: 4 });
    const s = cleanSamples(p).map((x) => (ARRIVED(x) ? { ...x, pitchNow: 1.5 } : x));
    expect(evaluatePitchMorph(s, p).status).toBe("fail");
  });

  it("fails when the morph never finished", () => {
    const p = plan({ pitchTargetSemitones: 3 });
    expect(evaluatePitchMorph(cleanSamples(p).filter((s) => s.phase === "morphing"), p).status).toBe("fail");
  });

  it("fails a pitch that moves the wrong way", () => {
    const p = plan({ pitchTargetSemitones: 3, morphBars: 4 });
    const s = cleanSamples(p);
    s[2] = { ...s[2], pitchNow: 0.1 };
    expect(evaluatePitchMorph(s, p).status).toBe("fail");
  });
});

function ARRIVED(s: SyncSample): boolean {
  return s.phase !== "morphing";
}

describe("evaluatePhaseLock (stage D)", () => {
  it("passes a lock inside the limit", () => {
    const r = evaluatePhaseLock(cleanSamples(plan(), 3));
    expect(r.status).toBe("pass");
    expect(r.value).toBe(3);
  });

  it("uses the absolute error, so -9 ms passes and -12 ms fails", () => {
    expect(evaluatePhaseLock(cleanSamples(plan(), -9)).status).toBe("pass");
    const r = evaluatePhaseLock(cleanSamples(plan(), -12));
    expect(r.status).toBe("fail");
    expect(r.value).toBe(12);
    expect(r.detail).toContain(`limit ${PHASE_LOCK_MAX_MS}`);
  });

  it("warns when it settled inside the limit but strayed outside it while locked", () => {
    const s = cleanSamples(plan(), 4);
    const i = s.findIndex((x) => x.phase === "locked");
    s[i] = { ...s[i], phaseErrorMs: 25 };
    expect(evaluatePhaseLock(s).status).toBe("warn");
  });

  it("fails when the phase was never measured", () => {
    const s = cleanSamples(plan()).map((x) => ({ ...x, phaseErrorMs: null }));
    expect(evaluatePhaseLock(s).status).toBe("fail");
  });
});

describe("evaluateCrossfade (stage E)", () => {
  const samples = cleanSamples(plan());
  const ev = (type: PlaybackEvent["type"], phase: SongSyncPhase | null): PlaybackEvent => ({ tMs: 1, type, phase });

  it("passes with no events and a hand-over", () => {
    expect(evaluateCrossfade([], samples, true).status).toBe("pass");
  });

  it("ignores buffering and seeks during the silent pre-roll but says so", () => {
    const r = evaluateCrossfade([ev("waiting", "morphing"), ev("seeking", "aligning")], samples, true);
    expect(r.status).toBe("pass");
    expect(r.detail).toContain("2 buffering/seek events earlier");
  });

  it("fails on a stall while locked or crossfading", () => {
    expect(evaluateCrossfade([ev("waiting", "crossfading")], samples, true).status).toBe("fail");
    const r = evaluateCrossfade([ev("seeking", "locked"), ev("stalled", "locked")], samples, true);
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("seeking, stalled");
  });

  it("fails when the next track never took over", () => {
    expect(evaluateCrossfade([], samples, false).status).toBe("fail");
  });

  it("fails when the crossfade never started", () => {
    expect(evaluateCrossfade([], samples.filter((s) => s.phase === "morphing"), true).status).toBe("fail");
  });
});

describe("pair status and summary", () => {
  const st = (id: StageResult["id"], status: StageResult["status"], value?: number): StageResult => ({ id, label: id, status, detail: "", value });
  const pair = (over: Partial<PairResult>): PairResult => ({
    index: 0,
    kind: "consecutive",
    fromId: "a",
    toId: "b",
    fromTitle: "A",
    toTitle: "B",
    bpmFrom: 120,
    bpmTo: 121,
    outcome: "morphed",
    stages: [st("A", "pass"), st("B", "pass"), st("C", "skip"), st("D", "pass", 3), st("E", "pass")],
    status: "pass",
    fix: null,
    durationSec: 40,
    notes: [],
    ...over,
  });

  it("ranks fail over warn over pass, ignoring skips", () => {
    expect(pairStatus([st("A", "pass"), st("C", "skip")])).toBe("pass");
    expect(pairStatus([st("A", "pass"), st("B", "warn")])).toBe("warn");
    expect(pairStatus([st("A", "warn"), st("D", "fail")])).toBe("fail");
  });

  it("tallies stages, outcomes, the worst lock and fixable failures", () => {
    const pairs = [
      pair({ index: 0 }),
      pair({ index: 1, status: "fail", fix: "reanalyze", outcome: "refused", stages: [st("A", "fail"), ...skippedStages("B", "x")] }),
      pair({ index: 2, status: "warn", stages: [st("A", "pass"), st("B", "warn"), st("C", "skip"), st("D", "fail", 12), st("E", "pass")] }),
    ];
    const s = summarize(pairs);
    expect(s).toMatchObject({ total: 3, passed: 1, warned: 1, failed: 1, morphed: 2, refused: 1, fixable: 1, verdict: "fail", worstLockMs: 12 });
    expect(s.perStage.A).toEqual({ pass: 2, warn: 0, fail: 1, skip: 0 });
    expect(s.perStage.B.skip).toBe(1);
  });

  it("rounds the worst lock to a tenth of a millisecond", () => {
    const rounded = summarize([pair({ stages: [st("D", "pass", 8.271137243674787)] })]);
    expect(rounded.worstLockMs).toBe(8.3);
  });

  it("is a pass only when every pair is", () => {
    expect(summarize([pair({})]).verdict).toBe("pass");
    expect(summarize([pair({ status: "warn" })]).verdict).toBe("warn");
    expect(summarize([]).worstLockMs).toBeNull();
  });

  it("skippedStages gives B to E, or just the later ones", () => {
    expect(skippedStages("B", "why").map((s) => s.id)).toEqual(["B", "C", "D", "E"]);
    expect(skippedStages("D", "why").map((s) => s.id)).toEqual(["D", "E"]);
  });
});

describe("hardest tempo jump", () => {
  const e = (id: string, bpm: number, bpmConfidence = 0.8) => ({ id, bpm, bpmConfidence });

  it("folds octaves before measuring the gap", () => {
    expect(foldedBpmGap(120, 60)).toBe(0); // the same tempo at half speed
    expect(foldedBpmGap(120, 124)).toBeCloseTo(4);
    expect(foldedBpmGap(132, 60)).toBeCloseTo(12); // 60 is 120 at half speed, so 12 BPM from 132
    expect(foldedBpmGap(0, 120)).toBe(0);
  });

  it("picks the biggest folded gap among pairs not yet tested", () => {
    const entries = [e("a", 120), e("b", 121), e("c", 132)];
    const tested = new Set(["a>c", "c>a"]);
    const hardest = pickHardestPair(entries, tested);
    expect(hardest).not.toBeNull();
    expect([hardest!.from.id, hardest!.to.id].sort()).toEqual(["b", "c"]); // 121 vs 132 is 11, 120 vs 132 is excluded
    expect(hardest!.gapBpm).toBeCloseTo(11);
  });

  it("ignores tracks whose tempo is not trusted", () => {
    const hardest = pickHardestPair([e("a", 120), e("b", 125), e("c", 150, 0.1)], new Set());
    expect([hardest!.from.id, hardest!.to.id].sort()).toEqual(["a", "b"]);
  });

  it("is null when nothing qualifies", () => {
    expect(pickHardestPair([e("a", 120)], new Set())).toBeNull();
    expect(pickHardestPair([e("a", 120), e("b", 125)], new Set(["a>b", "b>a"]))).toBeNull();
  });

  it("breaks ties toward the earlier pair", () => {
    const hardest = pickHardestPair([e("a", 120), e("b", 125), e("c", 120)], new Set());
    expect(hardest!.from.id).toBe("a");
    expect(hardest!.to.id).toBe("b");
  });
});

describe("fixes", () => {
  const failed = (index: number, fix: PairResult["fix"], over: Partial<PairResult> = {}): PairResult => ({
    index,
    kind: "consecutive",
    fromId: `f${index}`,
    toId: `t${index}`,
    fromTitle: `F${index}`,
    toTitle: `T${index}`,
    bpmFrom: 120,
    bpmTo: 120,
    outcome: "morphed",
    stages: [{ id: "D", label: "D", status: "fail", detail: "locked at 14 ms" }],
    status: "fail",
    fix,
    durationSec: 1,
    notes: [],
    ...over,
  });

  it("re-reads tracks for tempo failures, retries stalls, and lists the rest as manual", () => {
    const plan = planFixes([
      failed(0, "reanalyze"),
      failed(1, "retry"),
      failed(2, null),
      { ...failed(3, null), status: "pass" },
    ]);
    expect(plan.reanalyze.sort()).toEqual(["f0", "t0"]);
    expect(plan.rerun).toEqual([0, 1]);
    expect(plan.manual).toHaveLength(1);
    expect(plan.manual[0]).toContain("F2 to T2");
    expect(plan.manual[0]).toContain("No automatic fix");
  });

  it("does not re-read the same track twice", () => {
    const a = { ...failed(0, "reanalyze"), fromId: "x", toId: "y" };
    const b = { ...failed(1, "reanalyze"), fromId: "y", toId: "z" };
    expect(planFixes([a, b]).reanalyze.sort()).toEqual(["x", "y", "z"]);
  });

  it("chooses a fix from where the pair failed", () => {
    const e: StageResult = { id: "E", label: "E", status: "fail", detail: "" };
    const d: StageResult = { id: "D", label: "D", status: "fail", detail: "" };
    expect(fixFor("refused", [], "reanalyze")).toBe("reanalyze");
    expect(fixFor("timeout", [], null)).toBe("retry");
    expect(fixFor("error", [], null)).toBe("retry");
    expect(fixFor("morphed", [e], null)).toBe("retry");
    expect(fixFor("morphed", [d], null)).toBeNull();
  });
});

describe("log", () => {
  it("names the file with a sortable timestamp", () => {
    expect(exportFileName(new Date(2026, 9, 19, 17, 5, 9))).toBe("djclaude_sync_test_20261019_170509.txt");
  });

  it("writes the summary, each pair with its stages and the fixes", () => {
    const stages: StageResult[] = [
      { id: "A", label: "SyncReport valid", status: "pass", detail: "ok" },
      { id: "D", label: "Phase lock", status: "fail", detail: "locked at 12 ms", value: 12 },
    ];
    const text = formatLog({
      startedAt: Date.UTC(2026, 9, 19, 17, 0, 0),
      finishedAt: Date.UTC(2026, 9, 19, 17, 6, 0),
      playlistName: "Same Beat",
      userAgent: "test-agent",
      fixLog: ["Re-read tempo of Move Ya Body: 120.0/0.04 to 120.9/0.69"],
      pairs: [
        {
          index: 0,
          kind: "hardest",
          fromId: "a",
          toId: "b",
          fromTitle: "One",
          toTitle: "Two",
          bpmFrom: 120,
          bpmTo: 131,
          outcome: "morphed",
          stages,
          status: "fail",
          fix: null,
          durationSec: 41.2,
          notes: ["hello"],
          before: { status: "fail", outcome: "refused", stages },
        },
      ],
    });
    expect(text).toContain("SUMMARY: FAIL. 0/1 pairs passed");
    expect(text).toContain("PAIR 1 (hardest tempo jump): One -> Two");
    expect(text).toContain("[FAIL] D Phase lock: locked at 12 ms");
    expect(text).toContain("120.0 -> 131.0 BPM");
    expect(text).toContain("before the automatic fix: FAIL (refused)");
    expect(text).toContain("AUTOMATIC FIXES");
    expect(text).toContain("Worst phase lock: 12 ms");
    expect(text).toContain("(360 s)");
  });
});
