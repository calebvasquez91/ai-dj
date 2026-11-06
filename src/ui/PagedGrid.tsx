"use client";

import type { ReactNode } from "react";
import { chunkPages } from "@/lib/paging";
import { PageDots } from "./PageDots";
import { useScrollPage } from "./useScrollPage";

/**
 * A grid that pages sideways, with page dots: `columns` x `rows` items to a page, so 3 x 3 is the "Quick picks" /
 * speed-dial section. Each page is one full-width snap stop.
 */
export function PagedGrid<T>({
  label,
  items,
  columns = 3,
  rows = 3,
  getKey,
  renderItem,
}: {
  label: string;
  items: readonly T[];
  columns?: number;
  rows?: number;
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const pages = chunkPages(items, columns * rows);
  const { ref, page, scrollToPage } = useScrollPage(pages.length);

  return (
    <div role="region" aria-roledescription="carousel" aria-label={label}>
      <div ref={ref} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto scroll-smooth motion-reduce:scroll-auto">
        {pages.map((pageItems, pageIndex) => (
          <div
            key={pageIndex}
            className="grid w-full shrink-0 snap-start gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            aria-roledescription="slide"
            aria-label={`${pageIndex + 1} of ${pages.length}`}
          >
            {pageItems.map((item, i) => (
              <div key={getKey(item)} className="min-w-0">
                {renderItem(item, pageIndex * columns * rows + i)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <PageDots count={pages.length} page={page} onSelect={scrollToPage} label={label} />
    </div>
  );
}
