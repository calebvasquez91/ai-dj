import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { formatDuration } from "@/lib/playStats";

export const metadata = { title: "All playlists" };

/** The seconds each playlist has been played (the listening statistics); empty when that table does not exist yet. */
async function playtimeByPlaylist(): Promise<Map<string, number>> {
  try {
    const rows = await prisma.playEvent.groupBy({ by: ["playlistId"], where: { playlistId: { not: null } }, _sum: { seconds: true } });
    return new Map(rows.flatMap((r) => (r.playlistId ? [[r.playlistId, r._sum.seconds ?? 0] as [string, number]] : [])));
  } catch {
    return new Map();
  }
}

/**
 * Every account's playlists in one place, grouped by account, with each playlist's size, length and playtime. The admin has full access
 * to all of them (open one to rename it, remove songs, or delete it). Only the admin; for anyone else the page does not exist. The
 * check comes first, before anything is read.
 */
export default async function AllPlaylistsPage() {
  if (!(await feedbackOwnerSession())) notFound();

  const [playlists, played] = await Promise.all([
    prisma.playlist.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        theme: true,
        user: { select: { id: true, email: true, name: true } },
        tracks: { select: { track: { select: { durationSec: true } } } },
      },
    }),
    playtimeByPlaylist(),
  ]);

  const byAccount = new Map<string, { label: string; playlists: typeof playlists }>();
  for (const p of playlists) {
    const entry = byAccount.get(p.user.id) ?? { label: p.user.name ? `${p.user.name} (${p.user.email})` : p.user.email, playlists: [] };
    entry.playlists.push(p);
    byAccount.set(p.user.id, entry);
  }
  const accounts = [...byAccount.entries()].sort((a, b) => b[1].playlists.length - a[1].playlists.length);

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl heading">All playlists</h1>
        <p className="text-sm text-muted">
          {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"} across {accounts.length} {accounts.length === 1 ? "account" : "accounts"}. You have full
          access to every one: open it to rename it, take songs out, or delete it. Only you can see this page.
        </p>
      </div>
      {accounts.length === 0 && <p className="text-sm text-muted">Nobody has made a playlist yet.</p>}
      {accounts.map(([id, account]) => (
        <section key={id} className="card p-4 flex flex-col gap-2" aria-label={account.label}>
          <h2 className="font-semibold break-words">{account.label}</h2>
          <ul className="flex flex-col">
            {account.playlists.map((p) => {
              const seconds = p.tracks.reduce((sum, t) => sum + t.track.durationSec, 0);
              return (
                <li key={p.id}>
                  <Link href={`/admin/playlists/${p.id}`} className="flex items-baseline justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-hover">
                    <span className="min-w-0 break-words">
                      {p.name}
                      {p.theme ? <span className="text-muted"> · system</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted text-right">
                      {p.tracks.length} {p.tracks.length === 1 ? "song" : "songs"} · {formatDuration(seconds)} long
                      {played.has(p.id) ? ` · played ${formatDuration(played.get(p.id) ?? 0)}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
