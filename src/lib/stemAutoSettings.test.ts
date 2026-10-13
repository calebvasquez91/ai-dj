import { describe, expect, it } from "vitest";
import { STEM_AUTO_DEFAULTS, parseStemAutoSettings } from "./stemAutoSettings";

describe("parseStemAutoSettings", () => {
  it("is off by default (it spends money)", () => {
    expect(STEM_AUTO_DEFAULTS).toEqual({ enabled: false });
    expect(parseStemAutoSettings(null)).toEqual({ enabled: false });
  });

  it("reads back what was saved", () => {
    expect(parseStemAutoSettings(JSON.stringify({ enabled: true }))).toEqual({ enabled: true });
    expect(parseStemAutoSettings(JSON.stringify({ enabled: false }))).toEqual({ enabled: false });
  });

  it("only an explicit true turns it on", () => {
    expect(parseStemAutoSettings(JSON.stringify({ enabled: "yes" }))).toEqual({ enabled: false });
    expect(parseStemAutoSettings(JSON.stringify({ enabled: 1 }))).toEqual({ enabled: false });
    expect(parseStemAutoSettings(JSON.stringify({}))).toEqual({ enabled: false });
  });

  it("falls back to off for junk", () => {
    expect(parseStemAutoSettings("not json")).toEqual({ enabled: false });
    expect(parseStemAutoSettings("null")).toEqual({ enabled: false });
    expect(parseStemAutoSettings("42")).toEqual({ enabled: false });
  });
});
