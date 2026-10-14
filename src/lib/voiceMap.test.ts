import { describe, expect, it } from "vitest";
import {
  VOICE_SILENCE_CUT_SEC,
  envelopeFromSamples,
  lastVoiceEndSec,
  segmentsFromEnvelope,
  totalVoicedSec,
  voiceCutoffSec,
  voiceMapFromStem,
  type VoiceMap,
} from "./voiceMap";

const HOP = 0.05;

/** A level envelope: `spec` is a list of [seconds, level] runs. */
function env(spec: [number, number][]): number[] {
  return spec.flatMap(([sec, level]) => new Array(Math.round(sec / HOP)).fill(level));
}

function map(segments: [number, number][], durationSec = 200, source: VoiceMap["source"] = "stem"): VoiceMap {
  return { source, durationSec, segments };
}

describe("envelopeFromSamples", () => {
  it("is the RMS of each hop", () => {
    const sr = 1000;
    const samples = [...new Array(100).fill(0.5), ...new Array(100).fill(0)]; // 0.1 s of 0.5, then 0.1 s of silence
    expect(envelopeFromSamples(samples, sr, 0.1)).toEqual([0.5, 0]);
  });

  it("handles a final partial hop and empty input", () => {
    expect(envelopeFromSamples(new Array(150).fill(1), 1000, 0.1)).toEqual([1, 1]);
    expect(envelopeFromSamples([], 1000)).toEqual([]);
  });
});

describe("segmentsFromEnvelope", () => {
  it("finds the voiced stretches of a stem", () => {
    const segs = segmentsFromEnvelope(env([[5, 0.001], [10, 0.3], [5, 0.001], [8, 0.4], [10, 0.001]]));
    expect(segs).toEqual([
      [5, 15],
      [20, 28],
    ]);
  });

  it("bridges a breath between phrases but not a real gap", () => {
    const breath = segmentsFromEnvelope(env([[4, 0.3], [0.5, 0.001], [4, 0.3]]));
    expect(breath).toHaveLength(1);
    const gap = segmentsFromEnvelope(env([[4, 0.3], [3, 0.001], [4, 0.3]]));
    expect(gap).toHaveLength(2);
  });

  it("drops a blip too short to be a voice", () => {
    expect(segmentsFromEnvelope(env([[5, 0.001], [0.1, 0.4], [5, 0.001]]))).toEqual([]);
  });

  it("judges level relative to the stem's own loudness, ignoring quiet bleed", () => {
    // loud singing at 0.4, residual instrument bleed at 0.02 (5% of it): bleed is not a voice
    const segs = segmentsFromEnvelope(env([[10, 0.4], [10, 0.02], [10, 0.4]]));
    expect(segs).toEqual([
      [0, 10],
      [20, 30],
    ]);
  });

  it("returns nothing for a silent stem or an empty one", () => {
    expect(segmentsFromEnvelope(env([[30, 0.0001]]))).toEqual([]);
    expect(segmentsFromEnvelope([])).toEqual([]);
  });

  it("closes a voice that runs to the very end", () => {
    expect(segmentsFromEnvelope(env([[5, 0.001], [5, 0.3]]))).toEqual([[5, 10]]);
  });
});

describe("voiceMapFromStem", () => {
  it("builds a stem map with the audio's own length", () => {
    const sr = 100;
    const samples = [...new Array(500).fill(0), ...new Array(1000).fill(0.5), ...new Array(500).fill(0)]; // 5 s quiet, 10 s voice, 5 s quiet
    const m = voiceMapFromStem(samples, sr);
    expect(m.source).toBe("stem");
    expect(m.durationSec).toBe(20);
    expect(m.segments).toEqual([[5, 15]]);
  });
});

describe("lastVoiceEndSec / totalVoicedSec", () => {
  it("reads the final voiced end and the total voiced time", () => {
    const m = map([[5, 20], [60, 90], [100, 120]]);
    expect(lastVoiceEndSec(m)).toBe(120);
    expect(totalVoicedSec(m)).toBe(15 + 30 + 20);
  });

  it("is null / zero for no map or no segments", () => {
    expect(lastVoiceEndSec(null)).toBeNull();
    expect(lastVoiceEndSec(map([]))).toBeNull();
    expect(totalVoicedSec(map([]))).toBe(0);
  });
});

describe("voiceCutoffSec", () => {
  it("is 10 seconds after the last voice ends", () => {
    expect(voiceCutoffSec(map([[10, 60], [100, 150]]), 200)).toBe(150 + VOICE_SILENCE_CUT_SEC);
  });

  it("leaves a long instrumental break in the middle alone (voices come back after it)", () => {
    // a 60 s break from 60 to 120, then singing again until 170: the cut-off follows the LAST voice, not the break
    expect(voiceCutoffSec(map([[10, 60], [120, 170]], 220), 220)).toBe(180);
  });

  it("does nothing without a map, or for a track with no length", () => {
    expect(voiceCutoffSec(null, 200)).toBeNull();
    expect(voiceCutoffSec(undefined, 200)).toBeNull();
    expect(voiceCutoffSec(map([[10, 150]]), 0)).toBeNull();
  });

  it("does not trust a map built from audio of a different length", () => {
    expect(voiceCutoffSec(map([[10, 150]], 200), 240)).toBeNull(); // an extended edit
    expect(voiceCutoffSec(map([[10, 150]], 200), 204)).toBe(160); // within 3%
  });

  it("does nothing for tracks with hardly any voice (not a vocal track)", () => {
    expect(voiceCutoffSec(map([[100, 108]]), 200)).toBeNull();
  });

  it("does not believe time-stamped lyrics claiming the singing stopped in the first half of the track", () => {
    expect(voiceCutoffSec(map([[5, 60]], 200, "lyrics"), 200)).toBeNull();
  });

  it("trusts an isolated vocal stem whose singing stops early (a long instrumental ending)", () => {
    expect(voiceCutoffSec(map([[5, 60]], 200, "stem"), 200)).toBe(70);
  });

  it("still won't cut a stem-based map before 30 seconds of the song have played", () => {
    expect(voiceCutoffSec(map([[2, 18]], 200, "stem"), 200)).toBeNull(); // 18 + 10 = 28 s
    expect(voiceCutoffSec(map([[2, 22]], 200, "stem"), 200)).toBe(32);
  });

  it("applies the half-way guard to a stem only below its much smaller share", () => {
    expect(voiceCutoffSec(map([[1, 17]], 200, "stem"), 200)).toBeNull(); // ends at 8.5%
  });

  it("leaves it to the natural end when the cut-off is about as soon", () => {
    expect(voiceCutoffSec(map([[10, 188]]), 200)).toBeNull(); // 198 s is within 5 s of the 200 s end
  });

  it("honours a custom silence length", () => {
    expect(voiceCutoffSec(map([[10, 150]]), 200, 20)).toBe(170);
  });
});
