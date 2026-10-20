import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { WORKLET_OUTPUT, buildStretchWorklet } from "../../scripts/build-stretch-worklet.mjs";

/**
 * The tempo/pitch stretcher AudioWorklet (time-stretch-processor.js, built into public/worklets/time-stretch.js) run
 * in a fake AudioWorkletGlobalScope: the real SoundTouch code and the real processor, driven one 128-frame block at a
 * time like the browser's audio thread, with nothing mocked in between.
 */

const SR = 48000;
const QUANTUM = 128;
/** The stretcher fixes its windows at 44.1 kHz-sized frame counts, so its offsets must hold at both common context rates. */
const RATES = [48000, 44100];

interface Message {
  type: string;
  sourceFrame?: number;
  atFrame?: number;
}
interface Processor {
  port: { posted: Message[] };
  onMessage(message: Record<string, unknown>): void;
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
  readPos: number;
}
interface Scope {
  currentFrame: number;
}

function load(sampleRate = SR): { make: () => Processor; scope: Scope } {
  const code = readFileSync(WORKLET_OUTPUT as string, "utf8");
  const scope = { currentFrame: 0, sampleRate, Float32Array, console, Math } as Record<string, unknown>;
  scope.globalThis = scope;
  let Registered: (new () => Processor) | null = null;
  let registeredName = "";
  scope.AudioWorkletProcessor = class {
    port = {
      onmessage: null as unknown,
      posted: [] as Message[],
      postMessage(m: Message) {
        this.posted.push(m);
      },
    };
  };
  scope.registerProcessor = (name: string, cls: new () => Processor) => {
    registeredName = name;
    Registered = cls;
  };
  vm.createContext(scope);
  vm.runInContext(code, scope);
  expect(registeredName).toBe("time-stretch");
  return { make: () => new Registered!(), scope: scope as unknown as Scope };
}

/** A source whose every sample is its own position / total length: the output value at any frame says which source frame it came from. */
function ramp(seconds: number): { data: Float32Array; total: number } {
  const total = Math.round(seconds * SR);
  const data = new Float32Array(total);
  for (let i = 0; i < total; i++) data[i] = i / total;
  return { data, total };
}

/** Continuous, music-like (two tones and a little noise): any hole in the output is a defect, not part of the music. */
function tones(seconds: number): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let seed = 9;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out[i] = 0.2 * Math.sin(i * 0.05) + 0.1 * Math.sin(i * 0.0071) + 0.02 * (seed / 0xffffffff - 0.5);
  }
  return out;
}

interface Run {
  out: Float32Array;
  reports: { atFrame: number; src: number }[];
  maxFed: number;
  ended: boolean;
}

function run(
  source: Float32Array,
  seconds: number,
  {
    tempo = 1,
    pitch = 0,
    baseFrame = 0,
    startFrame = undefined as number | undefined,
    atFrame = 0,
    exact = false,
    sampleRate = SR,
    schedule = [] as { atSec: number; message: Record<string, unknown> }[],
  } = {}
): Run {
  const { make, scope } = load(sampleRate);
  const p = make();
  // Tempo and pitch first, as the real voice sends them: the start offset is worked out from them when the audio loads.
  p.onMessage({ type: "tempo", value: tempo });
  p.onMessage({ type: "pitch", semitones: pitch });
  p.onMessage({ type: "load", left: source, right: source, baseFrame, startFrame, atFrame, exact });
  const out = new Float32Array(Math.round(seconds * SR));
  const left = new Float32Array(QUANTUM);
  const right = new Float32Array(QUANTUM);
  const reports: Run["reports"] = [];
  let maxFed = 0;
  let prev = p.readPos;
  let ended = false;
  const pending = [...schedule];
  for (let f = 0; f < out.length; f += QUANTUM) {
    while (pending.length && f / SR >= pending[0].atSec) p.onMessage(pending.shift()!.message);
    scope.currentFrame = f;
    left.fill(0);
    right.fill(0);
    const keepGoing = p.process([[]], [[left, right]]);
    out.set(left, f);
    if (f > 20 * QUANTUM) maxFed = Math.max(maxFed, p.readPos - prev);
    prev = p.readPos;
    for (const m of p.port.posted.splice(0)) {
      if (m.type === "pos") reports.push({ atFrame: m.atFrame!, src: m.sourceFrame! });
      if (m.type === "ended") ended = true;
    }
    if (!keepGoing) break;
  }
  return { out, reports, maxFed, ended };
}

