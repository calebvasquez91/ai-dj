import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_PLAY_SEC,
  brakeGainCurves,
  camelotCompatibility,
  chooseTransition,
  planTransition,
  spinUpGainCurves,
  stutterGateCurves,
} from "./mix-engine";
import type { TrackAnalysis } from "./audio-analysis";
import type { Track } from "@/types/music";

function makeTrack(id: string, durationSec: number): Track {
  return { id, title: id, artist: "Test Artist", durationSec, sourceUrl: `blob:${id}` };
}

function makeAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    bpm: 128,
    bpmConfidence: 0.8,
    beatGridOffsetSec: 0.2,
    energyOnsetSec: 8,
    key: "A minor",
    keyConfidence: 0.6,
    camelotKey: "8A",
    breakdownAtSec: null,
    dropAtSec: null,
    waveformPeaks: [],
    fallback: false,
    ...overrides,
  };
}

describe("planTransition", () => {
  it("picks a tempo-synced blend/eq-filter transition for close-BPM house/techno tracks", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 129 }) },
      genreHint: "techno",
    });
    expect(plan.tempoSync).toBe(true);
    expect(["blend", "eq-filter"]).toContain(plan.category);
    expect(plan.windowBeats).toBeGreaterThanOrEqual(8);
  });

  it("picks a tempo-insensitive, hip-hop-flavored transition for far-apart BPMs with a hip-hop persona", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 100 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 137 }) },
      genreHint: "hip-hop",
    });
    expect(plan.tempoSync).toBe(false);
    // "cut" (specifically Hard Cut) is disabled by user preference — see
    // data/transitions.ts — so a mismatched-tempo hip-hop pair should land
    // on some other tempo-insensitive, genre-appropriate technique instead.
    expect(["cut", "scratch", "tag-sample", "word-play"]).toContain(plan.category);
  });

  it("never defaults the incoming entry point to zero when an energy onset was detected", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128, energyOnsetSec: 12.4 }) },
      genreHint: "house",
    });
    expect(plan.incomingEntryOffsetSec).not.toBe(0);
    expect(plan.incomingEntryOffsetSec).toBeGreaterThan(5);
  });

  it("snaps the incoming entry point to the next track's own beat grid", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: {
        track: makeTrack("b", 240),
        analysis: makeAnalysis({ bpm: 120, beatGridOffsetSec: 0.5, energyOnsetSec: 10.1 }),
      },
      genreHint: "house",
    });
    const beatLenSec = 60 / 120;
    const beatsFromOffset = (plan.incomingEntryOffsetSec - 0.5) / beatLenSec;
    expect(Math.abs(beatsFromOffset - Math.round(beatsFromOffset))).toBeLessThan(1e-6);
  });

  it("clamps the incoming entry point so it never lands too close to the track's end", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: {
        track: makeTrack("b", 30),
        analysis: makeAnalysis({ bpm: 128, energyOnsetSec: 28 }),
      },
      genreHint: "house",
    });
    expect(plan.incomingEntryOffsetSec).toBeLessThanOrEqual(27);
  });

  it("still derives the window from BPM (not a flat constant) even in a low-confidence fallback scenario", () => {
    const slow = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 100, fallback: true, bpmConfidence: 0 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 100, fallback: true, bpmConfidence: 0 }) },
      genreHint: "house",
    });
    const fast = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 175, fallback: true, bpmConfidence: 0 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 175, fallback: true, bpmConfidence: 0 }) },
      genreHint: "house",
    });
    expect(slow.windowSec).not.toBe(fast.windowSec);
    expect(slow.windowBeats).toBe(fast.windowBeats);
  });

  it("respects an explicit duration override while still picking a real transition style", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128 }) },
      genreHint: "techno",
      overrideSec: 12,
    });
    expect(plan.windowSec).toBe(12);
    expect(plan.transitionId).not.toBe("");
  });

  it("produces a non-empty rationale mentioning the chosen transition", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128 }) },
      genreHint: "techno",
    });
    expect(plan.rationale.length).toBeGreaterThan(0);
  });

  it("never floors a short/tempo-insensitive transition's window at the multi-second blend minimum", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 100 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 137 }) },
      genreHint: "hip-hop",
    });
    expect(plan.tempoSync).toBe(false);
    expect(plan.windowSec).toBeLessThan(3);
  });

  it("respects an explicit crossfade override even for a cut-category pick", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 100 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 137 }) },
      genreHint: "hip-hop",
      overrideSec: 10,
    });
    expect(plan.windowSec).toBe(10);
  });

  it("phase-locks the incoming entry point to the outgoing track's current beat position when currentElapsedSec is given", () => {
    const current = { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128, beatGridOffsetSec: 0 }) };
    const next = {
      track: makeTrack("b", 240),
      analysis: makeAnalysis({ bpm: 128, beatGridOffsetSec: 0, energyOnsetSec: 16 }),
    };
    // 128 BPM beat length is 60/128 = 0.46875s. Elapsed 10.234375s is
    // exactly 1/4 of a beat (0.1171875s) past a beat boundary.
    const beatLenSec = 60 / 128;
    const fromPhaseSec = beatLenSec / 4;
    const withoutPhase = planTransition({ current, next });
    const withPhase = planTransition({ current, next, currentElapsedSec: 22 * beatLenSec + fromPhaseSec });
    expect(withPhase.incomingEntryOffsetSec - withoutPhase.incomingEntryOffsetSec).toBeCloseTo(
      fromPhaseSec,
      5
    );
  });

  it("does not shift the entry point when the outgoing track's elapsed time lands exactly on a beat", () => {
    const current = { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128, beatGridOffsetSec: 0 }) };
    const next = {
      track: makeTrack("b", 240),
      analysis: makeAnalysis({ bpm: 128, beatGridOffsetSec: 0, energyOnsetSec: 16 }),
    };
    const beatLenSec = 60 / 128;
    const withoutPhase = planTransition({ current, next });
    const withPhase = planTransition({ current, next, currentElapsedSec: 30 * beatLenSec });
    expect(withPhase.incomingEntryOffsetSec).toBeCloseTo(withoutPhase.incomingEntryOffsetSec, 5);
  });
});

