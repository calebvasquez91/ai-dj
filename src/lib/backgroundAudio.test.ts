import { describe, expect, it } from "vitest";
import { AUDIO_GAP_ABANDON_MS, MUTED_GAIN, RESUME_PATIENCE_MS, SILENT_OUTPUT_RMS, STUCK_MUTE_MS, isStuckMuted, looksMuted, mediaPositionState, rmsLevel, shouldResumeContext, silentWavDataUri, wakeVerdict, type WakeInput } from "./backgroundAudio";

describe("shouldResumeContext", () => {
  it("wakes a context that stopped while the app wants sound", () => {
    expect(shouldResumeContext("suspended", true)).toBe(true);
    expect(shouldResumeContext("interrupted", true)).toBe(true); // iOS, not in the DOM typings
  });

  it("leaves a running context, and any context while paused, alone", () => {
    expect(shouldResumeContext("running", true)).toBe(false);
    expect(shouldResumeContext("suspended", false)).toBe(false);
  });

  it("never tries to wake a closed context", () => {
    expect(shouldResumeContext("closed", true)).toBe(false);
  });
});

describe("silentWavDataUri", () => {
  function decode(uri: string): Uint8Array {
    const base64 = uri.slice(uri.indexOf(",") + 1);
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  }

  it("is a data URI for a WAV", () => {
    expect(silentWavDataUri().startsWith("data:audio/wav;base64,")).toBe(true);
  });

  it("has a valid PCM header for the requested length", () => {
    const bytes = decode(silentWavDataUri(0.5, 8000));
    const view = new DataView(bytes.buffer);
    const text = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(4000); // 0.5 s of 8 kHz mono, one byte each
    expect(bytes.length).toBe(44 + 4000);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  });

  it("is all silence (128 is zero in unsigned 8-bit PCM)", () => {
    const bytes = decode(silentWavDataUri(1, 8000));
    expect(bytes.subarray(44).every((b) => b === 0x80)).toBe(true);
  });
});

describe("mediaPositionState", () => {
  it("passes sensible numbers through", () => {
    expect(mediaPositionState(200, 30, 1)).toEqual({ duration: 200, position: 30, playbackRate: 1 });
  });

  it("clamps a position past the end or before the start", () => {
    expect(mediaPositionState(200, 250)?.position).toBe(200);
    expect(mediaPositionState(200, -3)?.position).toBe(0);
  });

  it("refuses numbers the browser would throw on", () => {
    expect(mediaPositionState(0, 0)).toBeNull();
    expect(mediaPositionState(Infinity, 5)).toBeNull();
    expect(mediaPositionState(NaN, 5)).toBeNull();
    expect(mediaPositionState(200, NaN)).toBeNull();
  });

  it("falls back to normal speed for a bad rate", () => {
    expect(mediaPositionState(200, 5, 0)?.playbackRate).toBe(1);
    expect(mediaPositionState(200, 5, NaN)?.playbackRate).toBe(1);
  });
});

