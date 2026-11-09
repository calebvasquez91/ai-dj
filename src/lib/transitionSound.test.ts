import { describe, expect, it } from "vitest";
import { nextGridPointAfter } from "@/lib/vocalMashup";
import type { FxSound } from "@/types/music";
import {
  TRANSITION_SOUND_SOLO_SEC,
  camelotFromFxKey,
  chooseTransitionSound,
  eligibleTransitionSounds,
  encodeWav16,
  fxIdOfTransitionTrack,
  isTransitionTrack,
  leadingSilenceSamples,
  makeTransitionTrack,
  planLeg,
  planTransitionLoop,
  renderTransitionLoop,
  transitionAnalysis,
} from "./transitionSound";

function fx(over: Partial<FxSound> & { id: string }): FxSound {
  return {
    name: over.id,
    fileName: `${over.id}.wav`,
    sourceUrl: `/fx/${over.id}`,
    mimeType: "audio/wav",
    category: "transition",
    durationSec: 6,
    tags: [],
    playlistAffinity: [],
    addedAt: 0,
    ...over,
  };
}

const song = (bpm: number, camelotKey: string | null = null, bpmConfidence = 0.8) => ({
  bpm,
  bpmConfidence,
  key: null,
  keyConfidence: camelotKey ? 0.8 : 0,
  camelotKey,
});

describe("eligibleTransitionSounds", () => {
  const library = [
    fx({ id: "t", category: "transition" }),
    fx({ id: "l", category: "loop" }),
    fx({ id: "v", category: "vocal" }),
    fx({ id: "e", category: "effect" }),
    fx({ id: "b", category: "background" }),
    fx({ id: "click", category: "transition", durationSec: 0.1 }),
    fx({ id: "ht", category: "transition", tags: ["halloween"] }),
    fx({ id: "hl", category: "loop", playlistAffinity: ["spooky"] }),
  ];

  it("outside Spooky Music: transitions, loops and vocals, never Halloween ones, never effects or backgrounds", () => {
    expect(eligibleTransitionSounds(library, false).map((f) => f.id)).toEqual(["t", "l", "v"]);
  });

  it("in Spooky Music: only the Halloween ones, still only the right categories", () => {
    expect(eligibleTransitionSounds(library, true).map((f) => f.id)).toEqual(["ht", "hl"]);
  });

  it("drops a sound with no file or a bad length", () => {
    expect(eligibleTransitionSounds([fx({ id: "x", sourceUrl: "" }), fx({ id: "y", durationSec: Number.NaN })], false)).toEqual([]);
  });
});

describe("camelotFromFxKey", () => {
  it("reads Camelot codes, named keys and shorthand", () => {
    expect(camelotFromFxKey("8a")).toBe("8A");
    expect(camelotFromFxKey("12B")).toBe("12B");
    expect(camelotFromFxKey("A minor")).toBe("8A");
    expect(camelotFromFxKey("Am")).toBe("8A");
    expect(camelotFromFxKey("C")).toBe("8B");
    expect(camelotFromFxKey("F#min")).toBe("11A");
    expect(camelotFromFxKey("Db")).toBe(camelotFromFxKey("C#"));
  });

  it("gives null for nothing it can read", () => {
    expect(camelotFromFxKey(undefined)).toBeNull();
    expect(camelotFromFxKey("")).toBeNull();
    expect(camelotFromFxKey("13A")).toBeNull();
    expect(camelotFromFxKey("wobbly")).toBeNull();
  });
});

