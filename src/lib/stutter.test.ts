import { describe, expect, it } from "vitest";
import { manualStutter, noteForIntensity, STUTTER_END_GUARD_SEC, planStutter, scheduleStutter, STUTTER_BEATS, STUTTER_MIN_GAP_BARS, stutterGapBars, stutterNoteFor, type StutterContext } from "./stutter";
import { barsToSec, isOnBeat } from "./djMoves";
import type { ParamLike } from "./djEq";
import type { TrackAnalysis } from "./audio-analysis";

const BPM = 120;
const BEAT = 60 / BPM;

function analysis(over: Partial<TrackAnalysis> = {}): TrackAnalysis {
  const peaks = Array.from({ length: 400 }, (_, i) => (i < 100 ? 0.15 : i < 200 ? 0.5 : 0.95));
  return {
    bpm: BPM,
    bpmConfidence: 0.9,
    beatGridOffsetSec: 0,
    energyOnsetSec: 0,
    key: null,
    keyConfidence: 0,
    camelotKey: null,
    breakdownAtSec: null,
    dropAtSec: null,
    buildDropPairs: [],
    waveformPeaks: peaks,
    fallback: false,
    ...over,
  };
}
const ctx = (over: Partial<StutterContext> = {}): StutterContext => ({ analysis: analysis(), durationSec: 240, currentTimeSec: 200, lastMoveAtSec: null, genre: "Hip-Hop", mode: "party", frequency: 1, ...over });

describe("planStutter: only at peaks and drops, on the beat grid", () => {
  it("stutters in a peak, starting on a beat, for two beats in all", () => {
    const a = analysis();
    const m = planStutter(ctx({ analysis: a, currentTimeSec: 200.1 }))!;
    expect(m.where).toBe("peak");
    expect(isOnBeat(a, m.startSec)).toBe(true);
    expect(m.durationSec).toBeCloseTo(STUTTER_BEATS * BEAT, 6);
    expect(m.sliceSec * m.repeats).toBeCloseTo(m.durationSec, 6);
    expect(m.reason).toMatch(/energy 1\.00, 120 BPM, 1\/16 in a peak/);
  });

  it("stutters on a drop that is about to land, on its bar line", () => {
    const a = analysis({ buildDropPairs: [{ buildAtSec: 60, dropAtSec: 120 }], waveformPeaks: Array.from({ length: 400 }, (_, i) => (i < 100 ? 0.15 : 0.95)) });
    const m = planStutter(ctx({ analysis: a, currentTimeSec: 118.6 }))!;
    expect(m.where).toBe("drop");
    expect(m.startSec).toBeCloseTo(120, 3);
    expect(isOnBeat(a, m.startSec)).toBe(true);
    expect(m.reason).toMatch(/on the drop/);
  });

  it("does nothing outside a peak or drop, or with no usable tempo or waveform", () => {
    expect(planStutter(ctx({ currentTimeSec: 100.1 }))).toBeNull(); // the middle of the song, 41% in: mid energy
    expect(planStutter(ctx({ currentTimeSec: 10 }))).toBeNull(); // the quiet start
    expect(planStutter(ctx({ analysis: analysis({ fallback: true }) }))).toBeNull();
    expect(planStutter(ctx({ analysis: analysis({ bpm: 50 }) }))).toBeNull();
    expect(planStutter(ctx({ analysis: analysis({ waveformPeaks: Array(400).fill(0.9) }) }))).toBeNull();
  });
});

