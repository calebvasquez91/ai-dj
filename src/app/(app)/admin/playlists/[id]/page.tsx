import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { formatDuration } from "@/lib/playStats";
import { AdminPlaylistActions, AdminRemoveFromPlaylist } from "@/components/AdminPlaylistActions";

export const metadata = { title: "Playlist" };

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One playlist of any account, in full: its songs in order, with the admin's controls (rename, take songs out, delete). Only the admin;
 * for anyone else the page does not exist. The check comes first, before anything is read.
 */
export default async function AdminPlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await feedbackOwnerSession())) notFound();
  const { id } = await params;

  const playlist = await prisma.playlist.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      theme: true,
      user: { select: { email: true, name: true } },
      tracks: { orderBy: { position: "asc" }, select: { track: { select: { id: true, title: true, artist: true, durationSec: true } } } },
    },
  });
  if (!playlist) notFound();

  let playedSeconds: number | null = null;
  try {
    const r = await prisma.playEvent.aggregate({ where: { playlistId: id }, _sum: { seconds: true } });
    playedSeconds = r._sum.seconds ?? 0;
  } catch {
    // the listening table is not there yet
  }
  const length = playlist.tracks.reduce((sum, t) => sum + t.track.durationSec, 0);
  const owner = playlist.user.name ? `${playlist.user.name} (${playlist.user.email})` : playlist.user.email;

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <Link href="/admin/playlists" className="text-xs text-accent-purple hover:text-accent-pink">← All playlists</Link>
        <h1 className="text-2xl heading break-words">{playlist.name}</h1>
        <p className="text-sm text-muted">
          {owner} · {playlist.tracks.length} {playlist.tracks.length === 1 ? "song" : "songs"} · {formatDuration(length)} long
          {playedSeconds != null ? ` · played ${formatDuration(playedSeconds)} in total` : ""}
        </p>
      </div>

      <AdminPlaylistActions key={playlist.name} playlistId={playlist.id} name={playlist.name} isSystem={playlist.theme != null} />

      {playlist.theme ? (
        <p className="text-xs text-muted">
          This is a system playlist: songs tagged for it also appear in it automatically, and it can&apos;t be deleted.
        </p>
      ) : null}

      <section className="card p-2" aria-label="Songs in this playlist">
        {playlist.tracks.length === 0 ? (
          <p className="p-3 text-sm text-muted">This playlist is empty.</p>
        ) : (
          <ol className="flex flex-col">
            {playlist.tracks.map(({ track }, i) => (
              <li key={track.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-hover">
                <span className="w-6 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 break-words">
                  {track.title}
                  <span className="text-muted"> · {track.artist}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{clock(track.durationSec)}</span>
                <AdminRemoveFromPlaylist playlistId={playlist.id} trackId={track.id} title={track.title} playlistName={playlist.name} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
