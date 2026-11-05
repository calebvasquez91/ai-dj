"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SparklesIcon } from "@/components/Icons";

/**
 * The phone's home for what the side panel used to hold besides navigation: the dark-mode switch, who is signed in, Log
 * out, and the DJ Inspiration page (which has no button under the player bar). A round initial in the top bar opens a
 * small card under it. The side panel still carries all of this on tablets and desktops, so this is for phones only.
 */
export function AccountMenu() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardId = useId();
  const who = session?.user?.name || session?.user?.email || "";

  // Going to another page closes it (state adjusted during render, not in an effect).
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account and settings"
        aria-expanded={open}
        aria-controls={cardId}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent-teal to-accent-purple text-sm font-bold uppercase text-white shadow-elevate-sm"
      >
        {who.trim().charAt(0) || "?"}
      </button>
      {open && (
        <div
          id={cardId}
          className="absolute right-0 top-full z-[70] mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl bg-surface p-3 shadow-elevate-md border border-border/10 flex flex-col gap-3"
        >
          <p className="truncate text-sm font-semibold" title={session?.user?.email ?? undefined}>
            {who}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Dark mode</span>
            <ThemeToggle />
          </div>
          <Link
            href="/inspiration"
            className="flex items-center gap-2 rounded-lg px-1 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            <SparklesIcon size={18} />
            DJ Inspiration
          </Link>
          <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="btn-outline w-full">
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
