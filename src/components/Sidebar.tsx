"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useStore } from "@/lib/store";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { isDesktopViewport, sidebarShowing } from "@/lib/viewport";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HomeIcon, LibraryIcon, SparklesIcon } from "@/components/Icons";
import type { ComponentType } from "react";

function NavLink({
  href,
  icon: Icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`relative flex items-center gap-3 rounded-full pl-2.5 pr-3 py-2 text-sm font-semibold transition-colors ${
        active
          ? "bg-gradient-to-r from-accent-teal/20 to-accent-purple/20 text-accent-purple border border-accent-purple/25"
          : "text-muted hover:text-foreground hover:bg-surface-hover border border-transparent"
      }`}
    >
      <span
        className={`h-4 w-1 rounded-full shrink-0 transition-opacity ${active ? "bg-gradient-to-b from-accent-teal to-accent-purple opacity-100" : "opacity-0"}`}
        aria-hidden="true"
      />
      <Icon size={18} />
      {label}
    </Link>
  );
}

export function Sidebar() {
  const router = useRouter();
  const { data: session } = useSession();
  const playlists = useStore((s) => s.playlists);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const desktop = useIsDesktop();

  // On a phone the panel is a drawer that covers the page, so picking something closes it (back to "no choice", so a
  // rotation to a wider layout still opens it by default); on desktop it sits beside the page and stays as left.
  function closeOnMobile() {
    if (!isDesktopViewport()) setSidebarOpen(null);
  }

  async function handleCreatePlaylist() {
    const id = await createPlaylist();
    if (!id) return;
    closeOnMobile();
    router.push(`/playlist?id=${id}`);
  }

  // Escape closes the drawer, as it does the other overlays.
  const drawerOpen = sidebarShowing(sidebarOpen, desktop) && !desktop;
  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSidebarOpen(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, setSidebarOpen]);

  // Visibility is decided in CSS from the stored choice, so the first paint is already right: with no choice yet the
  // panel is hidden below the desktop breakpoint and shown above it; an explicit choice wins on both.
  const visibility = sidebarOpen === true ? "" : sidebarOpen === false ? "hidden" : "max-md:hidden";

  return (
    <>
      {/* The drawer and its dimming start below the top bar (so the hamburger that opened it stays on screen to close
          it) and stop above the player bar and Que's lane (so neither is ever covered). */}
      {sidebarOpen === true && (
        <div
          className="fixed inset-x-0 top-[var(--topbar-h)] bottom-[var(--player-bar-h)] z-30 bg-black/50 md:hidden"
          onClick={closeOnMobile}
          aria-hidden="true"
        />
      )}
      <aside
        id="app-sidebar"
        className={`fixed left-0 top-[var(--topbar-h)] bottom-[var(--chrome-bottom)] z-40 w-[min(18rem,85vw)] shrink-0 surface-glass border-r border-border/10 shadow-elevate-right flex flex-col gap-4 py-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-3 overflow-y-auto overscroll-contain md:static md:top-auto md:bottom-auto md:w-60 ${visibility}`}
      >
        <div className="px-2 py-2 flex flex-col gap-2">
          <span className="text-xl wordmark">AI DJ</span>
          <div className="retro-stripe" />
        </div>

        <nav className="flex flex-col gap-1">
          <NavLink href="/" icon={HomeIcon} label="Home" onNavigate={closeOnMobile} />
          <NavLink href="/library" icon={LibraryIcon} label="Music Library" onNavigate={closeOnMobile} />
          <NavLink href="/inspiration" icon={SparklesIcon} label="DJ Inspiration" onNavigate={closeOnMobile} />
        </nav>

        <div className="flex items-center justify-between px-2 pt-2">
          <span className="text-sm font-semibold text-accent-purple">Your Library</span>
          <button
            type="button"
            onClick={handleCreatePlaylist}
            className="btn-icon text-accent-purple hover:text-accent-pink text-lg leading-none"
            title="Create playlist"
          >
            +
          </button>
        </div>

        <div className="flex flex-col gap-1 px-1">
          {playlists.length === 0 ? (
            <p className="px-2 text-xs text-muted">
              Playlists you create will show up here.
            </p>
          ) : (
            playlists.map((playlist) => (
              <Link
                key={playlist.id}
                href={`/playlist?id=${playlist.id}`}
                onClick={closeOnMobile}
                title={playlist.name}
                className="rounded-lg px-2 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-hover break-words"
              >
                {playlist.name}
              </Link>
            ))
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-2 border-t border-border/10">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs text-muted">Dark mode</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between gap-2 px-2">
            <span className="text-xs text-muted truncate" title={session?.user?.email ?? undefined}>
              {session?.user?.name || session?.user?.email}
            </span>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="btn-outline !px-2.5 !py-1 text-xs shrink-0"
            >
              Log out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
