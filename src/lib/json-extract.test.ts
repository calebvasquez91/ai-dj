import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./json-extract";

describe("extractJsonObject", () => {
  it("parses plain JSON", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips a ```json fence", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("throws on non-JSON", () => {
    expect(() => extractJsonObject("sorry, no")).toThrow();
  });
});
