import { describe, expect, it, vi } from "vitest";
import { INSTRUMENTAL_RETRY_AFTER_MS, buildInstrumental, instrumentalTodoWhere, parseVocalActivity, type StemJobForInstrumental } from "./stemInstrumental";
import { parseWav, type WavAudio } from "./wav";

/** A 16-bit stereo WAV of the given channels. */
function wav16(audio: WavAudio): Uint8Array {
  const nCh = audio.channels.length, frames = audio.channels[0].length, dataBytes = frames * nCh * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  put(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); put(8, "WAVE"); put(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, audio.sampleRate, true); v.setUint32(28, audio.sampleRate * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true); put(36, "data"); v.setUint32(40, dataBytes, true);
  let p = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < nCh; c++) { v.setInt16(p, Math.round(audio.channels[c][i] * 32767), true); p += 2; }
  return out;
}

const RATE = 8000;
const secs = (n: number) => n * RATE;
/** A stem that is `amp` loud during the given [start, end] second ranges and silent elsewhere. */
const burst = (totalSec: number, ranges: [number, number][], amp: number, freq = 300): WavAudio => ({
  sampleRate: RATE,
  channels: [0, 1].map(() => Float32Array.from({ length: secs(totalSec) }, (_, i) => (ranges.some(([a, b]) => i / RATE >= a && i / RATE < b) ? amp * Math.sin((2 * Math.PI * freq * i) / RATE) : 0))),
});

const job: StemJobForInstrumental = { id: "job1", trackId: "trk1", vocalsUrl: "u://vocals", drumsUrl: "u://drums", bassUrl: "u://bass", otherUrl: "u://other" };

function deps(files: Record<string, Uint8Array>) {
  const stored: { pathname: string; bytes: Uint8Array; type: string }[] = [];
  return {
    stored,
    deps: {
      fetchBytes: async (url: string) => { const f = files[url]; if (!f) throw new Error("404"); return f; },
      store: async (pathname: string, bytes: Uint8Array, type: string) => { stored.push({ pathname, bytes, type }); return `https://blob/${pathname}`; },
    },
  };
}

describe("buildInstrumental", () => {
  const files = {
    "u://vocals": wav16(burst(40, [[4, 12], [20, 30]], 0.5, 500)),
    "u://drums": wav16(burst(40, [[0, 40]], 0.1, 100)),
    "u://bass": wav16(burst(40, [[0, 40]], 0.1, 60)),
    "u://other": wav16(burst(40, [[0, 40]], 0.1, 700)),
  };

  it("stores the sum of drums + bass + other (no vocals) and returns its URL", async () => {
    const { deps: d, stored } = deps(files);
    const r = await buildInstrumental(job, d);
    expect(stored).toHaveLength(1);
    expect(stored[0].pathname).toBe("stems/trk1/job1-instrumental.wav");
    expect(stored[0].type).toBe("audio/wav");
    expect(r.instrumentalUrl).toBe("https://blob/stems/trk1/job1-instrumental.wav");
    expect(r.durationSec).toBeCloseTo(40, 1);
    expect(r.scaledBy).toBe(1);
    const back = parseWav(stored[0].bytes);
    const drums = parseWav(files["u://drums"]), bass = parseWav(files["u://bass"]), other = parseWav(files["u://other"]);
    for (const i of [10, 5000, 100000, 300000]) expect(back.channels[0][i]).toBeCloseTo(drums.channels[0][i] + bass.channels[0][i] + other.channels[0][i], 3);
  });

  it("leaves the vocals OUT of the instrumental", async () => {
    // Vocals are only loud where the other stems are silent here, so any vocal in the instrumental would show as energy in that stretch.
    const quiet = {
      ...files,
      "u://drums": wav16(burst(40, [[0, 3]], 0.1, 100)),
      "u://bass": wav16(burst(40, [[0, 3]], 0.1, 60)),
      "u://other": wav16(burst(40, [[0, 3]], 0.1, 700)),
    };
    const { deps: d, stored } = deps(quiet);
    await buildInstrumental(job, d);
    const inst = parseWav(stored[0].bytes).channels[0];
    let during = 0;
    for (let i = secs(4); i < secs(12); i++) during = Math.max(during, Math.abs(inst[i]));
    expect(during).toBe(0); // the vocal burst at 4-12 s is not in it
  });

  it("builds the vocal activity from the vocal stem: when the lead vocal is present", async () => {
    const { deps: d } = deps(files);
    const r = await buildInstrumental(job, d);
    expect(r.voiceMap.source).toBe("stem");
    expect(r.voiceMap.durationSec).toBeCloseTo(40, 1);
    const [first, second] = r.voiceMap.segments;
    expect(first[0]).toBeCloseTo(4, 0);
    expect(first[1]).toBeCloseTo(12, 0);
    expect(second[0]).toBeCloseTo(20, 0);
    expect(second[1]).toBeCloseTo(30, 0);
  });

  it("refuses a job that is missing a stem, and a stem that cannot be fetched or read, and stores nothing", async () => {
    const { deps: d, stored } = deps(files);
    await expect(buildInstrumental({ ...job, bassUrl: null }, d)).rejects.toThrow(/four stems/);
    await expect(buildInstrumental({ ...job, otherUrl: "u://missing" }, d)).rejects.toThrow("404");
    const junk = deps({ ...files, "u://drums": new TextEncoder().encode("<html>error page that is not audio at all, long enough</html>") });
    await expect(buildInstrumental(job, junk.deps)).rejects.toThrow();
    expect(stored).toHaveLength(0);
    expect(junk.stored).toHaveLength(0);
  });
});

