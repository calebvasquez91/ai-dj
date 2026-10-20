import { beforeEach, describe, expect, it, vi } from "vitest";

// The fallback voice is SoundTouchJS's PitchShifter on a ScriptProcessorNode; replace it with a recording fake so the
// fallback's wiring can be checked without a browser.
const { shifters, FakeShifter } = vi.hoisted(() => {
  const shifters: InstanceType<typeof FakeShifter>[] = [];
  class FakeShifter {
    tempo = 1;
    pitchSemitones = 0;
    percentagePlayed = 0;
    timePlayed = 0;
    node = { connect: vi.fn(), disconnect: vi.fn() };
    off = vi.fn();
    disconnect = vi.fn();
    constructor(
      public ctx: unknown,
      public buffer: unknown,
      public bufferSize: number,
      public onEnd?: () => void
    ) {
      shifters.push(this);
    }
  }
  return { shifters, FakeShifter };
});
vi.mock("soundtouchjs", () => ({ PitchShifter: FakeShifter }));

import { createTimeStretchVoice, preloadTimeStretch } from "./time-stretch";

interface Posted {
  message: Record<string, unknown>;
  transfer?: unknown[];
}
const nodes: FakeWorkletNode[] = [];
class FakeWorkletNode {
  posted: Posted[] = [];
  disconnected = false;
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: Record<string, unknown>, t?: unknown[]) => void };
  constructor(
    public ctx: unknown,
    public name: string,
    public options: unknown
  ) {
    this.port = {
      onmessage: null,
      postMessage: (message, transfer) => {
        this.posted.push({ message, transfer });
      },
    };
    nodes.push(this);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** Delivers a message from the audio thread. */
  emit(data: Record<string, unknown>) {
    this.port.onmessage?.({ data });
  }
}

function fakeCtx(overrides: Record<string, unknown> = {}) {
  return { audioWorklet: { addModule: vi.fn(async () => {}) }, currentTime: 0, sampleRate: 48000, ...overrides } as unknown as AudioContext;
}

function fakeBuffer(seconds: number, channels = 2, sampleRate = 48000): AudioBuffer {
  const length = Math.round(seconds * sampleRate);
  const data = Array.from({ length: channels }, (_, c) => Float32Array.from({ length }, (_, i) => (i + c) / length));
  return {
    length,
    sampleRate,
    duration: seconds,
    numberOfChannels: channels,
    getChannelData: (c: number) => data[c],
  } as unknown as AudioBuffer;
}

const lastLoad = (n: FakeWorkletNode) => n.posted.filter((p) => p.message.type === "load").at(-1)!;
const types = (n: FakeWorkletNode) => n.posted.map((p) => p.message.type);

beforeEach(() => {
  shifters.length = 0;
  nodes.length = 0;
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
});

describe("preloadTimeStretch", () => {
  it("loads the worklet module once per context and says so", async () => {
    const ctx = fakeCtx();
    expect(await preloadTimeStretch(ctx)).toBe(true);
    expect(await preloadTimeStretch(ctx)).toBe(true);
    expect((ctx.audioWorklet.addModule as ReturnType<typeof vi.fn>).mock.calls).toEqual([["/worklets/time-stretch.js"]]);
  });

  it("says false when the browser has no AudioWorklet", async () => {
    vi.stubGlobal("AudioWorkletNode", undefined);
    expect(await preloadTimeStretch(fakeCtx())).toBe(false);
    expect(await preloadTimeStretch(fakeCtx({ audioWorklet: undefined }))).toBe(false);
  });

  it("says false (and does not throw) when the module fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = fakeCtx({ audioWorklet: { addModule: vi.fn(async () => Promise.reject(new Error("404"))) } });
    expect(await preloadTimeStretch(ctx)).toBe(false);
    warn.mockRestore();
  });
});

