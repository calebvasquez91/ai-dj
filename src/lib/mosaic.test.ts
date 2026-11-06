import { describe, expect, it } from "vitest";
import { mosaicTiles } from "./mosaic";

describe("mosaicTiles", () => {
  it("takes the first four when there are four or more", () => {
    expect(mosaicTiles([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4]);
    expect(mosaicTiles([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it("uses just the first when there are fewer than four", () => {
    expect(mosaicTiles([1, 2, 3])).toEqual([1]);
    expect(mosaicTiles([7])).toEqual([7]);
  });

  it("is empty for none", () => {
    expect(mosaicTiles([])).toEqual([]);
  });
});