describe("parseVocalActivity", () => {
  it("reads a stored map, drops malformed segments, and returns null for nothing usable", () => {
    expect(parseVocalActivity(JSON.stringify({ source: "stem", durationSec: 100, segments: [[1, 5], [9, 8], "x", [10, 20]] }))).toEqual({ source: "stem", durationSec: 100, segments: [[1, 5], [10, 20]] });
    expect(parseVocalActivity(null)).toBeNull();
    expect(parseVocalActivity("{nope")).toBeNull();
    expect(parseVocalActivity(JSON.stringify({ segments: "no" }))).toBeNull();
  });
});

describe("Instrumental mode (playbackUrl)", () => {
  const state = { instrumentalMode: true, instrumentalAvailability: { a: "https://blob/a-instrumental.wav" } };

  it("plays the song itself while the feature is off, whatever the setting", async () => {
    const { playbackUrl } = await import("./instrumentalMode");
    expect(playbackUrl({ id: "a", sourceUrl: "https://blob/a.mp3" }, state)).toBe("https://blob/a.mp3");
  });

  it("plays the instrumental when the feature and the mode are on and one exists, and the song otherwise", async () => {
    vi.resetModules();
    vi.doMock("@/lib/featureFlags", async (orig) => ({ ...(await orig<typeof import("@/lib/featureFlags")>()), VOCAL_SPLIT_ENABLED: true }));
    const { playbackUrl } = await import("./instrumentalMode");
    expect(playbackUrl({ id: "a", sourceUrl: "https://blob/a.mp3" }, state)).toBe("https://blob/a-instrumental.wav");
    expect(playbackUrl({ id: "b", sourceUrl: "https://blob/b.mp3" }, state)).toBe("https://blob/b.mp3"); // not separated yet: plays in full
    expect(playbackUrl({ id: "a", sourceUrl: "https://blob/a.mp3" }, { ...state, instrumentalMode: false })).toBe("https://blob/a.mp3");
    vi.doUnmock("@/lib/featureFlags");
  });
});

describe("the instrumental job's memory and queue behaviour", () => {
  const stems = {
    "u://vocals": wav16(burst(10, [[1, 5]], 0.5, 500)),
    "u://drums": wav16(burst(10, [[0, 10]], 0.1, 100)),
    "u://bass": wav16(burst(10, [[0, 10]], 0.1, 60)),
    "u://other": wav16(burst(10, [[0, 10]], 0.1, 700)),
  };

  it("reads one stem at a time (never more than one download in flight)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    await buildInstrumental(job, {
      fetchBytes: async (url) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(url);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return stems[url as keyof typeof stems];
      },
      store: async (p) => `https://blob/${p}`,
    });
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(["u://drums", "u://bass", "u://other", "u://vocals"]);
  });

  it("a job that failed lately is not picked again until the retry delay has passed, so it cannot block the ones behind it", () => {
    const now = Date.UTC(2026, 10, 25, 12);
    const where = instrumentalTodoWhere(now);
    expect(where.status).toBe("ready");
    expect(where.instrumentalUrl).toBeNull();
    const [never, retry] = where.OR;
    expect(never).toEqual({ instrumentalBuiltAt: null });
    expect((retry.instrumentalBuiltAt as { lt: Date }).lt.getTime()).toBe(now - INSTRUMENTAL_RETRY_AFTER_MS);
    expect(INSTRUMENTAL_RETRY_AFTER_MS).toBe(3_600_000);
  });
});