describe("planStutter: rate limit, genre and occasion", () => {
  it("allows no more than one every 16 bars at the highest frequency", () => {
    const sixteen = barsToSec(STUTTER_MIN_GAP_BARS, BPM);
    expect(planStutter(ctx({ currentTimeSec: 200.1, lastMoveAtSec: 200.1 - sixteen + 1 }))).toBeNull();
    expect(planStutter(ctx({ currentTimeSec: 200.1, lastMoveAtSec: 200.1 - sixteen }))).not.toBeNull();
  });
  it("waits longer at a lower frequency, and longer again for a genre it does not favour", () => {
    expect(stutterGapBars(1, "Hip-Hop")).toBe(16);
    expect(stutterGapBars(0, "Hip-Hop")).toBe(64);
    expect(stutterGapBars(1, "Electronic")).toBe(16);
    expect(stutterGapBars(1, "Country")).toBeGreaterThan(stutterGapBars(1, "Hip-Hop"));
    expect(stutterGapBars(0.5, "Hip-Hop")).toBeGreaterThan(stutterGapBars(1, "Hip-Hop"));
    for (const f of [0, 0.25, 0.5, 1]) expect(stutterGapBars(f, "Hip-Hop")).toBeGreaterThanOrEqual(STUTTER_MIN_GAP_BARS);
  });
  it("hits harder for a party and a favoured genre, softer for a wedding or an unfavoured genre", () => {
    expect(planStutter(ctx({ currentTimeSec: 200.1, mode: "party", genre: "Hip-Hop" }))!.note).toBe("1/16");
    expect(planStutter(ctx({ currentTimeSec: 200.1, mode: "wedding", genre: "Hip-Hop" }))!.note).toBe("1/4");
    expect(planStutter(ctx({ currentTimeSec: 200.1, mode: "party", genre: "Country" }))!.note).toBe("1/4");
    expect(planStutter(ctx({ currentTimeSec: 200.1, mode: "open-format", genre: "Hip-Hop" }))!.note).toBe("1/8");
    expect(noteForIntensity(0.9)).toBe("1/16");
    expect(noteForIntensity(0.6)).toBe("1/8");
    expect(noteForIntensity(0.2)).toBe("1/4");
  });
  it("is never random: the same moment plans the same stutter", () => {
    const first = planStutter(ctx({ currentTimeSec: 200.1 }));
    for (let i = 0; i < 20; i++) expect(planStutter(ctx({ currentTimeSec: 200.1 }))).toEqual(first);
  });
});

class FakeParam implements ParamLike {
  value: number;
  calls: [string, ...number[]][] = [];
  constructor(value = 0) {
    this.value = value;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(["cancel", t]);
  }
  setValueAtTime(v: number, t: number) {
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(["ramp", v, t]);
  }
}

describe("scheduleStutter: automation on the audio clock", () => {
  const a = analysis();
  const move = planStutter(ctx({ analysis: a, currentTimeSec: 200.1 }))!;
  const target = () => ({ delaySendGain: new FakeParam(), delayTime: new FakeParam(), feedbackGain: new FakeParam(), dryGain: new FakeParam(1) });
  const restore = { delayTime: 0.3, feedback: 0.4, send: 0, dry: 1 };

  it("sets the delay to the slice at the start, sends one slice into it, then mutes the dry while the feedback loops it", () => {
    const t = target();
    scheduleStutter(t, move, 50, 49, restore);
    expect(t.delayTime.calls).toContainEqual(["set", move.sliceSec, 50]);
    expect(t.delaySendGain.calls).toContainEqual(["set", 1, 50]);
    expect(t.delaySendGain.calls).toContainEqual(["ramp", 0, 50 + move.sliceSec]);
    expect(t.feedbackGain.calls).toContainEqual(["set", 0.96, 50]);
    expect(t.dryGain.calls).toContainEqual(["ramp", 0, 50 + move.sliceSec]);
  });

  it("puts the dry signal back at the end, before the echo is put as it was", () => {
    const t = target();
    scheduleStutter(t, move, 50, 49, restore);
    const end = 50 + move.durationSec;
    expect(t.dryGain.calls).toContainEqual(["ramp", 1, end]);
    expect(t.feedbackGain.calls).toContainEqual(["ramp", 0.4, end + 0.02]);
    expect(t.delayTime.calls).toContainEqual(["set", 0.3, end + 0.05]);
  });

  it("never starts in the past", () => {
    const t = target();
    scheduleStutter(t, move, 10, 20, restore);
    expect(t.delayTime.calls[0]).toEqual(["cancel", 20]);
  });
});

