"use client";

import { Children, type ReactNode } from "react";
import { PageDots } from "./PageDots";
import { cx } from "./cx";
import { useScrollPage } from "./useScrollPage";

/**
 * A horizontal row that snaps item by item, scrollbar hidden. `itemClassName` sets the width of each item (`w-40` for a
 * shelf of covers, `w-[85%]` for a hero card that lets the next one peek in). With `dots`, page dots sit underneath.
 */
export function Carousel({
  label,
  children,
  itemClassName = "w-40",
  dots = false,
  className,
}: {
  label: string;
  children: ReactNode;
  itemClassName?: string;
  dots?: boolean;
  className?: string;
}) {
  const items = Children.toArray(children);
  const { ref, page, scrollToPage } = useScrollPage(items.length);

  return (
    <div role="region" aria-roledescription="carousel" aria-label={label} className={className}>
      <div
        ref={ref}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 motion-reduce:scroll-auto sm:-mx-6 sm:px-6"
      >
        {items.map((item, i) => (
          <div key={i} className={cx("shrink-0 snap-start scroll-ml-4", itemClassName)} aria-roledescription="slide" aria-label={`${i + 1} of ${items.length}`}>
            {item}
          </div>
        ))}
      </div>
      {dots && <PageDots count={items.length} page={page} onSelect={scrollToPage} label={label} />}
    </div>
  );
}
