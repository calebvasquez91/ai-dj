import { describe, expect, it } from "vitest";
import { activityFilterParams, formatBytes, limitBytes, parseActivityFilter, shortDeviceId, usageLine } from "./activity";

describe("parseActivityFilter", () => {
  it("reads a date range and an event type from the address", () => {
    const f = parseActivityFilter({ from: "2026-11-01", to: "2026-11-19", type: "song_added" });
    expect(f.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(f.to?.toISOString()).toBe("2026-11-19T23:59:59.999Z");
    expect(f.type).toBe("song_added");
  });
  it("ignores anything that is not well formed", () => {
    expect(parseActivityFilter({ from: "yesterday", to: "2026-99-99", type: "drop table" })).toEqual({ from: null, to: null, type: null });
    expect(parseActivityFilter({})).toEqual({ from: null, to: null, type: null });
  });
  it("puts a range given backwards the right way round, and takes the first of a repeated value", () => {
    const f = parseActivityFilter({ from: "2026-11-19", to: "2026-11-01" });
    expect(f.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(f.to?.toISOString()).toBe("2026-11-19T23:59:59.999Z");
    expect(parseActivityFilter({ type: ["image_added", "song_added"] }).type).toBe("image_added");
  });
});

describe("activityFilterParams", () => {
  it("keeps only what is set", () => {
    expect(activityFilterParams({ from: "2026-11-01", to: "", type: "song_removed" }).toString()).toBe("from=2026-11-01&type=song_removed");
    expect(activityFilterParams({}).toString()).toBe("");
  });
});

describe("formatBytes and usageLine", () => {
  it("writes sizes readably", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
  it("shows usage against a limit, or on its own when there is no limit", () => {
    expect(usageLine(1024 ** 3, 4 * 1024 ** 3)).toBe("1.0 GB of 4.0 GB (25%)");
    expect(usageLine(1024 ** 3, null)).toBe("1.0 GB used");
    expect(usageLine(1024, 0)).toBe("1.0 KB used");
  });
  it("reads a limit from a setting, and refuses a missing or non-positive one", () => {
    expect(limitBytes("100", 1024 ** 3)).toBe(100 * 1024 ** 3);
    for (const bad of [undefined, "", "0", "-5", "lots"]) expect(limitBytes(bad, 1024 ** 3), String(bad)).toBeNull();
  });
});

describe("shortDeviceId", () => {
  it("shows the first eight characters, or unknown", () => {
    expect(shortDeviceId("123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567");
    expect(shortDeviceId(null)).toBe("unknown");
  });
});
