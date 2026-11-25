import { describe, expect, it } from "vitest";
import { WavError, addInto, instrumentalFromStemFiles, parseWav, peakOf, sumWav, writeWav16, type WavAudio } from "./wav";

/** Builds a WAV in any of the formats the parser reads: pcm16, pcm24, pcm32, float32, or 24-bit with the extensible header the separation model writes. */
function encode(audio: WavAudio, kind: "pcm16" | "pcm24" | "pcm32" | "float32" | "pcm24-extensible"): Uint8Array {
  const nCh = audio.channels.length;
  const frames = audio.channels[0].length;
  const bits = kind === "pcm16" ? 16 : kind === "pcm24" || kind === "pcm24-extensible" ? 24 : 32;
  const ext = kind === "pcm24-extensible";
  const fmtSize = ext ? 40 : 16;
  const dataBytes = frames * nCh * (bits / 8);
  const out = new Uint8Array(12 + 8 + fmtSize + 8 + dataBytes);
  const v = new DataView(out.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  put(0, "RIFF"); v.setUint32(4, out.length - 8, true); put(8, "WAVE"); put(12, "fmt "); v.setUint32(16, fmtSize, true);
  v.setUint16(20, ext ? 0xfffe : kind === "float32" ? 3 : 1, true); v.setUint16(22, nCh, true); v.setUint32(24, audio.sampleRate, true);
  v.setUint32(28, audio.sampleRate * nCh * (bits / 8), true); v.setUint16(32, nCh * (bits / 8), true); v.setUint16(34, bits, true);
  if (ext) { v.setUint16(36, 22, true); v.setUint16(38, bits, true); v.setUint32(40, 3, true); v.setUint16(44, 1, true); }
  const dataAt = 20 + fmtSize;
  put(dataAt, "data"); v.setUint32(dataAt + 4, dataBytes, true);
  let p = dataAt + 8;
  for (let i = 0; i < frames; i++) for (let c = 0; c < nCh; c++) {
    const s = audio.channels[c][i];
    if (kind === "float32") v.setFloat32(p, s, true);
    else if (bits === 16) v.setInt16(p, Math.round(s * 32767), true);
    else if (bits === 24) { const n = Math.round(s * 8388607); v.setUint8(p, n & 255); v.setUint8(p + 1, (n >> 8) & 255); v.setUint8(p + 2, (n >> 16) & 255); }
    else v.setInt32(p, Math.round(s * 2147483647), true);
    p += bits / 8;
  }
  return out;
}

const tone = (freq: number, amp: number, frames = 4410, rate = 44100): WavAudio => ({
  sampleRate: rate,
  channels: [0, 1].map((c) => Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate + c))),
});

const maxDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i])), 0);

describe("parseWav", () => {
  for (const [kind, tolerance] of [["pcm16", 1e-4], ["pcm24", 1e-6], ["pcm24-extensible", 1e-6], ["pcm32", 1e-8], ["float32", 1e-8]] as const) {
    it(`reads ${kind} back to the samples it was written from`, () => {
      const src = tone(440, 0.6);
      const back = parseWav(encode(src, kind));
      expect(back.sampleRate).toBe(44100);
      expect(back.channels).toHaveLength(2);
      expect(back.channels[0]).toHaveLength(4410);
      expect(maxDiff(back.channels[0], src.channels[0])).toBeLessThan(tolerance);
      expect(maxDiff(back.channels[1], src.channels[1])).toBeLessThan(tolerance);
    });
  }

  it("rejects what it does not understand instead of making noise of it", () => {
    expect(() => parseWav(new Uint8Array(10))).toThrow(WavError);
    expect(() => parseWav(new TextEncoder().encode("RIFF____WAVEjunkjunkjunkjunkjunkjunkjunkjunkjunk"))).toThrow(WavError);
    const adpcm = encode(tone(440, 0.5), "pcm16");
    new DataView(adpcm.buffer).setUint16(20, 2, true); // MS ADPCM
    expect(() => parseWav(adpcm)).toThrow(/unsupported/);
  });

  it("takes the data that is there when a streamed file has no length", () => {
    const wav = encode(tone(440, 0.5), "pcm16");
    new DataView(wav.buffer).setUint32(40, 0xffffffff, true);
    expect(parseWav(wav).channels[0]).toHaveLength(4410);
  });
});