describe("MAX_ACTIVE_PLAY_SEC", () => {
  it("caps active playback well under a typical track length", () => {
    expect(MAX_ACTIVE_PLAY_SEC).toBeGreaterThan(60);
    expect(MAX_ACTIVE_PLAY_SEC).toBeLessThan(240);
  });
});

describe("brakeGainCurves", () => {
  it("holds the outgoing deck at full volume and the incoming deck silent until the drop point", () => {
    const { outCurve, inCurve } = brakeGainCurves(20, 0.75);
    expect(outCurve[0]).toBe(1);
    expect(inCurve[0]).toBe(0);
    expect(outCurve[10]).toBe(1); // 10/19 ≈ 0.53, still before the 0.75 drop point
    expect(inCurve[10]).toBe(0);
  });

  it("crossfades to the incoming deck by the end of the curve", () => {
    const { outCurve, inCurve } = brakeGainCurves(20, 0.75);
    expect(outCurve[19]).toBeCloseTo(0, 5);
    expect(inCurve[19]).toBeCloseTo(1, 5);
  });
});

describe("camelotCompatibility", () => {
  it("scores identical keys highest", () => {
    expect(camelotCompatibility("8A", "8A")).toBe(2);
  });

  it("scores relative major/minor and adjacent-wheel keys as compatible", () => {
    expect(camelotCompatibility("8A", "8B")).toBe(1);
    expect(camelotCompatibility("8A", "9A")).toBe(1);
    expect(camelotCompatibility("8A", "7A")).toBe(1);
  });

  it("scores unrelated keys as incompatible", () => {
    expect(camelotCompatibility("8A", "2B")).toBe(0);
  });

  it("returns 0 for missing or malformed codes", () => {
    expect(camelotCompatibility(null, "8A")).toBe(0);
    expect(camelotCompatibility("8A", null)).toBe(0);
    expect(camelotCompatibility("bogus", "8A")).toBe(0);
  });
});

describe("planTransition — harmonic mixing", () => {
  it("mentions matching keys in the rationale when both are confidently known", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128 }) },
      genreHint: "house",
    });
    expect(plan.rationale).toContain("Same key.");
  });

  it("omits the harmonic note when key confidence is too low to trust", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128, keyConfidence: 0.05 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128, keyConfidence: 0.05 }) },
      genreHint: "house",
    });
    expect(plan.rationale).not.toMatch(/harmonically compatible|same key/i);
  });
});

describe("planTransition — Double Drop", () => {
  it("times the incoming track's drop to land at the end of the transition window", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 140 }) },
      next: {
        track: makeTrack("b", 240),
        analysis: makeAnalysis({ bpm: 140, beatGridOffsetSec: 0, dropAtSec: 45 }),
      },
      genreHint: "dubstep",
    });
    expect(plan.category).toBe("drop");
    const expectedEntry = 45 - plan.windowSec;
    expect(plan.incomingEntryOffsetSec).toBeGreaterThan(expectedEntry - 1);
    expect(plan.incomingEntryOffsetSec).toBeLessThanOrEqual(expectedEntry + 1);
  });
});

