"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";

function NavLink({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-surface-hover text-foreground"
          : "text-muted hover:text-foreground hover:bg-surface-hover"
      }`}
    >
      {label}
    </Link>
  );
}

export function Sidebar() {
  const router = useRouter();
  const playlists = useStore((s) => s.playlists);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);

  function closeOnMobile() {
    setSidebarOpen(false);
  }

  function handleCreatePlaylist() {
    const id = createPlaylist();
    setSidebarOpen(false);
    router.push(`/playlist/${id}`);
  }

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={closeOnMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 shrink-0 bg-black/40 border-r border-border flex flex-col gap-4 p-3 overflow-y-auto md:static ${
          sidebarOpen ? "" : "max-md:hidden"
        }`}
      >
        <div className="px-2 py-2">
          <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-accent to-accent-strong bg-clip-text text-transparent">
            AI DJ
          </span>
        </div>

        <nav className="flex flex-col gap-1">
          <NavLink href="/" label="Home" onNavigate={closeOnMobile} />
          <NavLink href="/library" label="Local Files" onNavigate={closeOnMobile} />
        </nav>

        <div className="flex items-center justify-between px-2 pt-2">
          <span className="text-sm font-semibold text-muted">Your Library</span>
          <button
            type="button"
            onClick={handleCreatePlaylist}
            className="text-muted hover:text-foreground text-lg leading-none px-1"
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
                href={`/playlist/${playlist.id}`}
                onClick={closeOnMobile}
                className="rounded-md px-2 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-hover truncate"
              >
                {playlist.name}
              </Link>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
