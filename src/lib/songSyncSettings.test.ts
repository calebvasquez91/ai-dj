import { describe, expect, it } from "vitest";
import { SONG_SYNC_DEFAULTS, parseSongSyncSettings } from "./songSyncSettings";

describe("parseSongSyncSettings", () => {
  it("defaults to Auto on", () => {
    expect(SONG_SYNC_DEFAULTS.auto).toBe(true);
    expect(parseSongSyncSettings(null)).toEqual({ auto: true, transitionSounds: true });
  });

  it("defaults transition sounds on, and keeps the choice either way, apart from Auto", () => {
    expect(SONG_SYNC_DEFAULTS.transitionSounds).toBe(true);
    expect(parseSongSyncSettings(JSON.stringify({ auto: true }))).toEqual({ auto: true, transitionSounds: true });
    expect(parseSongSyncSettings(JSON.stringify({ auto: true, transitionSounds: false }))).toEqual({
      auto: true,
      transitionSounds: false,
    });
    expect(parseSongSyncSettings(JSON.stringify({ transitionSounds: "no" }))).toEqual({ auto: true, transitionSounds: true });
  });

  it("keeps a saved choice either way", () => {
    expect(parseSongSyncSettings(JSON.stringify({ auto: false }))).toEqual({ auto: false, transitionSounds: true });
    expect(parseSongSyncSettings(JSON.stringify({ auto: true }))).toEqual({ auto: true, transitionSounds: true });
  });

  it("falls back to the default for anything unusable", () => {
    const defaults = { auto: true, transitionSounds: true };
    expect(parseSongSyncSettings("not json")).toEqual(defaults);
    expect(parseSongSyncSettings("42")).toEqual(defaults);
    expect(parseSongSyncSettings(JSON.stringify({ auto: "yes" }))).toEqual(defaults);
    expect(parseSongSyncSettings("null")).toEqual(defaults);
  });
});