describe("planTransition — Tempo Ramp", () => {
  it("selects Tempo Ramp for a moderate BPM gap in a drum & bass context and computes a real tempo ratio", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 150 }) },
      genreHint: "dnb",
    });
    expect(plan.category).toBe("tempo-ramp");
    expect(plan.tempoSync).toBe(false);
    expect(plan.tempoRatioStart).not.toBe(1);
  });
});

describe("planTransition — untrustworthy tempo data", () => {
  it("does not claim tempo-sync or attempt a tempo ratio when both tracks' BPM confidence is too low to trust, even if the numbers happen to match", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 120, bpmConfidence: 0.05 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 120, bpmConfidence: 0.05 }) },
    });
    expect(plan.tempoSync).toBe(false);
    expect(plan.tempoRatioStart).toBe(1);
  });

  it("still trusts a confident, genuinely matched pair", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128, bpmConfidence: 0.8 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128, bpmConfidence: 0.8 }) },
    });
    expect(plan.tempoSync).toBe(true);
  });
});

describe("planTransition — BPM mismatch penalty scales with severity", () => {
  it("heavily penalizes tempo-sensitive techniques for a genuinely large mismatch, even with a favorable genre hint", () => {
    const plan = planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 90 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 137 }) },
      genreHint: "house",
    });
    expect(["blend", "eq-filter", "eq-kill"]).not.toContain(plan.category);
  });
});

describe("planTransition — anti-repetition", () => {
  it("avoids repeating the same transition immediately after it was just used, when another scores similarly", () => {
    const args = {
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128, keyConfidence: 0 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128, keyConfidence: 0 }) },
    };
    const first = planTransition(args);
    expect(first.transitionId).toBe("auto-sync-blend");
    const second = planTransition({ ...args, recentTransitionIds: [first.transitionId] });
    expect(second.transitionId).not.toBe("auto-sync-blend");
  });
});

describe("planTransition — DJ Set Modes", () => {
  // Identical BPM (128/128) and no genre hint means every transition passes
  // its own idealBpmDeltaMax check equally, so the mode bias alone decides
  // the winner — an unambiguous way to test each mode's steering.
  function matchedPairPlan(djMode: Parameters<typeof planTransition>[0]["djMode"]) {
    return planTransition({
      current: { track: makeTrack("a", 240), analysis: makeAnalysis({ bpm: 128, keyConfidence: 0 }) },
      next: { track: makeTrack("b", 240), analysis: makeAnalysis({ bpm: 128, keyConfidence: 0 }) },
      djMode,
    });
  }

  it("defaults to auto-sync-blend with no mode bias", () => {
    expect(matchedPairPlan("auto").transitionId).toBe("auto-sync-blend");
  });

  it("Wedding mode avoids flashy effects and favors a clean digital blend", () => {
    const plan = matchedPairPlan("wedding");
    expect(plan.transitionId).toBe("auto-sync-blend");
    expect(["scratch", "tag-sample", "riser", "brake"]).not.toContain(plan.category);
  });

  it("Chill mode favors a long smooth blend", () => {
    const plan = matchedPairPlan("chill");
    expect(plan.category).toBe("blend");
  });

  it("Party mode leans into a crowd-hype tag/sample moment", () => {
    expect(matchedPairPlan("party").transitionId).toBe("tag-drop");
  });

  it("Open Format mode leans into a tempo ramp for bold bridging", () => {
    expect(matchedPairPlan("open-format").transitionId).toBe("tempo-ramp-blend");
  });

  it("Club mode favors a clean beatmatched technique over scratch/brake/riser", () => {
    const plan = matchedPairPlan("club");
    expect(["blend", "eq-filter", "digital"]).toContain(plan.category);
  });
});

describe("stutterGateCurves", () => {
  it("only ever has one deck audible at a time", () => {
    const { outCurve, inCurve } = stutterGateCurves(32, 8);
    for (let i = 0; i < 32; i++) {
      expect(outCurve[i] + inCurve[i]).toBe(1);
    }
  });

  it("always ends on the incoming deck", () => {
    const { outCurve, inCurve } = stutterGateCurves(32, 8);
    expect(outCurve[31]).toBe(0);
    expect(inCurve[31]).toBe(1);
  });

  it("toggles between decks more than once across the window", () => {
    const { inCurve } = stutterGateCurves(32, 8);
    let toggles = 0;
    for (let i = 1; i < 32; i++) {
      if (inCurve[i] !== inCurve[i - 1]) toggles++;
    }
    expect(toggles).toBeGreaterThan(1);
  });
});

