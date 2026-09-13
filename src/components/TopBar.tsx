"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

/** Live-filters the Library page as you type — debounced so fast typing doesn't spam client navigations. */
const FILTER_DEBOUNCE_MS = 150;

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const urlQuery = useSearchParams().get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync when navigating to a fresh /library?q= link, or
  // away from it (the filter is only meaningful on the Library page).
  useEffect(() => {
    // Syncs the input to the URL's own query param whenever navigation
    // changes it from outside this component (a fresh /library?q= link, or
    // leaving the page) — not derivable at render time since the user's own
    // typing needs to keep winning locally between those external changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(pathname === "/library" ? urlQuery : "");
  }, [pathname, urlQuery]);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.replace(
        value.trim().length === 0 ? "/library" : `/library?q=${encodeURIComponent(value.trim())}`
      );
    }, FILTER_DEBOUNCE_MS);
  }

  return (
    <header className="h-16 shrink-0 flex items-center gap-4 px-4 sm:px-6 shadow-elevate-md bg-surface/90 backdrop-blur">
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden text-accent-purple hover:text-accent-pink text-xl leading-none px-1"
        title="Toggle menu"
      >
        ☰
      </button>
      <div className="flex-1 max-w-xl mx-auto relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted text-sm">
          🔍
        </span>
        <input
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          type="search"
          placeholder="Search your library..."
          className="w-full rounded-full bg-background pl-9 pr-4 py-2.5 text-sm outline-none shadow-elevate-sm focus:shadow-none focus:border focus:border-accent-purple placeholder:text-muted"
        />
      </div>
    </header>
  );
}
