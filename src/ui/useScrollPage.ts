"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pageFromScroll, scrollLeftForPage } from "@/lib/paging";

/**
 * Which page a horizontally scrolling row is on, for the page dots, and a way to scroll to one. `count` is how many
 * stops the row has. The row's `scroll-snap` does the snapping; this only reads where it ended up.
 */
export function useScrollPage(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setPage(pageFromScroll(el.scrollLeft, el.scrollWidth - el.clientWidth, count));
    read();
    el.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      el.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [count]);

  const scrollToPage = useCallback(
    (target: number) => {
      const el = ref.current;
      if (!el) return;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ left: scrollLeftForPage(target, el.scrollWidth - el.clientWidth, count), behavior: reduced ? "auto" : "smooth" });
    },
    [count]
  );

  return { ref, page: Math.min(page, Math.max(0, count - 1)), scrollToPage };
}