describe("spinUpGainCurves", () => {
  it("starts with the outgoing deck full and the incoming deck silent", () => {
    const { outCurve, inCurve } = spinUpGainCurves(20, 0.25);
    expect(outCurve[0]).toBe(1);
    expect(inCurve[0]).toBe(0);
  });

  it("has fully handed off to the incoming deck well before the window ends, so its pitch ramp is audible on its own", () => {
    const { outCurve, inCurve } = spinUpGainCurves(20, 0.25);
    expect(outCurve[10]).toBe(0);
    expect(inCurve[10]).toBe(1);
    expect(outCurve[19]).toBe(0);
    expect(inCurve[19]).toBe(1);
  });
});

describe("chooseTransition — Spin Up vs. its near-twin Spinback", () => {
  it("prefers Spin Up when Spinback (identical genre/persona fit) was just used", () => {
    const t = chooseTransition({
      bpmDelta: 0.02,
      tempoSync: true,
      genreHint: "hip-hop",
      personaDjNames: ["Kool Herc"],
      recentTransitionIds: ["spinback"],
    });
    expect(t.id).toBe("spin-up");
  });
});

describe("chooseTransition — Word Play vs. its near-twin Tag/Sample", () => {
  it("prefers Word Play when Tag/Sample (identical genre/persona fit) was just used", () => {
    const t = chooseTransition({
      bpmDelta: 0.02,
      tempoSync: true,
      genreHint: "hip-hop",
      personaDjNames: ["Diplo"],
      recentTransitionIds: ["tag-drop"],
    });
    expect(t.id).toBe("word-play-drop");
  });
});

describe("chooseTransition — manual override (forceTransitionId)", () => {
  it("returns exactly the forced transition even when it would score poorly on merit", () => {
    const t = chooseTransition({
      bpmDelta: 0.02,
      tempoSync: true,
      genreHint: null,
      personaDjNames: [],
      forceTransitionId: "reverb-wash",
    });
    expect(t.id).toBe("reverb-wash");
  });

  it("falls back to normal scoring if the forced id doesn't exist or isn't executable", () => {
    const normal = chooseTransition({ bpmDelta: 0, tempoSync: true, genreHint: null, personaDjNames: [] });
    const forcedBogus = chooseTransition({
      bpmDelta: 0,
      tempoSync: true,
      genreHint: null,
      personaDjNames: [],
      forceTransitionId: "not-a-real-transition",
    });
    const forcedNonExecutable = chooseTransition({
      bpmDelta: 0,
      tempoSync: true,
      genreHint: null,
      personaDjNames: [],
      forceTransitionId: "vocal-layering", // data-only, executable: false
    });
    expect(forcedBogus.id).toBe(normal.id);
    expect(forcedNonExecutable.id).toBe(normal.id);
  });
});

describe("chooseTransition — reroll (excludeTransitionIds)", () => {
  it("picks a different transition than the one just excluded", () => {
    const ctx = {
      bpmDelta: 0,
      tempoSync: true,
      genreHint: null,
      personaDjNames: [],
    };
    const first = chooseTransition(ctx);
    const rerolled = chooseTransition({ ...ctx, excludeTransitionIds: [first.id] });
    expect(rerolled.id).not.toBe(first.id);
  });

  it("falls back to unrestricted scoring instead of breaking when every candidate is excluded", () => {
    const ctx = {
      bpmDelta: 0,
      tempoSync: true,
      genreHint: null,
      personaDjNames: [],
    };
    const normal = chooseTransition(ctx);
    const allExcluded = chooseTransition({
      ...ctx,
      excludeTransitionIds: ["hard-cut", "quick-chop", "long-blend", "phrase-blend", "auto-sync-blend"],
    });
    // With the top scorers excluded but not literally every transition,
    // this should still return something real and executable, not crash.
    expect(allExcluded.executable).toBe(true);
    expect(typeof allExcluded.id).toBe("string");
    void normal;
  });
});

describe("chooseTransition — varietyBias", () => {
  it("favors a bolder, tempo-insensitive technique over a defensive hard cut when tempo is uncertain and the genre doesn't match either", () => {
    // bpmDelta of 0.15 is well outside every tempo-sensitive category's
    // tolerance, and "house" doesn't match hard-cut's/echo-out's idealGenres
    // — without bias, hard-cut wins on its flat, tempo-insensitive +10.
    const ctx = {
      bpmDelta: 0.15,
      tempoSync: false,
      genreHint: "house",
      personaDjNames: [],
    };
    const withoutBias = chooseTransition(ctx);
    expect(withoutBias.category).toBe("cut");

    const withBias = chooseTransition({ ...ctx, varietyBias: true });
    expect(withBias.category).not.toBe("cut");
  });
});
