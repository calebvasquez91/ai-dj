import { describe, expect, it } from "vitest";
import { GENRE_TRANSITIONS, type TransitionStyle, type TransitionTool } from "./genreTransitions";
import { describeGenrePlan, rankTransitions, resolveTransition, type PlannerSyncReport, type PlannerTrack } from "./transitionPlanner";

const tagged = (genre: string): PlannerTrack => ({ genreTags: [{ genre, source: "file-tags", confidence: 0.9, updatedAt: 0 }] });
const ALL_TOOLS = new Set<TransitionTool>(["scratch", "stutter", "roll", "eq", "echo", "instrumentalBridge"]);
const NO_TOOLS = new Set<TransitionTool>();
const GRID: readonly TransitionStyle[] = ["long-blend", "medium-blend", "short-blend", "bass-swap", "filter-sweep"];

/** A clean pair: close tempo, compatible keys. */
const report = (over: Partial<PlannerSyncReport> = {}): PlannerSyncReport => ({ bpmDelta: 1, trackA_bpm: 124, tempoConfident: true, keyCompatibility: "perfect", keyConfident: true, bpmStrategy: "exact", ...over });

describe("resolveTransition: which style a pair of genres gets", () => {
  it("House to House (Electronic) is a long blend that keeps the beat sync", () => {
    const plan = resolveTransition(tagged("Electronic"), tagged("Electronic"), report(), undefined, { enabledTools: ALL_TOOLS });
    expect(plan.style).toBe("long-blend");
    expect(plan.keepSync).toBe(true);
    expect(plan.bars).toBeGreaterThanOrEqual(16);
    expect(plan.bars).toBeLessThanOrEqual(32);
  });

  it("Hip-Hop to Rock picks a quick cut or an echo-out, never a long blend", () => {
    const plan = resolveTransition(tagged("Hip-Hop"), tagged("Rock"), report({ trackA_bpm: 92, bpmDelta: 3 }), undefined, { enabledTools: ALL_TOOLS });
    expect(["quick-cut", "echo-out"]).toContain(plan.style);
    expect(plan.keepSync).toBe(false);
  });

  it("Jazz to anything never uses a beat-synced blend, in any ranked option", () => {
    for (const other of ["Electronic", "Hip-Hop", "Pop", "Rock", "Latin", "Jazz", "R&B"]) {
      for (const [a, b] of [["Jazz", other], [other, "Jazz"]] as const) {
        const ranked = rankTransitions(tagged(a), tagged(b), report(), undefined, { enabledTools: ALL_TOOLS });
        for (const p of ranked) {
          expect(GRID, `${a} -> ${b}: ${p.style}`).not.toContain(p.style);
          expect(p.keepSync, `${a} -> ${b}`).toBe(false);
        }
        expect(["fade", "echo-out", "silence-then-start"]).toContain(ranked[0].style);
      }
    }
  });

  it("uses the same genre's preferred style when both songs are that genre", () => {
    const plan = resolveTransition(tagged("R&B"), tagged("R&B"), report({ trackA_bpm: 90, bpmDelta: 2 }), undefined, { enabledTools: ALL_TOOLS });
    expect(plan.style).toBe(GENRE_TRANSITIONS["R&B"].preferredStyles[0]);
    expect(plan.reason).toContain("R&B");
  });

  it("with nothing in common, takes the less beat-reliable genre's choice rather than a long blend", () => {
    const plan = resolveTransition(tagged("Electronic"), tagged("Country"), report(), undefined, { enabledTools: ALL_TOOLS });
    expect(["quick-cut", "short-blend", "echo-out", "fade"]).toContain(plan.style);
    expect(plan.style).not.toBe("long-blend");
  });

  it("a track with no genre gets a safe, short plan", () => {
    const plan = resolveTransition({}, {}, report(), undefined, { enabledTools: NO_TOOLS });
    expect(plan.genrePair).toEqual({ a: "Unknown", b: "Unknown" });
    expect(["short-blend", "quick-cut", "fade"]).toContain(plan.style);
  });

  it("reads a secondary genre that reaches 0.5, and ignores one below it", () => {
    const track = (secondary: number): PlannerTrack => ({ genreTags: [{ genre: "Pop", source: "file-tags", confidence: 0.9, updatedAt: 0 }, { genre: "Electronic", source: "file-tags", confidence: secondary, updatedAt: 0 }] });
    const strong = rankTransitions(track(0.9), tagged("Electronic"), report(), undefined, { enabledTools: ALL_TOOLS });
    const weak = rankTransitions(track(0.2), tagged("Electronic"), report(), undefined, { enabledTools: ALL_TOOLS });
    expect(strong.map((p) => p.style)).toContain("long-blend");
    expect(weak[0].genrePair.a).toBe("Pop");
  });
});

