import { describe, expect, it } from "vitest";
import { SONG_SYNC_DEFAULTS, parseSongSyncSettings } from "./songSyncSettings";

describe("parseSongSyncSettings", () => {
  it("defaults to Auto on", () => {
    expect(SONG_SYNC_DEFAULTS.auto).toBe(true);
    expect(parseSongSyncSettings(null)).toEqual({ auto: true });
  });

  it("keeps a saved choice either way", () => {
    expect(parseSongSyncSettings(JSON.stringify({ auto: false }))).toEqual({ auto: false });
    expect(parseSongSyncSettings(JSON.stringify({ auto: true }))).toEqual({ auto: true });
  });

  it("falls back to the default for anything unusable", () => {
    expect(parseSongSyncSettings("not json")).toEqual({ auto: true });
    expect(parseSongSyncSettings("42")).toEqual({ auto: true });
    expect(parseSongSyncSettings(JSON.stringify({ auto: "yes" }))).toEqual({ auto: true });
    expect(parseSongSyncSettings("null")).toEqual({ auto: true });
  });
});
