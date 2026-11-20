import { describe, expect, it } from "vitest";
import { hasTagValues, tagBpmFrom, tagKeyFrom, tagValuesFrom } from "./tagBpmKey";

describe("tagBpmFrom", () => {
  it("accepts a sane BPM, as a number or as text, to two decimals", () => {
    expect(tagBpmFrom(128)).toBe(128);
    expect(tagBpmFrom("96")).toBe(96);
    expect(tagBpmFrom(127.456)).toBe(127.46);
    expect(tagBpmFrom(" 110.5 ")).toBe(110.5);
    expect(tagBpmFrom(40)).toBe(40);
    expect(tagBpmFrom(300)).toBe(300);
  });

  it("rejects what is not a tempo: a year, a half-time reading, junk, nothing", () => {
    for (const v of [1998, 37, 35, 39.9, 300.1, 0, -120, NaN, Infinity, "", "  ", "fast", null, undefined, {}, [128]]) expect(tagBpmFrom(v), String(v)).toBeNull();
  });
});

describe("tagKeyFrom", () => {
  it("turns the tag spellings BPM Supreme writes into the app's key and Camelot code", () => {
    expect(tagKeyFrom("Am")).toEqual({ tagKey: "A minor", tagCamelotKey: "8A" });
    expect(tagKeyFrom("G")).toEqual({ tagKey: "G major", tagCamelotKey: "9B" });
    expect(tagKeyFrom("Bb")).toEqual({ tagKey: "A# major", tagCamelotKey: "6B" });
    expect(tagKeyFrom("Ebm")).toEqual({ tagKey: "D# minor", tagCamelotKey: "2A" });
    expect(tagKeyFrom("C#m")).toEqual({ tagKey: "C# minor", tagCamelotKey: "12A" });
    expect(tagKeyFrom("12B")).toEqual({ tagKey: "E major", tagCamelotKey: "12B" });
    expect(tagKeyFrom("6a")).toEqual({ tagKey: "G minor", tagCamelotKey: "6A" });
  });

  it("is null for what is not a key", () => {
    for (const v of ["All", "", "none", "13A", 8, null, undefined]) expect(tagKeyFrom(v), String(v)).toBeNull();
  });
});

describe("tagValuesFrom", () => {
  it("takes each part on its own: a file can have a BPM and no key, or the other way round", () => {
    expect(tagValuesFrom({ bpm: 124, key: "Fm" })).toEqual({ tagBpm: 124, tagKey: "F minor", tagCamelotKey: "4A" });
    expect(tagValuesFrom({ bpm: 124 })).toEqual({ tagBpm: 124, tagKey: null, tagCamelotKey: null });
    expect(tagValuesFrom({ key: "Fm" })).toEqual({ tagBpm: null, tagKey: "F minor", tagCamelotKey: "4A" });
    expect(tagValuesFrom({ bpm: 1998, key: "All" })).toEqual({ tagBpm: null, tagKey: null, tagCamelotKey: null });
  });

  it("says whether there is anything to store", () => {
    expect(hasTagValues(tagValuesFrom({ bpm: 120 }))).toBe(true);
    expect(hasTagValues(tagValuesFrom({ key: "Am" }))).toBe(true);
    expect(hasTagValues(tagValuesFrom({ bpm: 5, key: "?" }))).toBe(false);
    expect(hasTagValues(tagValuesFrom({}))).toBe(false);
  });
});