describe("resolveTransition: tempo and key gaps", () => {
  it("bridges a pair too far apart for both genres with an instrumental bridge when that tool is on", () => {
    const plan = resolveTransition(tagged("Pop"), tagged("Pop"), report({ trackA_bpm: 100, bpmDelta: 14 }), undefined, { enabledTools: ALL_TOOLS });
    expect(plan.style).toBe("instrumental-bridge");
    expect(plan.reason).toBe("tempo gap of 14 BPM");
    expect(plan.keepSync).toBe(false);
  });

  it("uses a scratch bridge when only scratch is on, and a quick cut when no bridge tool is", () => {
    const gap = report({ trackA_bpm: 100, bpmDelta: 14 });
    expect(resolveTransition(tagged("Pop"), tagged("Pop"), gap, undefined, { enabledTools: new Set<TransitionTool>(["scratch"]) }).style).toBe("scratch-bridge");
    expect(resolveTransition(tagged("Pop"), tagged("Pop"), gap, undefined, { enabledTools: NO_TOOLS }).style).toBe("quick-cut");
  });

  it("does not bridge when only one genre is bothered by the gap (the other tolerates it)", () => {
    // Hip-Hop tolerates 8%: 7 BPM on 92 is 7.6%, inside Hip-Hop's tolerance and outside Rock's 3%.
    const plan = resolveTransition(tagged("Hip-Hop"), tagged("Rock"), report({ trackA_bpm: 92, bpmDelta: 7 }), undefined, { enabledTools: ALL_TOOLS });
    expect(plan.reason).not.toContain("tempo gap");
  });

  it("bridges a key clash when both genres care about key", () => {
    const plan = resolveTransition(tagged("Afrobeats"), tagged("Electronic"), report({ keyCompatibility: "clash" }), undefined, { enabledTools: ALL_TOOLS });
    expect(plan.reason).toBe("the keys clash");
    expect(["instrumental-bridge", "scratch-bridge", "quick-cut"]).toContain(plan.style);
  });

  it("ignores an unconfident tempo or key reading", () => {
    const plan = resolveTransition(tagged("Pop"), tagged("Pop"), report({ trackA_bpm: 100, bpmDelta: 30, tempoConfident: false, keyCompatibility: "clash", keyConfident: false }), undefined, { enabledTools: ALL_TOOLS });
    expect(plan.reason).not.toMatch(/gap|clash/);
    expect(plan.keepSync).toBe(false);
  });
});

