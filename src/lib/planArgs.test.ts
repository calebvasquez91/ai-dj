import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FX_SOUND_TRANSITION_IDS, RECENT_TRANSITIONS_KEPT, planArgsFromState, planTransition, type PlanningState } from "./mix-engine";
import { TRANSITION_FX_ENABLED } from "./syncEngine";
import type { TrackAnalysis } from "./audio-analysis";
import type { Track } from "@/types/music";

const track = (id: string) => ({ track: { id } as never, analysis: {} as never });

const base: PlanningState = {
  styleGenreHint: "house",
  crossfadeOverrideSec: 12,
  djMode: "club",
  forcedTransitionId: "bass-swap",
  rerolledTransitionIds: ["echo-out"],
  stemAvailability: {},
  djVarietyBias: true,
  quantizeEnabled: false,
  recentTransitionIds: ["long-blend"],
};
const weights = { cut: 2 };

describe("planArgsFromState", () => {
  it("carries every planning input through under the engine's argument names", () => {
    const args = planArgsFromState(base, weights, track("a"), track("b"), { currentElapsedSec: 41.5 });
    expect(args).toMatchObject({
      genreHint: "house",
      overrideSec: 12,
      djMode: "club",
      currentElapsedSec: 41.5,
      recentTransitionIds: ["long-blend"],
      forceTransitionId: "bass-swap",
      varietyBias: true,
      categoryWeights: { cut: 2 },
      quantize: false,
    });
    expect(args.current.track.id).toBe("a");
    expect(args.next.track.id).toBe("b");
  });

  it("keeps vocal-layering out of the running when the incoming track has no vocal stem", () => {
    const args = planArgsFromState(base, weights, track("a"), track("b"));
    expect(args.vocalStemReady).toBe(false);
    expect(args.excludeTransitionIds).toEqual(["echo-out", "vocal-layering", ...FX_SOUND_TRANSITION_IDS]);
  });

  it("allows vocal-layering, with its bonus, once the incoming vocal stem is ready", () => {
    const args = planArgsFromState({ ...base, stemAvailability: { b: "https://stem/vocals.wav" } }, weights, track("a"), track("b"));
    expect(args.vocalStemReady).toBe(true);
    expect(args.excludeTransitionIds).toEqual(["echo-out", ...FX_SOUND_TRANSITION_IDS]);
  });

  it("only looks at the INCOMING track's stem, not the outgoing one's", () => {
    const args = planArgsFromState({ ...base, stemAvailability: { a: "https://stem/vocals.wav" } }, weights, track("a"), track("b"));
    expect(args.vocalStemReady).toBe(false);
  });

  it("ignoreOverrides drops the pin and the re-rolls but keeps the stem rule", () => {
    const args = planArgsFromState(base, weights, track("a"), track("b"), { ignoreOverrides: true });
    expect(args.forceTransitionId).toBeNull();
    expect(args.excludeTransitionIds).toEqual(["vocal-layering", ...FX_SOUND_TRANSITION_IDS]);
  });

  it("defaults the playhead to unknown", () => {
    expect(planArgsFromState(base, weights, track("a"), track("b")).currentElapsedSec).toBeNull();
  });

  it("remembers a few recent transitions, not an unbounded history", () => {
    expect(RECENT_TRANSITIONS_KEPT).toBe(3);
  });
});

describe("with transition FX off (Song Sync Mode)", () => {
  it("is off, and the overlay-sound transitions are exactly the five that exist only as a sound", () => {
    expect(TRANSITION_FX_ENABLED).toBe(false);
    expect([...FX_SOUND_TRANSITION_IDS].sort()).toEqual(
      ["riser-uplift", "scratch-transition", "tag-drop", "transform-chop", "word-play-drop"].sort()
    );
  });

  it("keeps them out of every plan's candidates", () => {
    const args = planArgsFromState({ ...base, forcedTransitionId: null, rerolledTransitionIds: [] }, weights, track("a"), track("b"));
    for (const id of FX_SOUND_TRANSITION_IDS) expect(args.excludeTransitionIds).toContain(id);
  });

  it("never plans an overlay-sound effect, whatever the pair", () => {
    const makeTrack = (id: string, durationSec: number): Track => ({
      id,
      title: id,
      artist: "Test Artist",
      durationSec,
      addedAt: 0,
      source: "local",
      sourceUrl: `blob:${id}`,
    });
    const analysis = (bpm: number, camelotKey: string, energyOnsetSec: number): TrackAnalysis => ({
      bpm,
      bpmConfidence: 0.8,
      beatGridOffsetSec: 0.2,
      energyOnsetSec,
      key: camelotKey,
      keyConfidence: 0.6,
      camelotKey,
      breakdownAtSec: null,
      dropAtSec: null,
      buildDropPairs: [],
      waveformPeaks: [],
      fallback: false,
    });
    const overlayEffects = new Set(["riser", "scratch-chirp", "tag-sample", "word-play"]);
    const seen = new Set<string>();
    const modes = ["club", "wedding", "party", "chill", "open-format"] as const;
    for (const djMode of modes) {
      for (const bpmB of [100, 124, 128, 131, 140, 160]) {
        for (const keyB of ["8A", "9A", "3B", "5A"]) {
          for (const genre of [null, "house", "hiphop", "techno"]) {
            const args = planArgsFromState(
              { ...base, djMode, styleGenreHint: genre, forcedTransitionId: null, rerolledTransitionIds: [] },
              {},
              { track: makeTrack("a", 240), analysis: analysis(128, "8A", 8) },
              { track: makeTrack("b", 240), analysis: analysis(bpmB, keyB, 12) }
            );
            const plan = planTransition(args);
            seen.add(plan.transitionId);
            expect(overlayEffects.has(plan.effect), `${plan.transitionId} -> ${plan.effect}`).toBe(false);
            expect(FX_SOUND_TRANSITION_IDS).not.toContain(plan.transitionId);
          }
        }
      }
    }
    // the planner still has plenty to choose from
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe("planTransition has one entry point", () => {
  // Every planner (deck preview, sync readout, AI FX briefing, DualDeckStage) must build its arguments with
  // planArgsFromState; a hand-assembled planTransition({...}) is how they drifted apart before.
  it("is only ever called with planArgsFromState(...) arguments", () => {
    const srcDir = path.resolve(import.meta.dirname, "..");
    const files = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .map((f) => path.join(srcDir, f));
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return; // prose
        if (trimmed.startsWith("export function planTransition")) return; // the definition
        for (const m of line.matchAll(/\bplanTransition\(/g)) {
          const rest = (line.slice((m.index ?? 0) + m[0].length) + " " + (lines[i + 1] ?? "")).trim();
          if (!rest.startsWith("planArgsFromState(")) offenders.push(`${path.relative(srcDir, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
