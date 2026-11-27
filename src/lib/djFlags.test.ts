import { describe, expect, it } from "vitest";
import * as flags from "./featureFlags";
import { TRANSITION_FX_ENABLED } from "./syncEngine";

// The new DJ abilities each have their own switch, so one can be turned on without another and without the paused
// transition effects (which have their own flag, TRANSITION_FX_ENABLED, and stay as they are).
describe("the DJ ability flags", () => {
  it("are six separate switches: radio, stutter, scratch, EQ and echo-out on; instrumental bridges off until the deck can play one", () => {
    expect(flags.SEED_RADIO_ENABLED).toBe(true);
    expect(flags.STUTTER_ENABLED).toBe(true);
    expect(flags.SCRATCH_ENABLED).toBe(true);
    expect(flags.DJ_EQ_ENABLED).toBe(true);
    expect(flags.ECHO_OUT_ENABLED).toBe(true);
    expect(flags.INSTRUMENTAL_BRIDGE_ENABLED).toBe(false);
  });

  it("leave the existing switches as they were", () => {
    expect(flags.SYNC_TEST_ENABLED).toBe(false);
    expect(flags.SHOW_STEM_BUTTON_ON_SONGS).toBe(false);
    expect(TRANSITION_FX_ENABLED).toBe(false);
  });

  it("have the genre-aware transition switch on, and vocal split off until a job is scheduled to build the instrumentals", () => {
    expect(flags.GENRE_TRANSITIONS_ENABLED).toBe(true);
    expect(flags.VOCAL_SPLIT_ENABLED).toBe(false);
  });
});