describe("the instrumental: the sum of every stem but the vocals", () => {
  it("adds the stems sample by sample", () => {
    const drums = tone(100, 0.2);
    const bass = tone(60, 0.2);
    const other = tone(900, 0.2);
    const sum = sumWav([drums, bass, other]);
    for (const i of [0, 100, 2000, 4409]) expect(sum.channels[0][i]).toBeCloseTo(drums.channels[0][i] + bass.channels[0][i] + other.channels[0][i], 6);
  });

  it("leaves a sum that fits untouched, and scales one that would clip instead of clipping it", () => {
    const quiet = writeWav16(sumWav([tone(100, 0.2), tone(60, 0.2)]));
    expect(quiet.scaledBy).toBe(1);
    const loud = sumWav([tone(100, 0.9), tone(100, 0.9)]); // peaks at 1.8
    expect(peakOf(loud)).toBeGreaterThan(1.7);
    const written = writeWav16(loud);
    expect(written.scaledBy).toBeCloseTo(1 / peakOf(loud), 6);
    const back = parseWav(written.bytes);
    expect(peakOf(back)).toBeLessThanOrEqual(1);
    expect(peakOf(back)).toBeGreaterThan(0.99);
    // the shape survives: it is the same signal at a lower level, not a flat-topped one
    const ratio = back.channels[0][1000] / loud.channels[0][1000];
    expect(back.channels[0][2000] / loud.channels[0][2000]).toBeCloseTo(ratio, 2);
  });

  it("pads a shorter stem with silence, and refuses stems that do not belong together", () => {
    const longer = tone(100, 0.2, 5000);
    const shorter = tone(60, 0.2, 4000);
    expect(sumWav([longer, shorter]).channels[0]).toHaveLength(5000);
    expect(() => sumWav([tone(100, 0.2, 100, 44100), tone(100, 0.2, 100, 48000)])).toThrow(/sample rates/);
    expect(() => sumWav([tone(100, 0.2), { sampleRate: 44100, channels: [new Float32Array(4410)] }])).toThrow(/channel counts/);
    expect(() => sumWav([])).toThrow(WavError);
  });

  it("goes from three 24-bit model stems to a 16-bit instrumental of the same length and level", () => {
    const drums = tone(100, 0.2), bass = tone(60, 0.2), other = tone(900, 0.2);
    const result = instrumentalFromStemFiles([drums, bass, other].map((s) => encode(s, "pcm24-extensible")));
    expect(result.durationSec).toBeCloseTo(0.1, 2);
    expect(result.scaledBy).toBe(1);
    const back = parseWav(result.bytes);
    expect(back.sampleRate).toBe(44100);
    expect(back.channels).toHaveLength(2);
    expect(maxDiff(back.channels[0], sumWav([drums, bass, other]).channels[0])).toBeLessThan(2e-4);
    // the vocal-free file is half the size of a 24-bit stem of the same length (16 vs 24 bits)
    expect(result.bytes.length).toBeLessThan(encode(drums, "pcm24-extensible").length);
  });
});

describe("addInto: a running sum", () => {
  it("gives the same result as summing all the stems at once", () => {
    const a = tone(100, 0.2), b = tone(60, 0.2), c = tone(900, 0.2);
    const whole = sumWav([tone(100, 0.2), tone(60, 0.2), tone(900, 0.2)]);
    let acc: WavAudio | null = null;
    for (const s of [a, b, c]) acc = addInto(acc, s);
    for (const i of [0, 100, 2000, 4409]) expect(acc!.channels[0][i]).toBeCloseTo(whole.channels[0][i], 6);
  });

  it("pads a shorter total, extends for a longer stem, and refuses stems that do not belong together", () => {
    expect(addInto(tone(100, 0.2, 4000), tone(60, 0.2, 5000)).channels[0]).toHaveLength(5000);
    expect(addInto(tone(100, 0.2, 5000), tone(60, 0.2, 4000)).channels[0]).toHaveLength(5000);
    expect(() => addInto(tone(100, 0.2, 100, 44100), tone(100, 0.2, 100, 48000))).toThrow(/sample rates/);
    expect(() => addInto(tone(100, 0.2), { sampleRate: 44100, channels: [new Float32Array(4410)] })).toThrow(/channel counts/);
  });
});
