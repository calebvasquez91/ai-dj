import { describe, expect, it } from "vitest";
import { chunkPages, pageFromScroll, scrollLeftForPage } from "./paging";

describe("chunkPages", () => {
  it("fills pages and leaves a short last one", () => {
    expect(chunkPages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkPages([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("gives a 3x3 quick-picks grid nine to a page", () => {
    const pages = chunkPages(Array.from({ length: 20 }, (_, i) => i), 9);
    expect(pages.map((p) => p.length)).toEqual([9, 9, 2]);
  });

  it("has no pages for no items", () => {
    expect(chunkPages([], 9)).toEqual([]);
  });

  it("treats a bad page size as one per page", () => {
    expect(chunkPages([1, 2], 0)).toEqual([[1], [2]]);
    expect(chunkPages([1, 2], -3)).toEqual([[1], [2]]);
  });
});

describe("pageFromScroll", () => {
  it("is the first page at the start and the last at the end", () => {
    expect(pageFromScroll(0, 900, 4)).toBe(0);
    expect(pageFromScroll(900, 900, 4)).toBe(3);
  });

  it("rounds to the nearest stop", () => {
    expect(pageFromScroll(140, 900, 4)).toBe(0); // 0.47 stops in
    expect(pageFromScroll(160, 900, 4)).toBe(1);
    expect(pageFromScroll(450, 900, 4)).toBe(2); // 1.5 rounds up
  });

  it("is the first page when there is nothing to scroll or only one page", () => {
    expect(pageFromScroll(50, 0, 4)).toBe(0);
    expect(pageFromScroll(50, 900, 1)).toBe(0);
    expect(pageFromScroll(50, 900, 0)).toBe(0);
  });

  it("stays in range when scrolled past either end (rubber-banding)", () => {
    expect(pageFromScroll(-40, 900, 4)).toBe(0);
    expect(pageFromScroll(1000, 900, 4)).toBe(3);
    expect(pageFromScroll(Number.NaN, 900, 4)).toBe(0);
  });
});

describe("scrollLeftForPage", () => {
  it("is the inverse of pageFromScroll at every stop", () => {
    for (let page = 0; page < 5; page++) {
      expect(pageFromScroll(scrollLeftForPage(page, 800, 5), 800, 5)).toBe(page);
    }
  });

  it("clamps the page and handles nothing to scroll", () => {
    expect(scrollLeftForPage(9, 800, 5)).toBe(800);
    expect(scrollLeftForPage(-1, 800, 5)).toBe(0);
    expect(scrollLeftForPage(2, 0, 5)).toBe(0);
    expect(scrollLeftForPage(1, 800, 1)).toBe(0);
  });
});
