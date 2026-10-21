import { describe, expect, it } from "vitest";
import {
  SONG_SYNC_CROSSFADE_BARS,
  SONG_SYNC_CROSSFADE_STEPS,
  SONG_SYNC_MAX_PITCH_SEMITONES,
  SONG_SYNC_MAX_RATE_DELTA,
  SONG_SYNC_MIN_MORPH_BARS,
  PHASE_READINGS_AVERAGED,
  addPhaseReading,
  averagedPhaseError,
  beatsUntilMixOut,
  describeSongSyncBpmRow,
  describeSongSyncHeadline,
  describeSongSyncKeyRow,
  describeSongSyncPlanLine,
  fitMorphToRoom,
  initialSongSyncStatus,
  morphBarsForBpmDelta,
  morphBarsForPitchShift,
  morphRealSeconds,
  planSongSync,
  sectionLabelAt,
  songSyncCrossfadeCurves,
  songSyncCrossfadeGainsAt,
  songSyncLeadBeats,
  songSyncMixOutSec,
  songSyncStateAt,
  songSyncTrigger,
  type SongSyncPlan,
} from "./songSync";
import { MAX_ACTIVE_PLAY_SEC } from "./mix-engine";
import { TRANSITION_FX_ENABLED, buildSyncReport, semitonesToMatchCamelotNumber, shiftCamelot, planKey } from "./syncEngine";
import type { TrackAnalysis } from "./audio-analysis";
import type { SongMap } from "./song-map";
import type { Track } from "@/types/music";