describe("chooseTransitionSound", () => {
  const first = () => 0;

  it("needs a trusted tempo on both songs", () => {
    const sounds = [fx({ id: "s", bpm: 128 })];
    expect(chooseTransitionSound({ sounds, a: song(128, null, 0.05), b: song(128), random: first })).toBeNull();
    expect(chooseTransitionSound({ sounds, a: song(128), b: song(0), random: first })).toBeNull();
  });

  it("returns null with nothing to choose from", () => {
    expect(chooseTransitionSound({ sounds: [], a: song(128), b: song(128), random: first })).toBeNull();
  });

  it("skips a sound whose tempo is too far from A or from B to morph", () => {
    const sounds = [fx({ id: "far", bpm: 140 })]; // not an octave of 100, so it cannot fold into range
    expect(chooseTransitionSound({ sounds, a: song(100), b: song(100), random: first })).toBeNull();
    // Reachable from A but not on to B:
    expect(chooseTransitionSound({ sounds: [fx({ id: "mid", bpm: 120 })], a: song(110), b: song(165), random: first })).toBeNull();
  });

  it("prefers the sound with a tempo of its own over one without", () => {
    const sounds = [fx({ id: "none" }), fx({ id: "own", bpm: 126 })];
    const choice = chooseTransitionSound({ sounds, a: song(124), b: song(128), random: first });
    expect(choice?.sound.id).toBe("own");
    expect(choice?.tempoSource).toBe("library");
    expect(choice?.bpm).toBe(126);
  });

  it("lays a sound with no tempo at A's tempo, so A holds and only B is morphed onto", () => {
    const choice = chooseTransitionSound({ sounds: [fx({ id: "none" })], a: song(124), b: song(130), random: first });
    expect(choice?.tempoSource).toBe("follows-previous");
    expect(choice?.bpm).toBe(124);
    expect(choice?.entryPlan.direction).toBe("hold");
    expect(choice?.exitPlan.bpmTo).toBeCloseTo(130, 5);
  });

  it("carries the sound's key into the plans: A is asked to move onto it", () => {
    const choice = chooseTransitionSound({ sounds: [fx({ id: "k", bpm: 124, key: "9A" })], a: song(124, "8A"), b: song(124, "9A"), random: first });
    expect(choice?.camelotKey).toBe("9A");
  });

  it("avoids a sound used recently when another is as good", () => {
    const sounds = [fx({ id: "one", bpm: 126 }), fx({ id: "two", bpm: 126 })];
    const choice = chooseTransitionSound({ sounds, a: song(126), b: song(126), recentFxIds: ["one"], random: first });
    expect(choice?.sound.id).toBe("two");
  });

  it("picks among the best few with the random number", () => {
    const sounds = [fx({ id: "a", bpm: 126 }), fx({ id: "b", bpm: 127 }), fx({ id: "c", bpm: 128 }), fx({ id: "d", bpm: 129 })];
    const lowest = chooseTransitionSound({ sounds, a: song(126), b: song(126), random: () => 0 });
    const highest = chooseTransitionSound({ sounds, a: song(126), b: song(126), random: () => 0.999 });
    expect(lowest?.sound.id).toBe("a");
    expect(highest?.sound.id).not.toBe("d"); // only the best three are in the pool
    expect(highest?.sound.id).toBe("c");
  });
});

describe("planTransitionLoop", () => {
  it("fills about thirty seconds of sound between the entry and the exit, in whole phrases", () => {
    const layout = planTransitionLoop({ bpm: 128, soundDurationSec: 6, exitMorphBars: 4 });
    expect(layout.barSec).toBeCloseTo(1.875, 6);
    expect(layout.soloBars * layout.barSec).toBeGreaterThanOrEqual(TRANSITION_SOUND_SOLO_SEC);
    expect(layout.soloBars * layout.barSec).toBeLessThan(TRANSITION_SOUND_SOLO_SEC + layout.barSec);
    expect(layout.totalBars % 4).toBe(0);
    expect(layout.totalBars).toBeGreaterThanOrEqual(layout.leadInBars + layout.soloBars + layout.exitBars);
    expect(layout.totalSec).toBeCloseTo(layout.totalBars * layout.barSec, 9);
  });

  it("repeats on the smallest whole number of bars that holds the sound", () => {
    // 128 bpm: a bar is 1.875 s. 6 s needs 4 bars (7.5 s); 1 s fits in one bar.
    expect(planTransitionLoop({ bpm: 128, soundDurationSec: 6, exitMorphBars: 4 }).unitBars).toBe(4);
    expect(planTransitionLoop({ bpm: 128, soundDurationSec: 1, exitMorphBars: 4 }).unitBars).toBe(1);
    expect(planTransitionLoop({ bpm: 128, soundDurationSec: 15, exitMorphBars: 4 }).unitBars).toBe(8);
  });

  it("leaves a lead-in of bars past the 4 s the sync engine skips", () => {
    for (const bpm of [70, 96, 128, 174]) {
      const layout = planTransitionLoop({ bpm, soundDurationSec: 5, exitMorphBars: 4 });
      expect(layout.leadInBars * layout.barSec).toBeGreaterThanOrEqual(4);
    }
  });

  it("gives a wider exit morph more room", () => {
    const short = planTransitionLoop({ bpm: 128, soundDurationSec: 5, exitMorphBars: 2 });
    const long = planTransitionLoop({ bpm: 128, soundDurationSec: 5, exitMorphBars: 16 });
    expect(long.totalBars).toBeGreaterThan(short.totalBars);
  });

  it("falls back to 120 bpm for a bad tempo", () => {
    expect(planTransitionLoop({ bpm: 0, soundDurationSec: 5, exitMorphBars: 4 }).bpm).toBe(120);
  });
});

