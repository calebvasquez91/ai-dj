"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";

export function TopBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(
      query.trim().length === 0
        ? "/library"
        : `/library?q=${encodeURIComponent(query.trim())}`
    );
  }

  return (
    <header className="h-16 shrink-0 flex items-center gap-4 px-4 sm:px-6 border-b border-border bg-background/80 backdrop-blur">
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden text-muted hover:text-foreground text-xl leading-none px-1"
        title="Toggle menu"
      >
        ☰
      </button>
      <form onSubmit={handleSubmit} className="flex-1 max-w-md">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="Filter your local files..."
          className="w-full rounded-full bg-surface px-4 py-2 text-sm outline-none border border-border focus:border-accent placeholder:text-muted"
        />
      </form>
    </header>
  );
}