describe("public/worklets/time-stretch.js", () => {
  it("is up to date with SoundTouchJS and the processor source (run `npm run build:worklet`)", () => {
    expect(readFileSync(WORKLET_OUTPUT as string, "utf8")).toBe(buildStretchWorklet());
  });

  it("keeps SoundTouchJS's LGPL notice at the top of the generated file and has no import or export left", () => {
    const text = readFileSync(WORKLET_OUTPUT as string, "utf8");
    expect(text).toContain("GNU Lesser General Public");
    expect(text).not.toMatch(/^export\s/m);
    expect(text).not.toMatch(/^import\s/m);
  });
});

describe("time-stretch processor, exact mode", () => {
  it("plays the source sample for sample from the start it was given", () => {
    const source = tones(10);
    const start = 3 * SR + 17;
    const { out } = run(source, 2, { exact: true, baseFrame: 0, startFrame: start });
    for (const i of [0, 1, 127, 128, 5000, 50000, 90000]) expect(out[i]).toBe(source[start + i]);
  });

  it("ignores tempo and pitch: untouched audio is untouched audio", () => {
    const source = tones(10);
    const { out } = run(source, 1, { exact: true, startFrame: SR, tempo: 1.2, pitch: 5 });
    for (const i of [0, 500, 20000]) expect(out[i]).toBe(source[SR + i]);
  });

  it("starts on the scheduled context frame, on that very frame", () => {
    const source = tones(10);
    const { out } = run(source, 1, { exact: true, startFrame: SR, atFrame: 1000 * QUANTUM });
    // 1000 blocks of silence would be 128000 frames: past the 1 s we run, so the whole run is silent...
    expect(out.every((v) => v === 0)).toBe(true);
    const { out: out2 } = run(source, 1, { exact: true, startFrame: SR, atFrame: 10 * QUANTUM });
    expect(out2.slice(0, 10 * QUANTUM).every((v) => v === 0)).toBe(true);
    expect(out2[10 * QUANTUM]).toBe(source[SR]);
  });

  it("begins on the exact scheduled frame even when it falls inside a block", () => {
    const source = tones(10);
    const at = 10 * QUANTUM + 50;
    const { out } = run(source, 1, { exact: true, startFrame: SR, atFrame: at });
    expect(out.slice(0, at).every((v) => v === 0)).toBe(true);
    expect(out[at]).toBe(source[SR]);
    expect(out[at + 1]).toBe(source[SR + 1]);
  });

  it("reports the exact position, in absolute source frames", () => {
    const source = tones(10);
    const base = 2 * SR;
    const { reports } = run(source.slice(base), 2, { exact: true, baseFrame: base, startFrame: base + 5000 });
    const r = reports.find((x) => x.atFrame >= 40 * QUANTUM)!;
    // The block played at context frame f starts at source frame (start + f), and that is what is reported.
    expect(r.src).toBe(base + 5000 + r.atFrame);
  });

  it("plays the source out, says it has ended, and stops being called", () => {
    const source = tones(1);
    const { ended, out } = run(source, 3, { exact: true, startFrame: 0 });
    expect(ended).toBe(true);
    expect(out.slice(0, SR).every((v, i) => v === source[i])).toBe(true);
    expect(out.slice(Math.round(1.5 * SR)).every((v) => v === 0)).toBe(true);
  });
});

