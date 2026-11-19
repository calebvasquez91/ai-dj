import { describe, expect, it } from "vitest";
import {
  BRIDGE_BARS,
  bridgeNeed,
  chooseInstrumental,
  foldTempo,
  INSTRUMENTAL_MIN_FIT,
  instrumentalFit,
  isInstrumentalTrack,
  planInstrumentalBridge,
  type BridgeSide,
} from "./instrumentalBridge";
import type { TrackAnalysis } from "./audio-analysis";
import type { Track } from "@/types/music";

function analysis(bpm: number, camelot: string | null, over: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return { bpm, bpmConfidence: 0.9, beatGridOffsetSec: 0, energyOnsetSec: 0, key: null, keyConfidence: 0.8, camelotKey: camelot, breakdownAtSec: null, dropAtSec: null, buildDropPairs: [], waveformPeaks: [], fallback: false, ...over };
}
let n = 0;
const track = (over: Partial<Track> = {}): Track => ({ id: `t${++n}`, title: `Song ${n}`, artist: `Artist ${n}`, durationSec: 200, addedAt: 0, source: "local", sourceUrl: `x/${n}`, ...over }) as Track;
const side = (bpm: number, camelot: string | null, energy: number | null = 0.6, stemsReady = false, t: Track = track()): BridgeSide => ({ track: t, analysis: analysis(bpm, camelot), energy, stemsReady });

describe("isInstrumentalTrack", () => {
  it("knows an instrumental by its tag, its title, its flag or its score", () => {
    expect(isInstrumentalTrack({ title: "Song", tags: ["Instrumental"] })).toBe(true);
    expect(isInstrumentalTrack({ title: "Song", tags: ["karaoke"] })).toBe(true);
    expect(isInstrumentalTrack({ title: "Hotline Bling (Instrumental)" })).toBe(true);
    expect(isInstrumentalTrack({ title: "Song", isInstrumental: true })).toBe(true);
    expect(isInstrumentalTrack({ title: "Song" }, 0.85)).toBe(true);
    expect(isInstrumentalTrack({ title: "Song" }, 0.4)).toBe(false);
    expect(isInstrumentalTrack({ title: "Instrumentalist Blues" })).toBe(false);
    expect(isInstrumentalTrack({ title: "Song" })).toBe(false);
  });
});

describe("foldTempo", () => {
  it("counts half and double tempo as the same", () => {
    expect(foldTempo(140, 70)).toBe(140);
    expect(foldTempo(70, 140)).toBe(70);
    expect(foldTempo(128, 124)).toBe(124);
  });
});

describe("bridgeNeed: when a bridge is worth it", () => {
  it("needs none for two songs that mix", () => {
    expect(bridgeNeed(side(124, "8A"), side(126, "9A"))).toEqual({ needed: false, large: false, reasons: [] });
  });
  it("is needed for a tempo gap, a key clash, or a big energy jump", () => {
    expect(bridgeNeed(side(100, "8A"), side(115, "8A")).reasons).toEqual([{ kind: "bpm-gap", bpmDelta: 15 }]);
    expect(bridgeNeed(side(124, "8A"), side(124, "2B")).reasons).toEqual([{ kind: "key-clash" }]);
    expect(bridgeNeed(side(124, "8A", 0.2), side(124, "8A", 0.9)).reasons).toEqual([{ kind: "energy-jump", jump: 0.7 }]);
  });
  it("does not count a double-tempo reading as a tempo gap", () => {
    expect(bridgeNeed(side(70, "8A"), side(140, "8A")).needed).toBe(false);
  });
  it("calls a very wide gap, or two gaps at once, large", () => {
    expect(bridgeNeed(side(90, "8A"), side(120, "8A")).large).toBe(true);
    expect(bridgeNeed(side(100, "8A", 0.2), side(110, "2B", 0.9)).large).toBe(true);
    expect(bridgeNeed(side(100, "8A"), side(110, "8A")).large).toBe(false);
  });
  it("does not judge on readings it cannot trust", () => {
    const a = { ...side(100, "8A"), analysis: analysis(100, "8A", { fallback: true }) };
    expect(bridgeNeed(a, side(160, "8A")).reasons.some((r) => r.kind === "bpm-gap")).toBe(false);
    const unsure = { ...side(124, "8A"), analysis: analysis(124, "2B", { keyConfidence: 0.1 }) };
    expect(bridgeNeed(side(124, "8A"), unsure).reasons).toEqual([]);
  });
});

