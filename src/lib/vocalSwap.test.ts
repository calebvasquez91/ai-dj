import { describe, expect, it } from "vitest";
import type { VoiceMap } from "./voiceMap";
import { MIN_SWAP_GAP_SEC, leadVocalOverlapSec, planVocalSwap, vocalDensity, vocalGaps } from "./vocalSwap";

const map = (segments: [number, number][], durationSec = 240): VoiceMap => ({ source: "stem", durationSec, segments });

describe("vocalDensity", () => {
  it("is the share of the window with a vocal, and null when the map is unknown", () => {
    expect(vocalDensity(map([[0, 10]]), 0, 20)).toBe(0.5);
    expect(vocalDensity(map([[5, 15]]), 0, 10)).toBe(0.5);
    expect(vocalDensity(map([]), 0, 10)).toBe(0);
    expect(vocalDensity(null, 0, 10)).toBeNull();
    expect(vocalDensity(map([[0, 5]]), 10, 10)).toBeNull();
  });
});

describe("vocalGaps", () => {
  it("lists the quiet stretches long enough to hand a vocal over in", () => {
    expect(vocalGaps(map([[0, 10], [10.3, 20], [24, 30]]), 0, 40)).toEqual([[20, 24], [30, 40]]);
    expect(vocalGaps(map([[5, 15]]), 0, 40, 6)).toEqual([[15, 40]]);
  });
});

/** Both vocals audible at the same moment, found by sampling the plan every 10 ms, independently of the module's own overlap sum. */
function sampledOverlap(out: VoiceMap, inn: VoiceMap, plan: NonNullable<ReturnType<typeof planVocalSwap>>, shift: number, from: number, to: number): number {
  const voiced = (m: VoiceMap, t: number) => m.segments.some(([a, b]) => t >= a && t < b);
  let n = 0;
  for (let t = from; t < to; t += 0.01) {
    const outAudible = t < plan.outgoingVocalOffSec && voiced(out, t);
    const inAudible = t >= plan.incomingVocalOnSec - shift && voiced(inn, t + shift);
    if (outAudible && inAudible) n++;
  }
  return n * 0.01;
}

describe("planVocalSwap", () => {
  it("hands over inside a gap where both vocals are quiet, and lets the incoming vocal in at its next phrase", () => {
    const out = map([[0, 30], [44, 80]]); // quiet 30-44
    const inn = map([[0, 3], [10, 20], [46, 60]]); // entered at t=0 of the window: quiet 3-10 and 20-46
    const plan = planVocalSwap({ outgoing: out, incoming: inn, windowStartSec: 20, windowEndSec: 60, incomingEntrySec: 0 });
    expect(plan).not.toBeNull();
    // incoming-song time = outgoing time - 20; its quiet 20-46 is outgoing 40-66; shared with the outgoing gap 30-44: 40-44
    expect(plan!.gapSec).toEqual([30, 44]);
    expect(plan!.outgoingVocalOffSec).toBeGreaterThanOrEqual(40);
    expect(plan!.outgoingVocalOffSec).toBeLessThanOrEqual(44);
    expect(plan!.incomingVocalOnSec).toBe(46); // its next phrase
    expect(plan!.overlapSec).toBe(0);
    expect(sampledOverlap(out, inn, plan!, -20, 20, 60)).toBe(0);
  });

  it("returns null when there is no shared gap in the window, so another style is chosen", () => {
    const out = map([[0, 100]]); // never quiet
    const inn = map([[0, 10], [20, 30]]);
    expect(planVocalSwap({ outgoing: out, incoming: inn, windowStartSec: 10, windowEndSec: 60, incomingEntrySec: 0 })).toBeNull();
    // gaps that never line up
    expect(planVocalSwap({ outgoing: map([[0, 20], [30, 60]]), incoming: map([[0, 31], [40, 60]]), windowStartSec: 0, windowEndSec: 60, incomingEntrySec: 0 })).toBeNull();
  });

  it("ignores a gap too short to be a hand-over", () => {
    const out = map([[0, 20], [20.4, 60]]);
    expect(planVocalSwap({ outgoing: out, incoming: map([]), windowStartSec: 0, windowEndSec: 60, incomingEntrySec: 0 })).toBeNull();
    expect(MIN_SWAP_GAP_SEC).toBeGreaterThan(0.4);
  });

  it("an instrumental-start song (no incoming vocals in the window) can take any outgoing gap", () => {
    const plan = planVocalSwap({ outgoing: map([[0, 10], [14, 40]]), incoming: map([]), windowStartSec: 0, windowEndSec: 40, incomingEntrySec: 0 });
    expect(plan?.gapSec).toEqual([10, 14]);
  });

  it("NEVER overlaps two lead vocals: across many generated pairs, every plan it returns has zero overlap", () => {
    let seed = 12345;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0xffffffff);
    const gen = (): VoiceMap => {
      const segs: [number, number][] = [];
      let t = rand() * 6;
      while (t < 200) {
        const len = 3 + rand() * 18;
        segs.push([t, t + len]);
        t += len + 0.2 + rand() * 7;
      }
      return map(segs, 200);
    };
    let planned = 0;
    for (let i = 0; i < 400; i++) {
      const out = gen();
      const inn = gen();
      const windowStart = 40 + rand() * 60;
      const entry = rand() * 30;
      const input = { outgoing: out, incoming: inn, windowStartSec: windowStart, windowEndSec: windowStart + 20 + rand() * 40, incomingEntrySec: entry };
      const plan = planVocalSwap(input);
      if (!plan) continue;
      planned++;
      const shift = entry - windowStart;
      expect(plan.overlapSec).toBe(0);
      expect(leadVocalOverlapSec(out, inn, -shift, plan.outgoingVocalOffSec, plan.incomingVocalOnSec - shift)).toBe(0);
      expect(sampledOverlap(out, inn, plan, shift, windowStart, input.windowEndSec)).toBe(0);
      // the outgoing vocal is muted inside its own gap, never mid-word
      expect(out.segments.some(([a, b]) => plan.outgoingVocalOffSec > a && plan.outgoingVocalOffSec < b)).toBe(false);
    }
    expect(planned).toBeGreaterThan(20); // the property is exercised, not vacuous
  });
});

describe("leadVocalOverlapSec", () => {
  it("measures the time both vocals would be audible together", () => {
    const out = map([[0, 30]]);
    const inn = map([[20, 50]]); // same clock (offset 0)
    expect(leadVocalOverlapSec(out, inn, 0, 30, 20)).toBe(10); // out until 30, in from 20: 10 s together
    expect(leadVocalOverlapSec(out, inn, 0, 20, 20)).toBe(0); // clean hand-over at 20
  });
});