describe("time-stretch processor", () => {
  it("stays silent until audio is loaded, and until the context frame it was told to begin at", () => {
    const { make, scope } = load();
    const p = make();
    const left = new Float32Array(QUANTUM);
    const right = new Float32Array(QUANTUM);
    expect(p.process([[]], [[left, right]])).toBe(true);
    expect(left.every((v) => v === 0)).toBe(true);

    const source = tones(5);
    p.onMessage({ type: "load", left: source, right: source, baseFrame: 0, atFrame: SR });
    scope.currentFrame = SR - QUANTUM;
    p.process([[]], [[left, right]]);
    expect(left.every((v) => v === 0)).toBe(true);
    scope.currentFrame = SR;
    p.process([[]], [[left, right]]);
    expect(left.some((v) => v !== 0)).toBe(true);
  });

  it("primes the stretcher a chunk at a time while it waits for a scheduled start, then plays at once", () => {
    const { make, scope } = load();
    const p = make();
    const source = tones(20);
    p.onMessage({ type: "tempo", value: 1 });
    p.onMessage({ type: "pitch", semitones: 0 });
    p.onMessage({ type: "load", left: source, right: source, baseFrame: 0, startFrame: 5 * SR, atFrame: 0.5 * SR });
    const readAtLoad = p.readPos;
    const left = new Float32Array(QUANTUM);
    const right = new Float32Array(QUANTUM);
    let maxFeed = 0;
    let prev = readAtLoad;
    let silentAll = true;
    for (let f = 0; f + QUANTUM <= 0.5 * SR; f += QUANTUM) {
      scope.currentFrame = f;
      left.fill(0);
      p.process([[]], [[left, right]]);
      maxFeed = Math.max(maxFeed, p.readPos - prev);
      prev = p.readPos;
      if (left.some((v) => v !== 0)) silentAll = false;
    }
    expect(silentAll).toBe(true);
    expect(maxFeed).toBeLessThanOrEqual(512); // one chunk per block, never a burst
    expect(p.readPos).toBeGreaterThan(readAtLoad + 2000); // and by the start it has read ahead
    scope.currentFrame = 0.5 * SR;
    p.process([[]], [[left, right]]);
    expect(left.some((v) => v !== 0)).toBe(true); // sound on the very first block at the scheduled frame
    expect(p.readPos - prev).toBeLessThanOrEqual(1024); // and the first audible block needed almost no new input
  });

  it("begins the stretched audio on the scheduled frame even when it falls inside a block", () => {
    const source = tones(20);
    const at = 40 * QUANTUM + 77;
    const { out } = run(source, 2, { startFrame: 5 * SR, atFrame: at });
    expect(out.slice(0, at).every((v) => v === 0)).toBe(true);
    const first = out.findIndex((v) => v !== 0);
    expect(first).toBeGreaterThanOrEqual(at);
    expect(first).toBeLessThan(at + 40);
  });

  it("plays untouched audio at tempo 1 and pitch 0 with a fixed lead and no drift", () => {
    const { data, total } = ramp(30);
    const { out } = run(data, 5);
    // The output at frame f is the source a little ahead of f (the stretcher's first window skips forward, about 28 ms),
    // and that lead never changes: it is the same at 1 s, 2 s and 4 s.
    const lead = (f: number) => out[f] * total - f;
    expect(lead(SR)).toBeGreaterThan(0);
    expect(lead(SR)).toBeLessThan(0.05 * SR);
    expect(lead(2 * SR)).toBeCloseTo(lead(SR), 0);
    expect(lead(4 * SR)).toBeCloseTo(lead(SR), 0);
  });

  it("makes the first audible sample the one asked for, whatever the tempo, pitch or sample rate", () => {
    // The ramp reads low in the stretcher's first few hundred samples (it fades in), so judge the start from the steady
    // output: extrapolate it back to output sample 0 and compare with the source frame that was asked for.
    for (const rate of RATES) {
      const total = rate * 60;
      const data = new Float32Array(total);
      for (let i = 0; i < total; i++) data[i] = i / total;
      const wanted = 20 * rate;
      for (const [tempo, pitch] of [
        [1, 0],
        [1.1, 0],
        [0.85, 0],
        [1, 3],
        [1.2, -2],
      ]) {
        const { out } = run(data, 1, { tempo, pitch, startFrame: wanted, sampleRate: rate });
        expect(out.findIndex((v) => v !== 0), `tempo ${tempo} pitch ${pitch} at ${rate}`).toBeLessThan(QUANTUM * 2);
        let sum = 0;
        let n = 0;
        for (let k = 6000; k < 30000; k += 50) {
          sum += out[k] * total - k * tempo;
          n++;
        }
        const startErrorMs = ((sum / n - wanted) / rate) * 1000;
        expect(Math.abs(startErrorMs), `tempo ${tempo} pitch ${pitch} at ${rate}`).toBeLessThan(3);
      }
    }
  });

  it("starts at the very beginning of the audio when the wanted start is nearer than the skip", () => {
    const { data, total } = ramp(30);
    const { out } = run(data, 1, { startFrame: 0 });
    const first = out.findIndex((v) => v !== 0);
    expect(first).toBeGreaterThanOrEqual(0);
    // Nothing earlier exists to feed, so the first audible sample is the stretcher's own skip into the audio (about 28 ms).
    expect(out[first + 64] * total).toBeLessThan(0.04 * SR);
  });

  it("leaves no holes in the output at any tempo or pitch", () => {
    const source = tones(40);
    for (const [tempo, pitch] of [
      [1, 0],
      [1.05, 0],
      [0.95, 0],
      [1, 3],
      [1.1, -2],
      [0.9, 2],
      [1.25, 4],
    ]) {
      const { out } = run(source, 15, { tempo, pitch });
      let runLength = 0;
      let holes = 0;
      for (let i = 256; i < out.length; i++) {
        if (out[i] === 0) {
          if (++runLength === 8) holes++;
        } else runLength = 0;
      }
      expect(holes, `tempo ${tempo} pitch ${pitch}`).toBe(0);
    }
  });

  it("moves through the source at the tempo asked for", () => {
    const { data, total } = ramp(120);
    for (const tempo of [0.9, 1.1]) {
      const { out } = run(data, 20, { tempo });
      const from = 2 * SR;
      const to = 18 * SR;
      const covered = ((out[to] - out[from]) * total) / (to - from);
      expect(covered).toBeCloseTo(tempo, 1);
    }
  });

  it("follows a tempo change made while playing", () => {
    const { data, total } = ramp(120);
    const { out } = run(data, 20, { schedule: [{ atSec: 6, message: { type: "tempo", value: 1.2 } }] });
    const rate = (a: number, b: number) => ((out[b * SR] - out[a * SR]) * total) / ((b - a) * SR);
    expect(rate(2, 5)).toBeCloseTo(1, 1);
    expect(rate(9, 19)).toBeCloseTo(1.2, 1);
  });

  it("reports where in the source the audio being heard came from, to within a few milliseconds on average", () => {
    const { data, total } = ramp(120);
    const cases: [number, number][] = [
      [1, 0],
      [1.05, 0],
      [0.95, 0],
      [1, 3],
      [1.1, -2],
    ];
    for (const [tempo, pitch] of cases) {
      const { out, reports } = run(data, 14, { tempo, pitch });
      const errors = reports
        .filter((r) => r.atFrame > 1.5 * SR)
        .map((r) => ((r.src - out[Math.min(out.length - 1, r.atFrame)] * total) / SR) * 1000);
      const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
      expect(Math.abs(mean), `tempo ${tempo} pitch ${pitch}`).toBeLessThan(3);
    }
  });

  it("reports the heard position just as accurately at a 44.1 kHz context", () => {
    const rate = 44100;
    const total = rate * 120;
    const data = new Float32Array(total);
    for (let i = 0; i < total; i++) data[i] = i / total;
    for (const [tempo, pitch] of [
      [1, 0],
      [1.05, 2],
      [0.92, -3],
    ]) {
      const { out, reports } = run(data, 14, { tempo, pitch, sampleRate: rate });
      const errors = reports
        .filter((r) => r.atFrame > 1.5 * rate)
        .map((r) => ((r.src - out[Math.min(out.length - 1, r.atFrame)] * total) / rate) * 1000);
      const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
      expect(Math.abs(mean), `tempo ${tempo} pitch ${pitch}`).toBeLessThan(3);
    }
  });

  it("reports positions in absolute source frames, counting from the base the audio was loaded at", () => {
    const { data } = ramp(120);
    const base = 10 * SR;
    // Load only the tail of the source, starting 10 s in, and say so: the reported position carries on from 10 s.
    const { reports } = run(data.slice(base), 6, { baseFrame: base });
    const later = reports.filter((r) => r.atFrame > 2 * SR)[0];
    // 2 s of output at tempo 1 from a 10 s start is about 12 s in.
    expect(later.src / SR).toBeGreaterThan(11.5);
    expect(later.src / SR).toBeLessThan(12.8);
  });

  it("does a bounded amount of work per block once running", () => {
    const source = tones(40);
    for (const [tempo, pitch] of [
      [1, 0],
      [1.1, 0],
      [0.8, -3],
      [1.25, 4],
    ]) {
      const { maxFed } = run(source, 15, { tempo, pitch });
      // One stretcher window of input at most (the stretcher releases audio in bursts), never the 16384-frame batch the
      // library's own filter reads at once.
      expect(maxFed, `tempo ${tempo} pitch ${pitch}`).toBeLessThanOrEqual(6144);
    }
  });

  it("plays the source out, says it has ended, and stops being called", () => {
    const source = tones(3);
    const { ended, out } = run(source, 8);
    expect(ended).toBe(true);
    expect(out.slice(Math.round(2.5 * SR), Math.round(2.9 * SR)).some((v) => v !== 0)).toBe(true);
    expect(out.slice(Math.round(5 * SR)).every((v) => v === 0)).toBe(true);
  });

  it("stops when told to", () => {
    const { make, scope } = load();
    const p = make();
    const source = tones(10);
    p.onMessage({ type: "load", left: source, right: source, baseFrame: 0, atFrame: 0 });
    const left = new Float32Array(QUANTUM);
    const right = new Float32Array(QUANTUM);
    expect(p.process([[]], [[left, right]])).toBe(true);
    p.onMessage({ type: "stop" });
    scope.currentFrame = QUANTUM;
    expect(p.process([[]], [[left, right]])).toBe(false);
  });

  it("plays a mono source on both channels", () => {
    const { make, scope } = load();
    const p = make();
    const source = tones(5);
    p.onMessage({ type: "load", left: source, baseFrame: 0, atFrame: 0 });
    const left = new Float32Array(QUANTUM);
    const right = new Float32Array(QUANTUM);
    for (let f = 0; f < 20 * QUANTUM; f += QUANTUM) {
      scope.currentFrame = f;
      p.process([[]], [[left, right]]);
    }
    expect(Array.from(left)).toEqual(Array.from(right));
    expect(left.some((v) => v !== 0)).toBe(true);
  });
});