describe("instrumentalFit and chooseInstrumental", () => {
  const a = analysis(100, "8A");
  const b = analysis(120, "9A");
  it("scores an instrumental between the two in tempo and compatible with both keys well", () => {
    expect(instrumentalFit(a, b, analysis(110, "8A"))).toBeGreaterThan(0.9);
    expect(instrumentalFit(a, b, analysis(170, "2B"))).toBeLessThan(0.3);
    expect(instrumentalFit(a, b, analysis(110, "8A", { fallback: true }))).toBe(0);
  });

  const A = side(100, "8A");
  const B = side(120, "9A");
  const instr = (bpm: number, camelot: string, over: Partial<Track> = {}) => ({ t: track({ title: "Beat (Instrumental)", ...over }), a: analysis(bpm, camelot) });

  it("picks the library instrumental that sits best between them", () => {
    const good = instr(110, "8A");
    const worse = instr(150, "2B");
    const lookup = new Map([[good.t.id, good.a], [worse.t.id, worse.a]]);
    const choice = chooseInstrumental({ a: A, b: B, library: [A.track, B.track, worse.t, good.t], analysisOf: (t) => lookup.get(t.id) ?? null })!;
    expect(choice.source.kind).toBe("library");
    expect(choice.source.kind === "library" && choice.source.track.id).toBe(good.t.id);
    expect(choice.score).toBeGreaterThanOrEqual(INSTRUMENTAL_MIN_FIT);
  });

  it("never uses a Do-Not-Play or Halloween instrumental, or A or B themselves", () => {
    const doNot = instr(110, "8A", { playPreference: "do-not" });
    const spooky = instr(110, "8A", { tags: ["halloween", "instrumental"] });
    const lookup = new Map([[doNot.t.id, doNot.a], [spooky.t.id, spooky.a]]);
    expect(chooseInstrumental({ a: A, b: B, library: [A.track, B.track, doNot.t, spooky.t], analysisOf: (t) => lookup.get(t.id) ?? null })).toBeNull();
  });

  it("builds one from the stems of A or B when no library instrumental fits", () => {
    const withStems = side(110, "8A", 0.6, true);
    const choice = chooseInstrumental({ a: A, b: withStems, library: [A.track, withStems.track], analysisOf: () => null })!;
    expect(choice.source.kind).toBe("stems");
    expect(choice.source.kind === "stems" && choice.source.of.id).toBe(withStems.track.id);
  });

  it("says null when nothing suits", () => {
    expect(chooseInstrumental({ a: A, b: B, library: [A.track, B.track], analysisOf: () => null })).toBeNull();
  });
});

describe("planInstrumentalBridge", () => {
  const A = side(100, "8A", 0.5, false, track({ title: "Track A" }));
  const B = side(120, "9A", 0.5, false, track({ title: "Track B" }));
  const inst = track({ title: "Loop (Instrumental)", artist: "Beatmaker" });
  const analysisOf = (t: Track) => (t.id === inst.id ? analysis(110, "8A") : null);

  it("plans track A morphing into the instrumental, 4 to 8 bars phase-locked, then into track B, as three steps", () => {
    const plan = planInstrumentalBridge({ a: A, b: B, library: [A.track, B.track, inst], analysisOf })!;
    expect(plan.steps.map((s) => s.step)).toEqual(["morph-to-instrumental", "instrumental", "morph-to-next"]);
    expect(plan.steps[1].bars).toBe(plan.holdBars);
    expect([BRIDGE_BARS.short, BRIDGE_BARS.long]).toContain(plan.holdBars);
    expect(plan.readout).toMatch(/Track A → instrumental \(Beatmaker - Loop \(Instrumental\), \d bars\) → Track B · tempo gap of 20 BPM/);
  });
  it("uses the longer bridge for a larger gap", () => {
    const farB = side(130, "9A", 0.5, false, track({ title: "Track B" }));
    expect(planInstrumentalBridge({ a: A, b: farB, library: [A.track, farB.track, inst], analysisOf: (t) => (t.id === inst.id ? analysis(115, "8A") : null) })!.holdBars).toBe(BRIDGE_BARS.long);
  });
  it("falls back to the normal transition (null) when no bridge is needed or no instrumental suits", () => {
    expect(planInstrumentalBridge({ a: side(124, "8A"), b: side(126, "9A"), library: [inst], analysisOf })).toBeNull();
    expect(planInstrumentalBridge({ a: A, b: B, library: [A.track, B.track], analysisOf })).toBeNull();
  });
});
