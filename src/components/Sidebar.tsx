"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
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
      className={`block rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
        active
          ? "bg-gradient-to-r from-accent-teal/20 to-accent-purple/20 text-accent-purple border border-border"
          : "text-muted hover:text-foreground hover:bg-surface-hover"
      }`}
    >
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

  function closeOnMobile() {
    setSidebarOpen(false);
  }

  async function handleCreatePlaylist() {
    const id = await createPlaylist();
    setSidebarOpen(false);
    router.push(`/playlist?id=${id}`);
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
        className={`fixed inset-y-0 left-0 z-40 w-60 shrink-0 bg-surface border-r-2 border-border flex flex-col gap-4 p-3 overflow-y-auto md:static ${
          sidebarOpen ? "" : "max-md:hidden"
        }`}
      >
        <div className="px-2 py-2 flex flex-col gap-2">
          <span className="text-xl retro-heading">AI DJ</span>
          <div className="retro-stripe" />
        </div>

        <nav className="flex flex-col gap-1">
          <NavLink href="/" label="Home" onNavigate={closeOnMobile} />
          <NavLink href="/library" label="Music Library" onNavigate={closeOnMobile} />
          <NavLink href="/inspiration" label="DJ Inspiration" onNavigate={closeOnMobile} />
        </nav>

        <div className="flex items-center justify-between px-2 pt-2">
          <span className="text-sm font-semibold text-accent-purple">Your Library</span>
          <button
            type="button"
            onClick={handleCreatePlaylist}
            className="text-accent-purple hover:text-accent-pink text-lg leading-none px-1"
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
                className="rounded-lg px-2 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-hover truncate"
              >
                {playlist.name}
              </Link>
            ))
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 px-2 pt-2 border-t-2 border-border">
          <span className="text-xs text-muted truncate" title={session?.user?.email ?? undefined}>
            {session?.user?.name || session?.user?.email}
          </span>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-xs font-semibold text-accent-purple hover:text-accent-pink shrink-0"
          >
            Log out
          </button>
        </div>
      </aside>
    </>
  );
}
