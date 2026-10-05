import { describe, expect, it } from "vitest";
import {
  buildSongMap,
  decimate,
  extendBeatGrid,
  fft,
  fillBeatGaps,
  isPhraseGridTrustworthy,
  nearestPhraseBoundary,
  nextPhraseBoundary,
  type SongMap,
} from "./song-map";
import { fMeasure, renderSynthSong, type SynthSection } from "./song-map.fixtures";

describe("fft", () => {
  it("puts a pure tone's energy in the right bin", () => {
    const n = 256;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 16 * i) / n); // 16 cycles per window
    fft(re, im);
    let best = 1;
    for (let k = 1; k < n / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k;
    expect(best).toBe(16);
    expect(Math.hypot(re[16], im[16])).toBeCloseTo(n / 2, 3);
  });

  it("matches a direct DFT on arbitrary input", () => {
    const n = 64;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1));
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (const k of [0, 1, 5, 20, 31]) {
      let dr = 0;
      let di = 0;
      for (let i = 0; i < n; i++) {
        dr += x[i] * Math.cos((2 * Math.PI * k * i) / n);
        di -= x[i] * Math.sin((2 * Math.PI * k * i) / n);
      }
      expect(re[k]).toBeCloseTo(dr, 6);
      expect(im[k]).toBeCloseTo(di, 6);
    }
  });
});

describe("decimate", () => {
  it("averages groups of samples and drops the remainder", () => {
    expect(Array.from(decimate(Float32Array.from([1, 3, 5, 7, 9]), 2))).toEqual([2, 6]);
  });

  it("is a no-op for a factor of 1", () => {
    const x = Float32Array.from([1, 2, 3]);
    expect(decimate(x, 1)).toBe(x);
  });
});

describe("extendBeatGrid", () => {
  it("carries the grid back to the start and forward to the end at the beat period", () => {
    expect(extendBeatGrid([110, 160], 50, 300)).toEqual([10, 60, 110, 160, 210, 260]);
  });

  it("adds nothing when the tracked beats already reach the edges", () => {
    expect(extendBeatGrid([5, 55, 105], 50, 150)).toEqual([5, 55, 105]);
  });

  it("caps the extension so a long beat-less stretch isn't filled with invented beats", () => {
    const out = extendBeatGrid([5000], 10, 10000, 8);
    expect(out.length).toBe(1 + 8 + 8);
  });

  it("handles an empty or degenerate input", () => {
    expect(extendBeatGrid([], 50, 300)).toEqual([]);
    expect(extendBeatGrid([100], 1, 300)).toEqual([100]);
  });
});

describe("fillBeatGaps", () => {
  it("inserts evenly spaced beats into a gap of two periods", () => {
    expect(fillBeatGaps([0, 50, 100, 200, 250], 50)).toEqual([0, 50, 100, 150, 200, 250]);
  });

  it("fills a gap of three periods with two beats", () => {
    expect(fillBeatGaps([0, 50, 200], 50)).toEqual([0, 50, 100, 150, 200]);
  });

  it("leaves a slightly long interval (tempo drift) alone", () => {
    expect(fillBeatGaps([0, 50, 108, 160], 50)).toEqual([0, 50, 108, 160]);
  });

  it("copes with one or no beats", () => {
    expect(fillBeatGaps([], 50)).toEqual([]);
    expect(fillBeatGaps([10], 50)).toEqual([10]);
  });
});

function fakeMap(over: Partial<SongMap> = {}): SongMap {
  const downbeats = Array.from({ length: 40 }, (_, i) => 2 * i);
  return {
    version: 1,
    durationSec: 80,
    bpm: 120,
    tempoConfidence: 0.5,
    beatsPerBar: 4,
    beats: [],
    downbeatPhase: 0,
    downbeatConfidence: 0.9,
    downbeats,
    phrases: {
      bars8: downbeats.filter((_, i) => i % 8 === 0),
      bars16: downbeats.filter((_, i) => i % 16 === 0),
      bars32: downbeats.filter((_, i) => i % 32 === 0),
      confidence: 0.5,
    },
    sections: [],
    ...over,
  };
}

describe("phrase helpers", () => {
  const map = fakeMap();

  it("nearestPhraseBoundary picks the closest boundary of the requested phrase length", () => {
    expect(nearestPhraseBoundary(map, 17.9, 8)).toBe(16);
    expect(nearestPhraseBoundary(map, 30, 8)).toBe(32);
    expect(nearestPhraseBoundary(map, 30, 16)).toBe(32);
    expect(nearestPhraseBoundary(map, 40, 32)).toBe(64); // 32-bar phrases start at 0 s and 64 s in this fixture
  });

  it("nextPhraseBoundary is the first boundary at or after the time", () => {
    expect(nextPhraseBoundary(map, 16, 8)).toBe(16);
    expect(nextPhraseBoundary(map, 16.1, 8)).toBe(32);
    expect(nextPhraseBoundary(map, 100, 8)).toBeNull();
  });

  it("returns null when the map has no boundaries of that length", () => {
    const empty = fakeMap({ phrases: { bars8: [], bars16: [], bars32: [], confidence: 0 } });
    expect(nearestPhraseBoundary(empty, 5)).toBeNull();
    expect(nextPhraseBoundary(empty, 5)).toBeNull();
  });

  it("isPhraseGridTrustworthy needs a steady tempo, a confident downbeat and enough bars", () => {
    expect(isPhraseGridTrustworthy(map)).toBe(true);
    expect(isPhraseGridTrustworthy(null)).toBe(false);
    expect(isPhraseGridTrustworthy(fakeMap({ downbeatConfidence: 0.1 }))).toBe(false);
    expect(isPhraseGridTrustworthy(fakeMap({ tempoConfidence: 0.05 }))).toBe(false);
    expect(isPhraseGridTrustworthy(fakeMap({ downbeats: [0, 2, 4] }))).toBe(false);
  });
});