describe("createTimeStretchVoice", () => {
  it("falls back to the main-thread voice until the worklet has loaded", () => {
    const voice = createTimeStretchVoice(fakeCtx(), fakeBuffer(10), { tempo: 1.05, pitchSemitones: 2 });
    expect(nodes).toHaveLength(0);
    expect(shifters).toHaveLength(1);
    expect(shifters[0].tempo).toBe(1.05);
    expect(shifters[0].pitchSemitones).toBe(2);
    voice.stop();
  });

  it("falls back when the worklet voice cannot be built", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = fakeCtx();
    await preloadTimeStretch(ctx);
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        constructor() {
          throw new Error("InvalidStateError");
        }
      }
    );
    createTimeStretchVoice(ctx, fakeBuffer(5), { tempo: 1, pitchSemitones: 0 });
    expect(shifters).toHaveLength(1);
    warn.mockRestore();
  });

  describe("on the worklet", () => {
    async function worklet(buffer = fakeBuffer(100), options: Record<string, unknown> = {}, ctxOverrides: Record<string, unknown> = {}) {
      const ctx = fakeCtx(ctxOverrides);
      await preloadTimeStretch(ctx);
      const voice = createTimeStretchVoice(ctx, buffer, { tempo: 1.1, pitchSemitones: -2, ...options });
      return { ctx, voice, node: nodes.at(-1)! };
    }

    it("builds a stereo, output-only node and sends tempo then pitch before any audio", async () => {
      const ctx = fakeCtx();
      await preloadTimeStretch(ctx);
      createTimeStretchVoice(ctx, fakeBuffer(10), { tempo: 1.1, pitchSemitones: -2 });
      const node = nodes.at(-1)!;
      expect(node.name).toBe("time-stretch");
      expect(node.options).toEqual({ numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      expect(node.posted.map((p) => p.message)).toEqual([
        { type: "tempo", value: 1.1 },
        { type: "pitch", semitones: -2 },
      ]);
    });

    it("loads the audio from a little before the start, transferring the copies", async () => {
      const buffer = fakeBuffer(100);
      const { voice, node } = await worklet(buffer);
      voice.setStartFraction(0.5);
      const load = lastLoad(node);
      const start = Math.floor(0.5 * buffer.length);
      expect(load.message).toMatchObject({ type: "load", startFrame: start, baseFrame: start - 4096, atFrame: 0, exact: false });
      const left = load.message.left as Float32Array;
      expect(left.length).toBe(buffer.length - (start - 4096));
      expect(left[0]).toBe(buffer.getChannelData(0)[start - 4096]); // a copy of the right slice
      expect(left).not.toBe(buffer.getChannelData(0)); // not the buffer's own memory: it is transferred
      expect(load.transfer).toHaveLength(2);
    });

    it("sends only as much of the source as the caller said it needs", async () => {
      const buffer = fakeBuffer(100);
      const { voice, node } = await worklet(buffer, { maxSourceSec: 12 });
      voice.setStartFraction(0.2);
      const left = lastLoad(node).message.left as Float32Array;
      expect(left.length).toBe(4096 + 12 * 48000);
    });

    it("schedules the start on the audio clock when given a time, and says when the audio is untouched", async () => {
      const { voice, node } = await worklet(fakeBuffer(60), { exact: true });
      voice.setStartFraction(0.1, 7.25);
      expect(lastLoad(node).message).toMatchObject({ atFrame: Math.round(7.25 * 48000), exact: true });
    });

    it("sends one channel for a mono source", async () => {
      const { voice, node } = await worklet(fakeBuffer(20, 1));
      voice.setStartFraction(0);
      const load = lastLoad(node);
      expect(load.message.right).toBeUndefined();
      expect(load.transfer).toHaveLength(1);
    });

    it("clamps a start outside the audio", async () => {
      const buffer = fakeBuffer(10);
      const { voice, node } = await worklet(buffer);
      voice.setStartFraction(3);
      expect(lastLoad(node).message.startFrame).toBe(buffer.length);
      voice.setStartFraction(-1);
      expect(lastLoad(node).message.startFrame).toBe(0);
    });

    it("starts from the top by itself when nobody says where, once the caller's own setup is done", async () => {
      const ctx = fakeCtx();
      await preloadTimeStretch(ctx);
      createTimeStretchVoice(ctx, fakeBuffer(10), { tempo: 1, pitchSemitones: 0 });
      const node = nodes.at(-1)!;
      expect(types(node)).not.toContain("load"); // still inside the caller's synchronous setup
      await Promise.resolve();
      expect(types(node)).toContain("load");
      expect(lastLoad(node).message.startFrame).toBe(0);
    });

    it("does not also start from the top when it was told where to start", async () => {
      const ctx = fakeCtx();
      await preloadTimeStretch(ctx);
      const voice = createTimeStretchVoice(ctx, fakeBuffer(10), { tempo: 1, pitchSemitones: 0 });
      const node = nodes.at(-1)!;
      voice.setStartFraction(0.5);
      await Promise.resolve();
      expect(types(node).filter((t) => t === "load")).toHaveLength(1);
    });

    it("forwards tempo and pitch changes", async () => {
      const { voice, node } = await worklet();
      voice.setTempo(0.95);
      voice.setPitchSemitones(3);
      expect(node.posted.slice(-2).map((p) => p.message)).toEqual([
        { type: "tempo", value: 0.95 },
        { type: "pitch", semitones: 3 },
      ]);
    });

    it("ignores tempo changes on an untouched voice", async () => {
      const { voice, node } = await worklet(fakeBuffer(10), { exact: true });
      const before = node.posted.length;
      voice.setTempo(1.3);
      expect(node.posted).toHaveLength(before);
    });

    it("reports where the audio being heard comes from, carried forward from the last report", async () => {
      const ctx = fakeCtx({ currentTime: 10 });
      await preloadTimeStretch(ctx);
      const voice = createTimeStretchVoice(ctx, fakeBuffer(100), { tempo: 1, pitchSemitones: 0 });
      const node = nodes.at(-1)!;
      voice.setStartFraction(0.3);
      expect(voice.getPositionSec()).toBeCloseTo(30, 3); // before any report: the start
      node.emit({ type: "pos", sourceFrame: 40 * 48000, atFrame: 10 * 48000 });
      expect(voice.getPositionSec()).toBeCloseTo(40, 3);
      (ctx as unknown as { currentTime: number }).currentTime = 10.5; // half a second on at tempo 1
      expect(voice.getPositionSec()).toBeCloseTo(40.5, 3);
      voice.setTempo(1.2);
      (ctx as unknown as { currentTime: number }).currentTime = 11; // a second on, now at 1.2x
      expect(voice.getPositionSec()).toBeCloseTo(40 + 1.2, 3);
    });

    it("forgets the last report when it is re-seeked", async () => {
      const ctx = fakeCtx();
      await preloadTimeStretch(ctx);
      const voice = createTimeStretchVoice(ctx, fakeBuffer(100), { tempo: 1, pitchSemitones: 0 });
      const node = nodes.at(-1)!;
      voice.setStartFraction(0.3);
      node.emit({ type: "pos", sourceFrame: 40 * 48000, atFrame: 0 });
      voice.setStartFraction(0.8);
      expect(voice.getPositionSec()).toBeCloseTo(80, 3);
    });

    it("calls onEnd when the audio thread says the source is done, but not after stop()", async () => {
      const onEnd = vi.fn();
      const { voice, node } = await worklet(fakeBuffer(10), { onEnd });
      node.emit({ type: "ended" });
      expect(onEnd).toHaveBeenCalledTimes(1);
      voice.stop();
      node.port.onmessage?.({ data: { type: "ended" } });
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it("stops the processor and disconnects, and ignores later calls", async () => {
      const { voice, node } = await worklet(fakeBuffer(10));
      voice.stop();
      expect(node.posted.at(-1)!.message).toEqual({ type: "stop" });
      expect(node.disconnected).toBe(true);
      expect(node.port.onmessage).toBeNull();
      const count = node.posted.length;
      voice.setStartFraction(0.5);
      expect(node.posted).toHaveLength(count); // nothing is loaded into a stopped voice
    });
  });

  describe("on the fallback", () => {
    it("keeps the old calibrations: it starts a little past the asked start and reports a position that much behind its read position", () => {
      const voice = createTimeStretchVoice(fakeCtx(), fakeBuffer(100), { tempo: 1, pitchSemitones: 0 });
      voice.setStartFraction(0.5);
      expect(shifters[0].percentagePlayed).toBeCloseTo(0.5 + 0.027 / 100, 6);
      shifters[0].timePlayed = 60;
      expect(voice.getPositionSec()).toBeCloseTo(59.8, 6);
      voice.setTempo(1.1);
      voice.setPitchSemitones(2);
      expect(shifters[0].tempo).toBe(1.1);
      expect(shifters[0].pitchSemitones).toBe(2);
      voice.stop();
      expect(shifters[0].off).toHaveBeenCalled();
      expect(shifters[0].disconnect).toHaveBeenCalled();
    });
  });
});
