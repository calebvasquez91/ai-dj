import { describe, expect, it } from "vitest";
import {
  AUTO_FX_MIN_GAP_SEC,
  AUTO_FX_TRANSITION_LEAD_SEC,
  INITIAL_AUTO_FX_STATE,
  decideAutoFx,
  type AutoFxState,
} from "./autoFx";

const DURATION = 200;
/** 100 buckets of 2 s each: valley 0-19, mid 20-39, peak 40-59, mid 60-79, valley 80-99. */
const PROFILE: number[] = Array.from({ length: 100 }, (_, i) => (i < 20 ? 0.1 : i < 40 ? 0.5 : i < 60 ? 0.95 : i < 80 ? 0.5 : 0.1));

function tick(state: AutoFxState, t: number, over: Partial<Parameters<typeof decideAutoFx>[0]> = {}) {
  return decideAutoFx({ enabled: true, trackId: "a", profile: PROFILE, currentTimeSec: t, durationSec: DURATION, state, ...over });
}

/** Plays 0.5 s ticks from `from` to `to`, returning every firing. */
function play(from: number, to: number, start: AutoFxState = INITIAL_AUTO_FX_STATE, over = {}) {
  const fired: { at: number; zone: string }[] = [];
  let state = start;
  for (let t = from; t <= to; t += 0.5) {
    const r = tick(state, t, over);
    state = r.state;
    if (r.fire) fired.push({ at: t, zone: r.fire });
  }
  return { fired, state };
}

describe("decideAutoFx", () => {
  it("fires once on entering a peak, and once on entering the later valley", () => {
    const { fired } = play(0, 190);
    expect(fired.map((f) => f.zone)).toEqual(["peak", "valley"]);
    expect(fired[0].at).toBeCloseTo(80, 0); // bucket 40 starts at 80 s
    expect(fired[1].at).toBeCloseTo(160, 0); // bucket 80 starts at 160 s
  });

  it("does not fire at the start of a track that begins in a valley", () => {
    expect(play(0, 5).fired).toEqual([]);
  });

  it("does not fire on mid zones", () => {
    expect(play(40, 78).fired).toEqual([]);
  });

  it("does nothing while disabled, and does not fire on the next tick after enabling mid-peak", () => {
    const off = play(70, 100, INITIAL_AUTO_FX_STATE, { enabled: false });
    expect(off.fired).toEqual([]);
    const on = play(100.5, 110, off.state);
    expect(on.fired).toEqual([]);
  });

  it("treats a seek into a peak as a seek, not an entry", () => {
    const before = tick(INITIAL_AUTO_FX_STATE, 10).state;
    const jumped = tick(before, 100); // 90 s jump
    expect(jumped.fire).toBeNull();
  });

  it("does not fire in the track's last stretch (the transition's)", () => {
    const profile = Array.from({ length: 100 }, (_, i) => (i < 95 ? 0.5 : 0.95)); // peak from 95% = 190 s, 10 s from the end
    const { fired } = play(150, 199, INITIAL_AUTO_FX_STATE, { profile });
    expect(fired).toEqual([]);
    expect(DURATION - 190).toBeLessThanOrEqual(AUTO_FX_TRANSITION_LEAD_SEC);
  });

  it("keeps a minimum gap between auto effects on a jagged profile", () => {
    const jagged = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0.95 : 0.05)); // zone flips every 2 s
    const { fired } = play(1, 150, INITIAL_AUTO_FX_STATE, { profile: jagged });
    expect(fired.length).toBeGreaterThan(1);
    for (let i = 1; i < fired.length; i++) expect(fired[i].at - fired[i - 1].at).toBeGreaterThanOrEqual(AUTO_FX_MIN_GAP_SEC);
  });

  it("starts fresh on a new track (no stale zone or firing time)", () => {
    const first = play(0, 100);
    const next = tick(first.state, 0, { trackId: "b" });
    expect(next.fire).toBeNull();
    expect(next.state.trackId).toBe("b");
    expect(next.state.lastFiredSec).toBeNull();
  });

  it("does not fire when the profile only becomes available mid-track (analysis finishing late)", () => {
    // playback is already 100 s in with no profile yet (analysis not done)...
    const noProfile = play(100, 104, INITIAL_AUTO_FX_STATE, { profile: [] }).state;
    expect(noProfile.lastZone).toBeNull();
    // ...and the profile arrives at 104.5 s, in the middle of a peak (80-120 s): there is no previous zone to have entered from
    const arrived = tick(noProfile, 104.5);
    expect(arrived.fire).toBeNull();
    // the next real entry after that still fires: the valley at 160 s
    expect(play(105, 170, arrived.state).fired.map((f) => f.zone)).toEqual(["valley"]);
  });

  it("does nothing without a profile or duration", () => {
    expect(play(0, 100, INITIAL_AUTO_FX_STATE, { profile: [] }).fired).toEqual([]);
    expect(tick(INITIAL_AUTO_FX_STATE, 5, { durationSec: 0 }).fire).toBeNull();
  });
});
