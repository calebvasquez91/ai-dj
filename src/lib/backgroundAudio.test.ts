import { describe, expect, it } from "vitest";
import { MUTED_GAIN, STUCK_MUTE_MS, isStuckMuted, mediaPositionState, shouldResumeContext, silentWavDataUri } from "./backgroundAudio";

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

describe("isStuckMuted", () => {
  it("is not stuck the moment it is first seen quiet", () => {
    expect(isStuckMuted({ gain: 0, mutedSinceMs: 1000, nowMs: 1000 })).toBe(false);
  });

  it("is stuck once it has stayed quiet long enough", () => {
    expect(isStuckMuted({ gain: 0, mutedSinceMs: 1000, nowMs: 1000 + STUCK_MUTE_MS })).toBe(true);
  });

  it("is not stuck at an audible gain, or when it was never seen quiet", () => {
    expect(isStuckMuted({ gain: MUTED_GAIN, mutedSinceMs: 0, nowMs: 100000 })).toBe(false);
    expect(isStuckMuted({ gain: 0, mutedSinceMs: null, nowMs: 100000 })).toBe(false);
  });
});