function makeTrack(id: string, durationSec = 200): Track {
  return { id, title: id, artist: "Test Artist", durationSec, addedAt: 0, source: "local", sourceUrl: `blob:${id}` };
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

const reportFor = (a: Partial<TrackAnalysis>, b: Partial<TrackAnalysis>) =>
  buildSyncReport({
    current: { track: makeTrack("a"), analysis: makeAnalysis(a) },
    next: { track: makeTrack("b"), analysis: makeAnalysis(b) },
  });

function planOf(a: Partial<TrackAnalysis>, b: Partial<TrackAnalysis>, overrides = {}): SongSyncPlan {
  const result = planSongSync(reportFor(a, b), overrides);
  if (!result.ok) throw new Error(`no plan: ${result.reason}`);
  return result.plan;
}

describe("TRANSITION_FX_ENABLED", () => {
  it("is off: Song Sync Mode is only the two songs until FX are brought back on purpose", () => {
    expect(TRANSITION_FX_ENABLED).toBe(false);
  });
});

describe("morphBarsForBpmDelta", () => {
  it("spreads a bigger tempo move over more bars", () => {
    expect(morphBarsForBpmDelta(0)).toBe(4);
    expect(morphBarsForBpmDelta(2)).toBe(4);
    expect(morphBarsForBpmDelta(2.1)).toBe(8);
    expect(morphBarsForBpmDelta(6)).toBe(8);
    expect(morphBarsForBpmDelta(6.5)).toBe(12);
    expect(morphBarsForBpmDelta(12)).toBe(12);
    expect(morphBarsForBpmDelta(12.5)).toBe(16);
    expect(morphBarsForBpmDelta(-9)).toBe(12);
  });
});

describe("morphBarsForPitchShift", () => {
  it("needs no bars for no shift and more for a bigger one", () => {
    expect(morphBarsForPitchShift(0)).toBe(0);
    expect(morphBarsForPitchShift(2)).toBe(4);
    expect(morphBarsForPitchShift(-3)).toBe(8);
    expect(morphBarsForPitchShift(6)).toBe(12);
  });
});

describe("semitonesToMatchCamelotNumber", () => {
  it("lands A on B's number for every pair, by the shortest way", () => {
    for (let a = 1; a <= 12; a++) {
      for (let b = 1; b <= 12; b++) {
        const s = semitonesToMatchCamelotNumber(a, b);
        expect(Math.abs(s)).toBeLessThanOrEqual(6);
        expect(shiftCamelot(`${a}A`, s)).toBe(`${b}A`);
      }
    }
    expect(semitonesToMatchCamelotNumber(8, 8)).toBe(0);
  });

  it("matches the example: A minor (8A) to C minor (5A) is +3 semitones", () => {
    expect(semitonesToMatchCamelotNumber(8, 5)).toBe(3);
  });
});

describe("planKey's morphPitchShiftSemitones", () => {
  const key = (camelotKey: string, keyConfidence = 0.6) => ({ camelotKey, key: camelotKey, keyConfidence });

  it("is the exact shift for a clashing pair (8A to 5A: +3)", () => {
    expect(planKey(key("8A"), key("5A")).morphPitchShiftSemitones).toBe(3);
  });

  it("is zero when the keys already mix (same, relative, or adjacent)", () => {
    expect(planKey(key("8A"), key("8A")).morphPitchShiftSemitones).toBe(0);
    expect(planKey(key("8A"), key("8B")).morphPitchShiftSemitones).toBe(0);
    expect(planKey(key("8A"), key("9A")).morphPitchShiftSemitones).toBe(0);
  });

  it("is zero when a key is unknown or not trusted", () => {
    expect(planKey(key("8A"), key("5A", 0.01)).morphPitchShiftSemitones).toBe(0);
    expect(planKey({ camelotKey: null, key: null, keyConfidence: 0 }, key("5A")).morphPitchShiftSemitones).toBe(0);
  });
});

describe("planSongSync", () => {
  it("builds the example plan: 128 -> 132 BPM, A minor -> C minor", () => {
    const plan = planOf({ bpm: 128, camelotKey: "8A" }, { bpm: 132, camelotKey: "5A" });
    expect(plan.bpmFrom).toBe(128);
    expect(plan.bpmTo).toBe(132);
    expect(plan.rateTarget).toBeCloseTo(132 / 128);
    expect(plan.direction).toBe("faster");
    expect(plan.pitchTargetSemitones).toBe(3);
    // 4 BPM apart -> 8 bars
    expect(plan.morphBars).toBe(8);
  });

  it("slows A down when B is slower", () => {
    const plan = planOf({ bpm: 132 }, { bpm: 126, camelotKey: "8A" });
    expect(plan.direction).toBe("slower");
    expect(plan.rateTarget).toBeCloseTo(126 / 132);
  });

  it("holds the tempo within half a BPM and skips the tempo move", () => {
    const plan = planOf({ bpm: 128 }, { bpm: 128.3 });
    expect(plan.direction).toBe("hold");
    expect(plan.rateTarget).toBe(1);
    expect(plan.bpmTo).toBe(128);
  });

  it("folds a half- or double-time partner onto A's octave", () => {
    const plan = planOf({ bpm: 128 }, { bpm: 66 });
    expect(plan.bpmTo).toBeCloseTo(132);
    expect(plan.bpmB).toBe(66);
    expect(plan.direction).toBe("faster");
  });

  it("uses more bars for a bigger tempo gap", () => {
    expect(planOf({ bpm: 120 }, { bpm: 121 }).morphBars).toBe(4);
    expect(planOf({ bpm: 120 }, { bpm: 130 }).morphBars).toBe(12);
    expect(planOf({ bpm: 100 }, { bpm: 115 }).morphBars).toBe(16);
  });

  it("gives a pitch move enough bars even when the tempos agree", () => {
    const plan = planOf({ bpm: 128, camelotKey: "8A" }, { bpm: 128, camelotKey: "2A" });
    expect(Math.abs(plan.pitchTargetSemitones)).toBe(6);
    expect(plan.morphBars).toBeGreaterThanOrEqual(12);
  });

  it("leaves compatible or unknown keys unshifted", () => {
    expect(planOf({ camelotKey: "8A" }, { camelotKey: "9A" }).pitchTargetSemitones).toBe(0);
    expect(planOf({ camelotKey: "8A" }, { camelotKey: null, key: null, keyConfidence: 0 }).pitchTargetSemitones).toBe(0);
  });

  it("refuses without a trusted tempo on both sides", () => {
    expect(planSongSync(reportFor({ bpmConfidence: 0.05 }, {}))).toEqual({ ok: false, reason: "tempo-unknown" });
    expect(planSongSync(reportFor({}, { bpm: 0, bpmConfidence: 0 }))).toEqual({ ok: false, reason: "tempo-unknown" });
  });

  it("refuses a tempo gap beyond the morph limit", () => {
    // 128 vs 175: ratio 1.37 (and not an octave): too far to morph
    expect(planSongSync(reportFor({ bpm: 128 }, { bpm: 175 }))).toEqual({ ok: false, reason: "tempo-gap" });
    expect(SONG_SYNC_MAX_RATE_DELTA).toBeLessThan(0.3);
  });

  it("applies the AI's overrides within limits", () => {
    const base = { bpm: 128, camelotKey: "8A" };
    const plan = planOf(base, { bpm: 132, camelotKey: "5A" }, { morphBars: 16, pitchShiftSemitones: 2 });
    expect(plan.morphBars).toBe(16);
    expect(plan.pitchTargetSemitones).toBe(2);
    const wild = planOf(base, { bpm: 132, camelotKey: "5A" }, { morphBars: 99, pitchShiftSemitones: 40 });
    expect(wild.morphBars).toBe(16);
    expect(wild.pitchTargetSemitones).toBe(SONG_SYNC_MAX_PITCH_SEMITONES);
  });
});

describe("fitMorphToRoom", () => {
  const plan = planOf({ bpm: 128 }, { bpm: 132 }); // 8 bars; a bar is 1.875 s
  const bar = (4 * 60) / 128;

  it("keeps the plan when there is room for the morph, a slack bar and the crossfade", () => {
    expect(fitMorphToRoom(plan, (8 + SONG_SYNC_CROSSFADE_BARS + 1) * bar + 0.1)).toBe(plan);
  });

  it("shortens the morph to what fits", () => {
    const fitted = fitMorphToRoom(plan, (5 + SONG_SYNC_CROSSFADE_BARS + 1) * bar + 0.1);
    expect(fitted?.morphBars).toBe(5);
  });

  it("gives up when even the shortest morph doesn't fit", () => {
    expect(fitMorphToRoom(plan, (SONG_SYNC_MIN_MORPH_BARS - 1 + SONG_SYNC_CROSSFADE_BARS + 1) * bar)).toBeNull();
  });
});

describe("songSyncStateAt", () => {
  const plan = planOf({ bpm: 128, camelotKey: "8A" }, { bpm: 132, camelotKey: "5A" });

  it("starts untouched and arrives exactly on B's tempo and pitch", () => {
    const start = songSyncStateAt(plan, 0);
    expect(start.rate).toBe(1);
    expect(start.bpm).toBe(128);
    expect(start.pitchSemitones).toBe(0);
    const end = songSyncStateAt(plan, plan.morphBars);
    expect(end.rate).toBeCloseTo(132 / 128, 10);
    expect(end.bpm).toBeCloseTo(132, 10);
    expect(end.pitchSemitones).toBeCloseTo(3, 10);
  });

  it("moves tempo and pitch together, evenly per bar", () => {
    const perBar = (plan.rateTarget - 1) / plan.morphBars;
    expect(songSyncStateAt(plan, 3).rate).toBeCloseTo(1 + perBar * 3, 10);
    expect(songSyncStateAt(plan, 3).pitchSemitones).toBeCloseTo((3 / plan.morphBars) * 3, 10);
    expect(songSyncStateAt(plan, plan.morphBars / 2).progress).toBeCloseTo(0.5);
  });

  it("never overshoots, before or after the morph", () => {
    expect(songSyncStateAt(plan, -2).rate).toBe(1);
    expect(songSyncStateAt(plan, plan.morphBars + 5).rate).toBeCloseTo(plan.rateTarget);
  });

  it("matches the readout example: bar 3 of 8 at 128 -> 132 is 129.5 BPM", () => {
    expect(songSyncStateAt(plan, 3).bpm).toBeCloseTo(128 + (4 * 3) / 8, 10);
  });
});

describe("morphRealSeconds", () => {
  const barSrc = (4 * 60) / 128;

  it("is the plain bar length when the tempo holds", () => {
    const hold = planOf({ bpm: 128 }, { bpm: 128 });
    expect(morphRealSeconds(hold, 0, 4, barSrc)).toBeCloseTo(4 * barSrc, 6);
  });

  it("takes less clock time when A speeds up and more when it slows down", () => {
    const up = planOf({ bpm: 128 }, { bpm: 138 });
    const down = planOf({ bpm: 138 }, { bpm: 128 });
    const upSec = morphRealSeconds(up, 0, up.morphBars, barSrc);
    expect(upSec).toBeLessThan(up.morphBars * barSrc);
    expect(upSec).toBeGreaterThan((up.morphBars * barSrc) / up.rateTarget);
    const barSrcDown = (4 * 60) / 138;
    expect(morphRealSeconds(down, 0, down.morphBars, barSrcDown)).toBeGreaterThan(down.morphBars * barSrcDown);
  });

  it("is additive across a split and zero for an empty span", () => {
    const plan = planOf({ bpm: 128 }, { bpm: 134 });
    const whole = morphRealSeconds(plan, 0, plan.morphBars, barSrc);
    const split = morphRealSeconds(plan, 0, 3, barSrc) + morphRealSeconds(plan, 3, plan.morphBars, barSrc);
    expect(split).toBeCloseTo(whole, 3);
    expect(morphRealSeconds(plan, 2, 2, barSrc)).toBe(0);
  });
});

describe("the crossfade", () => {
  it("follows the table on every downbeat", () => {
    expect(songSyncCrossfadeGainsAt(0)).toEqual({ a: 1, b: 0 });
    const at = (bars: number) => songSyncCrossfadeGainsAt(bars);
    expect(at(1).a).toBeCloseTo(0.75);
    expect(at(1).b).toBeCloseTo(0.25);
    expect(at(2).a).toBeCloseTo(0.4);
    expect(at(2).b).toBeCloseTo(0.6);
    expect(at(3).a).toBeCloseTo(0.1);
    expect(at(3).b).toBeCloseTo(0.9);
    expect(at(4)).toEqual({ a: 0, b: 1 });
  });

  it("runs straight between downbeats", () => {
    expect(songSyncCrossfadeGainsAt(0.5).a).toBeCloseTo(0.875);
    expect(songSyncCrossfadeGainsAt(1.5).b).toBeCloseTo(0.425);
  });

  it("clamps outside the window", () => {
    expect(songSyncCrossfadeGainsAt(-1)).toEqual({ a: 1, b: 0 });
    expect(songSyncCrossfadeGainsAt(9)).toEqual({ a: 0, b: 1 });
  });

  it("has A falling and B rising the whole way, ending with A silent and B full", () => {
    for (let i = 1; i < SONG_SYNC_CROSSFADE_STEPS.length; i++) {
      const [, aEnd, , bEnd] = SONG_SYNC_CROSSFADE_STEPS[i - 1];
      const [aStart, , bStart] = SONG_SYNC_CROSSFADE_STEPS[i];
      expect(aStart).toBe(aEnd); // each bar picks up where the last stopped
      expect(bStart).toBe(bEnd);
    }
    const { a, b } = songSyncCrossfadeCurves();
    for (let i = 1; i < a.length; i++) {
      expect(a[i]).toBeLessThanOrEqual(a[i - 1] + 1e-6);
      expect(b[i]).toBeGreaterThanOrEqual(b[i - 1] - 1e-6);
    }
    expect(a[0]).toBe(1);
    expect(a[a.length - 1]).toBe(0);
    expect(b[0]).toBe(0);
    expect(b[b.length - 1]).toBe(1);
  });
});

describe("when an automatic sync starts", () => {
  it("leads by the morph plus the 4-bar crossfade", () => {
    expect(songSyncLeadBeats(8)).toBe(8 * 4 + 16);
    expect(songSyncLeadBeats(4)).toBe(32);
  });

  it("mixes out by the end of the file, never past the engine's cap", () => {
    expect(songSyncMixOutSec(100)).toBe(100);
    expect(songSyncMixOutSec(400)).toBe(MAX_ACTIVE_PLAY_SEC);
    // 128 BPM: 150 s cap, 100 s in -> 50 s left
    expect(beatsUntilMixOut(100, 400, 128)).toBeCloseTo(50 / (60 / 128), 6);
    expect(beatsUntilMixOut(160, 400, 128)).toBeLessThan(0);
  });

  it("waits until the lead is all that is left", () => {
    expect(songSyncTrigger({ beatsUntilMixOut: 60, morphBars: 8, section: "body" })).toBe("wait");
    expect(songSyncTrigger({ beatsUntilMixOut: 48.1, morphBars: 8, section: "body" })).toBe("wait");
    expect(songSyncTrigger({ beatsUntilMixOut: 48, morphBars: 8, section: "body" })).toBe("start");
    expect(songSyncTrigger({ beatsUntilMixOut: 30, morphBars: 8, section: null })).toBe("start");
  });

  it("holds off inside a drop while there is slack, then starts anyway", () => {
    expect(songSyncTrigger({ beatsUntilMixOut: 48, morphBars: 8, section: "drop" })).toBe("wait");
    expect(songSyncTrigger({ beatsUntilMixOut: 41, morphBars: 8, section: "drop" })).toBe("wait");
    expect(songSyncTrigger({ beatsUntilMixOut: 40, morphBars: 8, section: "drop" })).toBe("start");
  });

  it("forces the start once the mix-out point has passed, whatever the section", () => {
    expect(songSyncTrigger({ beatsUntilMixOut: -4, morphBars: 8, section: "drop" })).toBe("start");
  });

  it("finds the section the playhead is in", () => {
    const map = {
      sections: [
        { startSec: 0, endSec: 20, label: "intro", energy: 0.3, confidence: 1 },
        { startSec: 20, endSec: 60, label: "drop", energy: 1, confidence: 1 },
      ],
    } as unknown as SongMap;
    expect(sectionLabelAt(map, 5)).toBe("intro");
    expect(sectionLabelAt(map, 20)).toBe("drop");
    expect(sectionLabelAt(map, 61)).toBeNull();
    expect(sectionLabelAt(null, 5)).toBeNull();
  });
});

describe("what the DJ board says", () => {
  const plan = planOf({ bpm: 128, key: "A minor", camelotKey: "8A" }, { bpm: 132, key: "C minor", camelotKey: "5A" });

  it("heads the plan with both tracks' tempo and key", () => {
    expect(describeSongSyncHeadline(plan)).toBe("A: 128.00 BPM / A minor  →  B: 132.00 BPM / C minor");
  });

  it("words the plan: speed up, how much, how long, and the pitch move", () => {
    expect(describeSongSyncPlanLine(plan)).toBe("Plan: speed up +3.1% over 8 bars, shift pitch +3 semitones");
    const slow = planOf({ bpm: 132, camelotKey: "8A" }, { bpm: 126, camelotKey: "8A" });
    expect(describeSongSyncPlanLine(slow)).toBe("Plan: slow down -4.5% over 8 bars");
    const hold = planOf({ bpm: 128 }, { bpm: 128 });
    expect(describeSongSyncPlanLine(hold)).toBe("Plan: hold the tempo for 4 bars");
  });

  it("reports the live bar and tempo, and the pitch so far", () => {
    const status = { ...initialSongSyncStatus(plan, "B"), bar: 3, bpmNow: 129.5, pitchNow: 1.5 };
    expect(describeSongSyncBpmRow(status)).toBe("Bar 3 of 8 — 129.50 BPM");
    expect(describeSongSyncKeyRow(status)).toBe("+1.5 of +3 semitones");
  });

  it("starts a status at the plan's own numbers", () => {
    const s = initialSongSyncStatus(plan, "Midnight Pulse");
    expect(s.phase).toBe("analyzing");
    expect(s.nextTitle).toBe("Midnight Pulse");
    expect(s.bar).toBe(0);
    expect(s.bpmNow).toBe(128);
    expect(s.pitchNow).toBe(0);
    expect(s.phaseErrorMs).toBeNull();
    expect(s.listenerNote).toBeNull();
  });
});

describe("phase readings", () => {
  it("keeps only the latest few readings", () => {
    let readings: number[] = [];
    for (let i = 1; i <= PHASE_READINGS_AVERAGED + 3; i++) readings = addPhaseReading(readings, i);
    expect(readings).toHaveLength(PHASE_READINGS_AVERAGED);
    expect(readings[readings.length - 1]).toBe(PHASE_READINGS_AVERAGED + 3);
    expect(readings[0]).toBe(4);
  });

  it("does not hand back an average until it has enough readings", () => {
    expect(averagedPhaseError([])).toBeNull();
    expect(averagedPhaseError([0.01, 0.01, 0.01])).toBeNull();
  });

  it("averages jittery readings down to their centre", () => {
    const jitter = [-0.0112, -0.0098, -0.0141, -0.0083, -0.0127, -0.0099];
    const mean = averagedPhaseError(jitter) as number;
    expect(mean).toBeCloseTo(-0.01100, 4);
    // each reading is off by up to 3 ms from the centre, the mean by far less
    expect(Math.max(...jitter.map((j) => Math.abs(j - mean)))).toBeGreaterThan(0.002);
  });
});
