import { describe, expect, it } from "vitest";
import { VOICE_CUT_DEFAULTS, parseVoiceCutSettings } from "./voiceCutSettings";

describe("parseVoiceCutSettings", () => {
  it("is on by default", () => {
    expect(VOICE_CUT_DEFAULTS).toEqual({ enabled: true });
    expect(parseVoiceCutSettings(null)).toEqual({ enabled: true });
  });

  it("reads back an explicit choice", () => {
    expect(parseVoiceCutSettings(JSON.stringify({ enabled: false }))).toEqual({ enabled: false });
    expect(parseVoiceCutSettings(JSON.stringify({ enabled: true }))).toEqual({ enabled: true });
  });

  it("only an explicit false turns it off; junk keeps the default", () => {
    expect(parseVoiceCutSettings(JSON.stringify({}))).toEqual({ enabled: true });
    expect(parseVoiceCutSettings(JSON.stringify({ enabled: 0 }))).toEqual({ enabled: true });
    expect(parseVoiceCutSettings("not json")).toEqual({ enabled: true });
    expect(parseVoiceCutSettings("null")).toEqual({ enabled: true });
    expect(parseVoiceCutSettings("42")).toEqual({ enabled: true });
  });
});
