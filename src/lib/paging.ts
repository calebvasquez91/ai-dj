/**
 * Paging for the swipeable rows: the carousel's page dots and the paged grid. Pure, so the arithmetic is tested; the
 * scrolling itself lives in ui/useScrollPage.ts.
 */

/** Splits items into pages of `perPage` (the last one may be short). A page size under 1 is treated as 1. */
export function chunkPages<T>(items: readonly T[], perPage: number): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/**
 * Which of `count` evenly spaced stops a scroll position is on, given how far the row can scroll in all
 * (scrollWidth - clientWidth). The last stop is where the row can scroll no further, whatever the item widths.
 */
export function pageFromScroll(scrollLeft: number, maxScroll: number, count: number): number {
  if (count <= 1 || maxScroll <= 0 || !Number.isFinite(scrollLeft)) return 0;
  const page = Math.round((scrollLeft / maxScroll) * (count - 1));
  return Math.min(count - 1, Math.max(0, page));
}

/** The scroll position of stop `page` (the inverse of pageFromScroll). */
export function scrollLeftForPage(page: number, maxScroll: number, count: number): number {
  if (count <= 1 || maxScroll <= 0) return 0;
  const clamped = Math.min(count - 1, Math.max(0, page));
  return (clamped / (count - 1)) * maxScroll;
}