describe("renderTransitionLoop", () => {
  const sr = 1000; // a tiny rate keeps the arrays small; the maths is the same

  it("finds the first loud sample", () => {
    const quiet = new Float32Array(100);
    quiet[40] = 0.5;
    expect(leadingSilenceSamples([quiet])).toBe(40);
    expect(leadingSilenceSamples([new Float32Array(10)])).toBe(0);
  });

  it("repeats the sound at the start of every unit and trims leading silence", () => {
    const layout = planTransitionLoop({ bpm: 240, soundDurationSec: 0.9, exitMorphBars: 2 }); // a bar is 1 s
    expect(layout.unitBars).toBe(1);
    const src = new Float32Array(sr);
    for (let i = 100; i < 700; i++) src[i] = 0.5; // 100 ms of silence, then 600 ms of sound
    const [left, right] = renderTransitionLoop([src], sr, layout);
    expect(left.length).toBe(Math.round(layout.totalSec * sr));
    // The middle of every bar is sound (the 600 ms were moved to the bar's start); the end of the bar is silent.
    for (const bar of [0, 1, 5]) {
      expect(left[bar * sr + 300]).toBeCloseTo(0.5, 5);
      expect(left[bar * sr + 800]).toBe(0);
    }
    expect(Array.from(right.slice(0, 2000))).toEqual(Array.from(left.slice(0, 2000))); // mono is copied to both sides
  });

  it("cuts a sound longer than its unit with a fade, not a click", () => {
    const layout = { ...planTransitionLoop({ bpm: 240, soundDurationSec: 0.9, exitMorphBars: 2 }) };
    const src = new Float32Array(3 * sr).fill(0.5); // longer than the 1 s unit
    const [left] = renderTransitionLoop([src], sr, layout);
    expect(left[0]).toBe(0); // fades in
    expect(left[sr - 1]).toBeLessThan(0.05); // fades out where the unit cuts it
    expect(left[sr + 500]).toBeCloseTo(0.5, 5);
  });

  it("ends with a fade to silence", () => {
    const layout = planTransitionLoop({ bpm: 240, soundDurationSec: 0.9, exitMorphBars: 2 });
    const [left] = renderTransitionLoop([new Float32Array(sr).fill(0.5)], sr, layout);
    expect(left[left.length - 1]).toBe(0);
  });

  it("copes with an empty source", () => {
    const layout = planTransitionLoop({ bpm: 240, soundDurationSec: 0.9, exitMorphBars: 2 });
    const [left] = renderTransitionLoop([], sr, layout);
    expect(left.length).toBe(Math.round(layout.totalSec * sr));
    expect(left.every((v) => v === 0)).toBe(true);
  });
});

describe("encodeWav16", () => {
  it("writes a stereo 16-bit PCM file the browser can play", () => {
    const left = Float32Array.from([0, 1, -1, 0.5]);
    const right = Float32Array.from([0, 0, 0, 0]);
    const wav = encodeWav16([left, right], 44100);
    const view = new DataView(wav);
    const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(12)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(wav.byteLength).toBe(44 + 16);
    expect(view.getInt16(44 + 4, true)).toBe(32767); // left, frame 1
    expect(view.getInt16(44 + 8, true)).toBe(-32768); // left, frame 2
  });
});

describe("the sound as a track", () => {
  const layout = planTransitionLoop({ bpm: 128, soundDurationSec: 6, exitMorphBars: 4 });

  it("is marked so nothing mistakes it for a library song", () => {
    const track = makeTransitionTrack({ sound: fx({ id: "riser" }), url: "blob:x", layout, nonce: "1" });
    expect(isTransitionTrack(track)).toBe(true);
    expect(fxIdOfTransitionTrack(track)).toBe("riser");
    expect(track.sourceUrl).toBe("blob:x");
    expect(track.durationSec).toBeCloseTo(layout.totalSec, 9);
    expect(isTransitionTrack({ id: "cuid123" })).toBe(false);
    expect(isTransitionTrack(null)).toBe(false);
    expect(fxIdOfTransitionTrack({ id: "cuid123" })).toBeNull();
  });

  it("two uses of one sound are two tracks", () => {
    const a = makeTransitionTrack({ sound: fx({ id: "riser" }), url: "blob:x", layout, nonce: "1" });
    const b = makeTransitionTrack({ sound: fx({ id: "riser" }), url: "blob:y", layout, nonce: "2" });
    expect(a.id).not.toBe(b.id);
  });

  it("has an analysis whose bar lines are the file's own, the first of them past the engine's 4 s entry", () => {
    const analysis = transitionAnalysis(layout, "8A");
    expect(analysis.bpm).toBe(128);
    expect(analysis.camelotKey).toBe("8A");
    expect(analysis.fallback).toBe(false);
    const map = analysis.songMap!;
    expect(map.downbeats[1] - map.downbeats[0]).toBeCloseTo(layout.barSec, 9);
    expect(map.downbeats.length).toBe(layout.totalBars);
    expect(map.beats.length).toBe(layout.totalBars * 4);
    const entry = nextGridPointAfter(analysis, 4 - 0.01);
    expect(entry).toBeGreaterThanOrEqual(4 - 0.01);
    expect(entry / layout.barSec).toBeCloseTo(layout.leadInBars, 9);
  });

  it("has no key when the sound has none", () => {
    const analysis = transitionAnalysis(layout, null);
    expect(analysis.camelotKey).toBeNull();
    expect(analysis.keyConfidence).toBe(0);
  });
});

describe("planLeg", () => {
  it("plans the morph the engine would, or refuses the same way", () => {
    expect(planLeg(song(124), song(128))?.direction).toBe("faster");
    expect(planLeg(song(124), song(124))?.direction).toBe("hold");
    expect(planLeg(song(100), song(140))).toBeNull();
    expect(planLeg(song(100), song(160))?.direction).toBe("slower"); // 160 folds to 80, an octave down
    expect(planLeg(song(124, null, 0.05), song(124))).toBeNull();
  });
});
