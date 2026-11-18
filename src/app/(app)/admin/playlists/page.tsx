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

const ACTION_TEXT: Record<string, string> = {
  "playlist.rename": "renamed",
  "playlist.delete": "deleted",
  "playlist.add-song": "added a song to",
  "playlist.remove-song": "took a song out of",
  "playlist.reorder": "reordered",
};

/** The admin's latest changes to other accounts' playlists; empty when the log table does not exist yet. */
async function recentAdminActions() {
  try {
    return await prisma.adminAction.findMany({ orderBy: { createdAt: "desc" }, take: 15 });
  } catch {
    return [];
  }
}

/**
 * Every account's playlists in one place, grouped by account, with each playlist's size, length and playtime. The admin has full access
 * to all of them (open one to rename it, remove songs, or delete it). Only the admin; for anyone else the page does not exist. The
 * check comes first, before anything is read.
 */
export default async function AllPlaylistsPage() {
  if (!(await feedbackOwnerSession())) notFound();

  const [playlists, played, actions] = await Promise.all([
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
    recentAdminActions(),
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
      {actions.length > 0 && (
        <section className="card p-4 flex flex-col gap-2" aria-label="Recent admin changes">
          <h2 className="font-semibold">Recent admin changes</h2>
          <ul className="flex flex-col gap-1">
            {actions.map((a) => (
              <li key={a.id} className="text-xs text-muted break-words">
                {a.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · {ACTION_TEXT[a.action] ?? a.action} &ldquo;{a.playlistName}&rdquo;
                {a.ownerEmail ? ` (${a.ownerEmail})` : ""}
                {a.detail ? ` · ${a.detail}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
