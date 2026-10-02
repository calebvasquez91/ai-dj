import { describe, expect, it } from "vitest";
import { parseRangeHeader } from "@/lib/range";

describe("parseRangeHeader", () => {
  const size = 1000;

  it("serves the whole file when there is no usable Range header", () => {
    expect(parseRangeHeader(null, size)).toEqual({ kind: "none" });
    expect(parseRangeHeader("", size)).toEqual({ kind: "none" });
    expect(parseRangeHeader("items=0-5", size)).toEqual({ kind: "none" });
    expect(parseRangeHeader("bytes=abc", size)).toEqual({ kind: "none" });
    expect(parseRangeHeader("bytes=-", size)).toEqual({ kind: "none" });
  });

  it("ignores multi-range requests (served as a full 200)", () => {
    expect(parseRangeHeader("bytes=0-1,5-6", size)).toEqual({ kind: "none" });
  });

  it("parses explicit and open-ended ranges", () => {
    expect(parseRangeHeader("bytes=0-99", size)).toEqual({ kind: "range", start: 0, end: 99 });
    expect(parseRangeHeader("bytes=500-", size)).toEqual({ kind: "range", start: 500, end: 999 });
    expect(parseRangeHeader("bytes=999-999", size)).toEqual({ kind: "range", start: 999, end: 999 });
  });

  it("clamps an end past EOF", () => {
    expect(parseRangeHeader("bytes=900-5000", size)).toEqual({ kind: "range", start: 900, end: 999 });
  });

  it("parses suffix ranges, clamping to the whole file", () => {
    expect(parseRangeHeader("bytes=-100", size)).toEqual({ kind: "range", start: 900, end: 999 });
    expect(parseRangeHeader("bytes=-5000", size)).toEqual({ kind: "range", start: 0, end: 999 });
  });

  it("reports 416 when the first byte is at or past EOF", () => {
    expect(parseRangeHeader("bytes=1000-", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=5000-6000", size)).toEqual({ kind: "unsatisfiable" });
  });

  it("reports 416 for a zero-length suffix", () => {
    expect(parseRangeHeader("bytes=-0", size)).toEqual({ kind: "unsatisfiable" });
  });

  it("ignores a range whose end precedes its start", () => {
    expect(parseRangeHeader("bytes=50-10", size)).toEqual({ kind: "none" });
  });

  it("reports 416 for any range on an empty file", () => {
    expect(parseRangeHeader("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=-5", 0)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader(null, 0)).toEqual({ kind: "none" });
  });

  it("rejects numbers beyond safe-integer precision", () => {
    expect(parseRangeHeader("bytes=99999999999999999999-", size)).toEqual({ kind: "unsatisfiable" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRangeHeader("  bytes=0-9 ", size)).toEqual({ kind: "range", start: 0, end: 9 });
  });
});