describe("the stutter note a person picks", () => {
  it("stutterNoteFor turns a Settings value into a fixed note, and auto or anything else into null", () => {
    expect(stutterNoteFor("1/4")).toBe("1/4");
    expect(stutterNoteFor("1/8")).toBe("1/8");
    expect(stutterNoteFor("1/16")).toBe("1/16");
    expect(stutterNoteFor("auto")).toBeNull();
    expect(stutterNoteFor("1/3")).toBeNull();
    expect(stutterNoteFor(undefined)).toBeNull();
  });
  it("an automatic stutter repeats the picked note instead of the occasion's, still two beats long and on the beat", () => {
    const a = analysis();
    // Hip-Hop at a party would choose 1/16 (see the first test); a picked 1/4 wins over it.
    for (const [note, beats] of [["1/4", 1], ["1/8", 0.5], ["1/16", 0.25]] as const) {
      const m = planStutter(ctx({ analysis: a, currentTimeSec: 200.1, note }))!;
      expect(m.note).toBe(note);
      expect(m.sliceSec).toBeCloseTo(beats * BEAT, 6);
      expect(m.repeats).toBe(Math.round(STUTTER_BEATS / beats));
      expect(m.sliceSec * m.repeats).toBeCloseTo(STUTTER_BEATS * BEAT, 6);
      expect(isOnBeat(a, m.startSec)).toBe(true);
      expect(m.reason).toContain(`${note} in a peak`);
    }
  });
  it("a null note leaves the choice to the occasion and genre", () => {
    expect(planStutter(ctx({ currentTimeSec: 200.1, note: null }))!.note).toBe("1/16");
  });
  it("the button uses the picked note too", () => {
    const a = analysis();
    expect(manualStutter({ analysis: a, currentTimeSec: 10.1, mode: "party", genre: "Hip-Hop", note: "1/4" })!.note).toBe("1/4");
    expect(manualStutter({ analysis: a, currentTimeSec: 10.1, mode: "party", genre: "Hip-Hop", note: null })!.note).toBe("1/16");
  });
});

describe("manualStutter (the button on the DJ board)", () => {
  it("stutters on the next beat whatever the energy, with the note the occasion calls for", () => {
    const a = analysis();
    const m = manualStutter({ analysis: a, currentTimeSec: 10.1, mode: "party", genre: "Hip-Hop" })!;
    expect(isOnBeat(a, m.startSec)).toBe(true);
    expect(m.startSec).toBeGreaterThanOrEqual(10.1);
    expect(m.note).toBe("1/16");
    expect(m.reason).toMatch(/manual/);
  });
  it("does nothing without a usable tempo", () => {
    expect(manualStutter({ analysis: analysis({ fallback: true }), currentTimeSec: 10 })).toBeNull();
  });
});

describe("no stutter near the end of a song, where the mix out begins", () => {
  it("is refused in the last thirty seconds, allowed just before them", () => {
    const a = analysis();
    expect(planStutter(ctx({ analysis: a, currentTimeSec: 240 - STUTTER_END_GUARD_SEC + 1 }))).toBeNull();
    expect(planStutter(ctx({ analysis: a, currentTimeSec: 240 - STUTTER_END_GUARD_SEC - 2 }))).not.toBeNull();
  });
  it("applies to the button too, when the song's length is known", () => {
    const a = analysis();
    expect(manualStutter({ analysis: a, currentTimeSec: 230, durationSec: 240 })).toBeNull();
    expect(manualStutter({ analysis: a, currentTimeSec: 100, durationSec: 240 })).not.toBeNull();
  });
});
