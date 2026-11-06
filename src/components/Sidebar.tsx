"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useStore } from "@/lib/store";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HomeIcon, LibraryIcon, SearchIcon, SlidersIcon, SparklesIcon } from "@/components/Icons";
import type { ComponentType } from "react";

function NavLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-3 rounded-full pl-2.5 pr-3 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground hover:bg-surface-hover"
      }`}
    >
      <span
        className={`accent-gradient h-4 w-1 rounded-full shrink-0 transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
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

  async function handleCreatePlaylist() {
    const id = await createPlaylist();
    if (id) router.push(`/playlist?id=${id}`);
  }

  // Desktop only: a tablet has the icon rail (NavRail) and a phone the buttons under the player bar (BottomNav), so the
  // panel is never displayed below the desktop width, whatever was chosen. From it, the panel is open until the
  // hamburger collapses it.
  const visibility = sidebarOpen === false ? "hidden" : "max-desktop:hidden";

  return (
    <>
      <aside
        id="app-sidebar"
        className={`w-60 shrink-0 surface-glass border-r border-border/10 shadow-elevate-right flex flex-col gap-4 py-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-3 overflow-y-auto overscroll-contain ${visibility}`}
      >
        <div className="px-2 py-2 flex flex-col gap-2">
          <span className="text-xl wordmark">AI DJ</span>
          <div className="retro-stripe" />
        </div>

        <nav className="flex flex-col gap-1">
          <NavLink href="/" icon={HomeIcon} label="Home" />
          <NavLink href="/library" icon={LibraryIcon} label="Music Library" />
          <NavLink href="/search" icon={SearchIcon} label="Search" />
          <NavLink href="/inspiration" icon={SparklesIcon} label="DJ Inspiration" />
          <NavLink href="/settings" icon={SlidersIcon} label="Settings" />
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
