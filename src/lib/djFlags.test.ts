import { describe, expect, it } from "vitest";
import * as flags from "./featureFlags";
import { TRANSITION_FX_ENABLED } from "./syncEngine";

// The new DJ abilities each have their own switch and all start off, so one can be turned on without another and without the paused
// transition effects (which have their own flag, TRANSITION_FX_ENABLED, and stay as they are).
describe("the DJ ability flags", () => {
  it("are six separate switches, all off by default", () => {
    expect(flags.SEED_RADIO_ENABLED).toBe(false);
    expect(flags.STUTTER_ENABLED).toBe(false);
    expect(flags.SCRATCH_ENABLED).toBe(false);
    expect(flags.INSTRUMENTAL_BRIDGE_ENABLED).toBe(false);
    expect(flags.DJ_EQ_ENABLED).toBe(false);
    expect(flags.ECHO_OUT_ENABLED).toBe(false);
  });

  it("leave the existing switches as they were", () => {
    expect(flags.SYNC_TEST_ENABLED).toBe(false);
    expect(flags.SHOW_STEM_BUTTON_ON_SONGS).toBe(false);
    expect(TRANSITION_FX_ENABLED).toBe(false);
  });

  it("keep the genre-aware transition and vocal-split switches off until they are verified", () => {
    expect(flags.GENRE_TRANSITIONS_ENABLED).toBe(false);
    expect(flags.VOCAL_SPLIT_ENABLED).toBe(false);
  });
});
