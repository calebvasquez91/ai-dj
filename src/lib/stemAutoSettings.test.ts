import { describe, expect, it } from "vitest";
import { STEM_AUTO_DEFAULTS, parseStemAutoSettings } from "./stemAutoSettings";

describe("parseStemAutoSettings", () => {
  it("is on by default (the server's budget and one-at-a-time limit hold the spending)", () => {
    expect(STEM_AUTO_DEFAULTS).toEqual({ enabled: true });
    expect(parseStemAutoSettings(null)).toEqual({ enabled: true });
  });

  it("reads back what was saved, so an explicit off stays off", () => {
    expect(parseStemAutoSettings(JSON.stringify({ enabled: true }))).toEqual({ enabled: true });
    expect(parseStemAutoSettings(JSON.stringify({ enabled: false }))).toEqual({ enabled: false });
  });

  it("ignores a non-boolean value and uses the default", () => {
    expect(parseStemAutoSettings(JSON.stringify({ enabled: "no" }))).toEqual({ enabled: true });
    expect(parseStemAutoSettings(JSON.stringify({ enabled: 0 }))).toEqual({ enabled: true });
    expect(parseStemAutoSettings(JSON.stringify({}))).toEqual({ enabled: true });
  });

  it("falls back to the default for junk", () => {
    expect(parseStemAutoSettings("not json")).toEqual({ enabled: true });
    expect(parseStemAutoSettings("null")).toEqual({ enabled: true });
    expect(parseStemAutoSettings("42")).toEqual({ enabled: true });
  });
});