describe("buildSongMap guards", () => {
  it("returns null for audio shorter than the minimum", () => {
    expect(buildSongMap(new Float32Array(44100 * 5), 44100, 5)).toBeNull();
  });

  it("returns null for silence", () => {
    expect(buildSongMap(new Float32Array(44100 * 30), 44100, 30)).toBeNull();
  });

  it("returns null for a steady tone: there are no transients to track, so any beat grid would be invented", () => {
    const x = new Float32Array(44100 * 30);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 44100);
    expect(buildSongMap(x, 44100, 30)).toBeNull();
  });

  it("returns null for a very quiet steady tone too (the guard is level-independent)", () => {
    const x = new Float32Array(44100 * 30);
    for (let i = 0; i < x.length; i++) x[i] = 0.0003 * Math.sin((2 * Math.PI * 220 * i) / 44100);
    expect(buildSongMap(x, 44100, 30)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Accuracy on synthetic songs with exact ground truth. These are the numbers
// the algorithm is held to; the real-recording numbers (much weaker) live in
// the PR description and are not asserted here because the loops aren't in the repo.
// ---------------------------------------------------------------------------

const SHORT: SynthSection[] = [
  { bars: 8, layers: ["hat", "pad"], gain: 0.7 },
  { bars: 16, layers: ["kick", "hat", "bass", "pad"] },
  { bars: 8, layers: ["pad"], gain: 0.6 },
  { bars: 16, layers: ["kick", "snare", "hat", "bass", "pad", "lead"], gain: 1.15 },
];

describe("buildSongMap on synthetic songs", () => {
  const song = renderSynthSong({ bpm: 128, sections: SHORT, seed: 3 });
  const map = buildSongMap(song.samples, song.sampleRate, song.truth.durationSec)!;

  it("finds the tempo to within half a percent", () => {
    expect(map).not.toBeNull();
    expect(Math.abs(map.bpm / 128 - 1)).toBeLessThan(0.005);
  });

  it("tracks beats accurately in time (median error under 10 ms, F-measure at 70 ms above 0.95)", () => {
    const f = fMeasure(map.beats, song.truth.beats, 0.07);
    expect(f.f).toBeGreaterThan(0.95);
    expect(f.medianErrMs).toBeLessThan(10);
    expect(Math.abs(f.medianSignedErrMs)).toBeLessThan(10); // no systematic early/late bias
  });

  it("finds bar lines even when the intro has no kick", () => {
    expect(fMeasure(map.downbeats, song.truth.downbeats, 0.07).f).toBeGreaterThan(0.9);
    expect(map.downbeatConfidence).toBeGreaterThan(0.5);
  });

  it("is JSON-serialisable and round-trips unchanged", () => {
    expect(JSON.parse(JSON.stringify(map))).toEqual(map);
  });

  it("keeps phrase lists nested: every 32-bar start is a 16-bar start is an 8-bar start", () => {
    for (const t of map.phrases.bars32) expect(map.phrases.bars16).toContain(t);
    for (const t of map.phrases.bars16) expect(map.phrases.bars8).toContain(t);
  });

  it("returns sections that tile the track in order", () => {
    expect(map.sections.length).toBeGreaterThan(1);
    expect(map.sections[0].startSec).toBe(0);
    for (let i = 1; i < map.sections.length; i++) expect(map.sections[i].startSec).toBe(map.sections[i - 1].endSec);
    expect(map.sections[map.sections.length - 1].endSec).toBeCloseTo(song.truth.durationSec, 1);
  });
});

describe("buildSongMap across tempos and patterns", () => {
  const cases: { name: string; bpm: number; opts: Parameters<typeof renderSynthSong>[0] extends infer T ? Partial<T> : never }[] = [
    { name: "90 BPM four-on-the-floor", bpm: 90, opts: {} },
    { name: "140 BPM four-on-the-floor", bpm: 140, opts: {} },
    { name: "124 BPM kick on 1 and 3 only", bpm: 124, opts: { kickPattern: "one-three" } },
    { name: "128 BPM after a silent lead-in", bpm: 128, opts: { leadInSec: 1.37 } },
    { name: "128 BPM with ±2% tempo drift", bpm: 128, opts: { driftFraction: 0.02 } },
  ];
  for (const c of cases) {
    it(`${c.name}: tempo, beats and bar lines`, () => {
      const song = renderSynthSong({ bpm: c.bpm, sections: SHORT, seed: 5, ...c.opts });
      const map = buildSongMap(song.samples, song.sampleRate, song.truth.durationSec);
      expect(map).not.toBeNull();
      expect(Math.abs(map!.bpm / c.bpm - 1)).toBeLessThan(0.01);
      // beats extrapolated back over a kick-less intro are only as good as the tempo is steady, so allow drift a little less
      expect(fMeasure(map!.beats, song.truth.beats, 0.07).f).toBeGreaterThan(c.opts.driftFraction ? 0.8 : 0.9);
      expect(fMeasure(map!.downbeats, song.truth.downbeats, 0.07).f).toBeGreaterThan(0.85);
    });
  }
});