describe("resolveTransition: tool flags", () => {
  it("never puts a tool whose flag is off in a plan, whatever the genres allow", () => {
    for (const a of Object.keys(GENRE_TRANSITIONS)) {
      for (const b of ["Hip-Hop", "Electronic", "Pop", "Jazz"]) {
        for (const enabled of [NO_TOOLS, new Set<TransitionTool>(["echo"]), new Set<TransitionTool>(["eq", "scratch"])]) {
          for (const p of rankTransitions(tagged(a), tagged(b), report(), undefined, { enabledTools: enabled, abruptEnding: true })) {
            for (const t of p.tools) expect(enabled.has(t), `${a} -> ${b}: ${p.style} asked for ${t}`).toBe(true);
          }
        }
      }
    }
  });

  it("drops a style whose tool is off and uses the next best option", () => {
    const styles = rankTransitions(tagged("Rock"), tagged("Rock"), report(), undefined, { enabledTools: NO_TOOLS }).map((p) => p.style);
    expect(styles).not.toContain("echo-out");
    expect(styles[0]).toBe("quick-cut");
    const withEcho = rankTransitions(tagged("Rock"), tagged("Rock"), report(), undefined, { enabledTools: new Set<TransitionTool>(["echo"]) }).map((p) => p.style);
    expect(withEcho).toContain("echo-out");
  });

  it("a vocal swap needs vocal separation on", () => {
    const pair = report({ trackA_bpm: 90, bpmDelta: 2 });
    const off = rankTransitions(tagged("R&B"), tagged("R&B"), pair, undefined, { enabledTools: ALL_TOOLS, vocalSplit: false });
    const on = rankTransitions(tagged("R&B"), tagged("R&B"), pair, undefined, { enabledTools: ALL_TOOLS, vocalSplit: true });
    expect(off.map((p) => p.style)).not.toContain("vocal-swap");
    expect(on.map((p) => p.style)).toContain("vocal-swap");
  });

  it("an abrupt ending outranks everything when echo-out is on, and is ignored when it is off", () => {
    const on = resolveTransition(tagged("Electronic"), tagged("Electronic"), report(), undefined, { enabledTools: ALL_TOOLS, abruptEnding: true });
    expect(on.style).toBe("echo-out");
    expect(on.reason).toContain("3-5 s");
    const off = resolveTransition(tagged("Electronic"), tagged("Electronic"), report(), undefined, { enabledTools: NO_TOOLS, abruptEnding: true });
    expect(off.style).toBe("long-blend");
  });
});

describe("resolveTransition: the plan itself", () => {
  it("carries a runner-up as its fallback, one level deep", () => {
    const plan = resolveTransition(tagged("Pop"), tagged("Pop"), report(), undefined, { enabledTools: ALL_TOOLS });
    expect(plan.fallbackPlan).not.toBeNull();
    expect(plan.fallbackPlan!.style).not.toBe(plan.style);
    expect(plan.fallbackPlan!.fallbackPlan).toBeNull();
  });

  it("always returns at least one plan, with a fade among them", () => {
    const ranked = rankTransitions(tagged("Jazz"), tagged("Classical"), report(), undefined, { enabledTools: NO_TOOLS });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.some((p) => p.style === "fade")).toBe(true);
  });

  it("uses the event profile's crossfade length as the blend length, kept inside both genres' bars", () => {
    expect(resolveTransition(tagged("Electronic"), tagged("Electronic"), report(), { crossfadeBars: 32 }, { enabledTools: ALL_TOOLS }).bars).toBe(32);
    expect(resolveTransition(tagged("Pop"), tagged("Pop"), report(), { crossfadeBars: 32 }, { enabledTools: ALL_TOOLS }).bars).toBeLessThanOrEqual(8);
  });

  it("uses the set mode only to break a tie", () => {
    const chill = resolveTransition(tagged("Electronic"), tagged("Electronic"), report(), { djMode: "chill" }, { enabledTools: ALL_TOOLS });
    const club = resolveTransition(tagged("Electronic"), tagged("Electronic"), report(), { djMode: "club" }, { enabledTools: ALL_TOOLS });
    expect(chill.style).toBe(club.style);
  });

  it("reads like a DJ's note", () => {
    const plan = resolveTransition(tagged("Hip-Hop"), tagged("R&B"), report({ trackA_bpm: 90, bpmDelta: 14 }), undefined, { enabledTools: new Set<TransitionTool>(["echo"]) });
    expect(describeGenrePlan(plan)).toBe("Hip-Hop to R&B: quick-cut with echo-out. Reason: tempo gap of 14 BPM.");
  });

  it("is pure: the same inputs give the same plan", () => {
    const a = resolveTransition(tagged("Latin"), tagged("Pop"), report(), { djMode: "party" }, { enabledTools: ALL_TOOLS });
    const b = resolveTransition(tagged("Latin"), tagged("Pop"), report(), { djMode: "party" }, { enabledTools: ALL_TOOLS });
    expect(b).toEqual(a);
  });
});