describe("wakeVerdict", () => {
  const healthy: WakeInput = {
    contextState: "running",
    wantPlaying: true,
    stoppedForMs: 0,
    wallDeltaMs: 500,
    audioDeltaMs: 500,
    morphActive: true,
    crossfadeScheduled: false,
  };
  const verdict = (over: Partial<WakeInput>) => wakeVerdict({ ...healthy, ...over });

  it("leaves a healthy, running morph alone", () => {
    expect(verdict({})).toEqual({ resume: false, dropMorph: false, giveUp: false });
  });

  it("wakes a stopped context and waits to judge the morph until it runs again", () => {
    expect(verdict({ contextState: "suspended", stoppedForMs: 9000 })).toEqual({ resume: true, dropMorph: false, giveUp: false });
    expect(verdict({ contextState: "interrupted" }).resume).toBe(true);
  });

  it("drops the morph once the context ran again after a long stop", () => {
    expect(verdict({ stoppedForMs: AUDIO_GAP_ABANDON_MS }).dropMorph).toBe(true);
  });

  it("keeps the morph after a stop short enough to be a hiccup", () => {
    expect(verdict({ stoppedForMs: AUDIO_GAP_ABANDON_MS - 1 }).dropMorph).toBe(false);
  });

  it("drops the morph when the page was frozen and the audio clock fell behind real time", () => {
    // a locked iPhone: 8 s of wall time passed, the audio clock moved almost none of it
    expect(verdict({ wallDeltaMs: 8000, audioDeltaMs: 300 }).dropMorph).toBe(true);
  });

  it("keeps the morph through a busy main thread: the wall time passed but so did the audio clock", () => {
    // a 4 s decode froze the page; the audio thread (and the morph's voice) ran the whole time
    expect(verdict({ wallDeltaMs: 4000, audioDeltaMs: 3990 }).dropMorph).toBe(false);
  });

  it("does not read a short gap between checks as a freeze", () => {
    expect(verdict({ wallDeltaMs: AUDIO_GAP_ABANDON_MS - 1, audioDeltaMs: 0 }).dropMorph).toBe(false);
  });

  it("leaves a morph whose crossfade is already scheduled to finish", () => {
    expect(verdict({ stoppedForMs: 9000, crossfadeScheduled: true }).dropMorph).toBe(false);
  });

  it("has nothing to drop without a morph", () => {
    expect(verdict({ stoppedForMs: 9000, morphActive: false }).dropMorph).toBe(false);
  });

  it("does not try to wake a context while paused", () => {
    expect(verdict({ contextState: "suspended", wantPlaying: false }).resume).toBe(false);
  });

  it("keeps trying to wake a context for the whole patience window", () => {
    expect(verdict({ contextState: "interrupted", stoppedForMs: RESUME_PATIENCE_MS - 1 })).toEqual({
      resume: true,
      dropMorph: false,
      giveUp: false,
    });
  });

  it("gives up on a context that stays stopped, instead of fighting the interruption", () => {
    expect(verdict({ contextState: "interrupted", stoppedForMs: RESUME_PATIENCE_MS })).toEqual({
      resume: false,
      dropMorph: true,
      giveUp: true,
    });
  });

  it("takes the stale morph down with it when it gives up, unless its crossfade is already scheduled", () => {
    expect(verdict({ contextState: "suspended", stoppedForMs: RESUME_PATIENCE_MS, morphActive: false }).dropMorph).toBe(false);
    expect(verdict({ contextState: "suspended", stoppedForMs: RESUME_PATIENCE_MS, crossfadeScheduled: true }).dropMorph).toBe(false);
  });

  it("never gives up while the app is paused", () => {
    expect(verdict({ contextState: "suspended", wantPlaying: false, stoppedForMs: RESUME_PATIENCE_MS }).giveUp).toBe(false);
  });
});

describe("rmsLevel", () => {
  it("is 0 for silence and for no samples", () => {
    expect(rmsLevel(new Float32Array(256))).toBe(0);
    expect(rmsLevel([])).toBe(0);
  });

  it("is the sample size for a constant signal", () => {
    expect(rmsLevel([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
  });

  it("is about 0.707 for a full-scale sine", () => {
    const sine = Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * i * 5) / 1000));
    expect(rmsLevel(sine)).toBeCloseTo(Math.SQRT1_2, 2);
  });
});

describe("looksMuted", () => {
  it("is muted when the gain is low and nothing audible comes out", () => {
    expect(looksMuted(0, 0)).toBe(true);
  });

  it("is not muted when the output is audible, whatever the gain reads", () => {
    // a browser that reports a stale 0 for a deck that is really at full gain
    expect(looksMuted(0, 0.2)).toBe(false);
    expect(looksMuted(0, SILENT_OUTPUT_RMS)).toBe(false);
  });

  it("is not muted at an audible gain", () => {
    expect(looksMuted(MUTED_GAIN, 0)).toBe(false);
  });
});

describe("isStuckMuted", () => {
  it("is not stuck the moment it is first seen quiet", () => {
    expect(isStuckMuted({ gain: 0, outputRms: 0, mutedSinceMs: 1000, nowMs: 1000 })).toBe(false);
  });

  it("is stuck once it has stayed quiet long enough", () => {
    expect(isStuckMuted({ gain: 0, outputRms: 0, mutedSinceMs: 1000, nowMs: 1000 + STUCK_MUTE_MS })).toBe(true);
  });

  it("is not stuck at an audible gain, or when it was never seen quiet", () => {
    expect(isStuckMuted({ gain: MUTED_GAIN, outputRms: 0, mutedSinceMs: 0, nowMs: 100000 })).toBe(false);
    expect(isStuckMuted({ gain: 0, outputRms: 0, mutedSinceMs: null, nowMs: 100000 })).toBe(false);
  });

  it("is not stuck while the deck is audibly playing, even if its gain reads zero", () => {
    expect(isStuckMuted({ gain: 0, outputRms: 0.1, mutedSinceMs: 0, nowMs: 100000 })).toBe(false);
  });
});
