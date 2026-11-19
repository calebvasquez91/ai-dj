import { describe, expect, it } from "vitest";
import {
  ACTIVE_WINDOW_MS,
  AUDIT_EVENT_TYPES,
  auditEventLabel,
  averageSessionSeconds,
  cleanInfo,
  csvCell,
  dayKey,
  DEVICE_COOKIE,
  deviceIdFromCookie,
  isActiveNow,
  isAuditEventType,
  isDeviceId,
  MAX_SESSION_MS,
  osFromUserAgent,
  parseDayParam,
  playtimeSeries,
  sessionSeconds,
  toCsv,
  weekKey,
} from "./telemetry";

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("device id", () => {
  it("accepts a well-formed id only", () => {
    expect(isDeviceId(ID)).toBe(true);
    for (const bad of ["", "abc", ID + "x", `${ID};drop`, 5, null, undefined]) expect(isDeviceId(bad as never), String(bad)).toBe(false);
  });
  it("is read out of a Cookie header, among other cookies", () => {
    expect(deviceIdFromCookie(`a=1; ${DEVICE_COOKIE}=${ID}; b=2`)).toBe(ID);
    expect(deviceIdFromCookie(`${DEVICE_COOKIE}=not-an-id`)).toBeNull();
    expect(deviceIdFromCookie("a=1")).toBeNull();
    expect(deviceIdFromCookie(null)).toBeNull();
  });
});

describe("isActiveNow", () => {
  it("counts a device heard from within the window, and not one that has gone quiet", () => {
    const now = 1_000_000;
    expect(isActiveNow(now - 1000, now)).toBe(true);
    expect(isActiveNow(new Date(now - ACTIVE_WINDOW_MS), now)).toBe(true);
    expect(isActiveNow(now - ACTIVE_WINDOW_MS - 1, now)).toBe(false);
  });
});

describe("osFromUserAgent", () => {
  it("names the OS, checking phones before the desktops they imitate", () => {
    expect(osFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("iOS");
    expect(osFromUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Android");
    expect(osFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(osFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS");
    expect(osFromUserAgent("Mozilla/5.0 (X11; CrOS x86_64)")).toBe("ChromeOS");
    expect(osFromUserAgent("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
    expect(osFromUserAgent("curl/8")).toBe("unknown");
    expect(osFromUserAgent(null)).toBe("unknown");
  });
});

describe("cleanInfo", () => {
  it("trims, strips control characters and cuts to length, or gives the fallback", () => {
    expect(cleanInfo("  1.2.3\n", 10, "x")).toBe("1.2.3");
    expect(cleanInfo("a".repeat(50), 8, "x")).toHaveLength(8);
    expect(cleanInfo("\u0001\u0002", 8, "unknown")).toBe("unknown");
    expect(cleanInfo(5, 8, "unknown")).toBe("unknown");
  });
});

describe("audit event types", () => {
  it("are the seven the log records, each with a readable label", () => {
    expect([...AUDIT_EVENT_TYPES]).toEqual(["song_added", "song_removed", "playlist_created", "playlist_renamed", "playlist_deleted", "image_added", "image_removed"]);
    expect(isAuditEventType("song_added")).toBe(true);
    expect(isAuditEventType("nope")).toBe(false);
    expect(auditEventLabel("playlist_renamed")).toBe("Playlist renamed");
    expect(auditEventLabel("something_else")).toBe("something_else");
  });
});

describe("csv", () => {
  it("quotes cells that need it and doubles quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-11-19T01:02:03Z"))).toBe("2026-11-19T01:02:03.000Z");
  });
  it("turns a cell that looks like a spreadsheet formula into plain text", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@sum")).toBe("'@sum");
  });
  it("writes a header and rows with CRLF line ends", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"], [2, "z"]])).toBe('a,b\r\n1,"x,y"\r\n2,z\r\n');
  });
});

describe("sessions", () => {
  it("measures a session from its first to its last beat, never negative or over the cap", () => {
    expect(sessionSeconds(0, 90_000)).toBe(90);
    expect(sessionSeconds(5000, 1000)).toBe(0);
    expect(sessionSeconds(0, MAX_SESSION_MS * 3)).toBe(MAX_SESSION_MS / 1000);
  });
  it("averages them, and says 0 for none", () => {
    expect(averageSessionSeconds([{ startedAt: 0, lastBeatAt: 60_000 }, { startedAt: 0, lastBeatAt: 120_000 }])).toBe(90);
    expect(averageSessionSeconds([])).toBe(0);
  });
});

describe("playtime series", () => {
  const rows = [
    { at: Date.UTC(2026, 10, 16, 23), seconds: 100 }, // Monday 16 Nov
    { at: Date.UTC(2026, 10, 16, 1), seconds: 50 },
    { at: Date.UTC(2026, 10, 22, 12), seconds: 10 }, // Sunday 22 Nov (same week)
    { at: Date.UTC(2026, 10, 23, 0), seconds: 5 }, // Monday 23 Nov (next week)
  ];
  it("adds seconds up by UTC day, oldest first", () => {
    expect(playtimeSeries(rows, "day")).toEqual([
      { key: "2026-11-16", seconds: 150 },
      { key: "2026-11-22", seconds: 10 },
      { key: "2026-11-23", seconds: 5 },
    ]);
  });
  it("adds them up by week, a week starting on Monday", () => {
    expect(weekKey(Date.UTC(2026, 10, 22, 12))).toBe("2026-11-16");
    expect(dayKey(Date.UTC(2026, 10, 23, 0))).toBe("2026-11-23");
    expect(playtimeSeries(rows, "week")).toEqual([
      { key: "2026-11-16", seconds: 160 },
      { key: "2026-11-23", seconds: 5 },
    ]);
  });
});

describe("parseDayParam", () => {
  it("reads a day as its start or its end, and rejects anything else", () => {
    expect(parseDayParam("2026-11-19")?.toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(parseDayParam("2026-11-19", true)?.toISOString()).toBe("2026-11-19T23:59:59.999Z");
    for (const bad of ["", "19/11/2026", "2026-13-40", "2026-11-19T00:00", null, 5]) expect(parseDayParam(bad), String(bad)).toBeNull();
  });
});
