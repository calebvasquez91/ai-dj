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
    <header className="h-16 shrink-0 flex items-center gap-4 px-4 sm:px-6 border-b-2 border-border bg-surface/90 backdrop-blur">
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden text-accent-purple hover:text-accent-pink text-xl leading-none px-1"
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
          className="w-full rounded-full bg-background px-4 py-2 text-sm outline-none border-2 border-border focus:border-accent-purple placeholder:text-muted"
        />
      </form>
    </header>
  );
}
