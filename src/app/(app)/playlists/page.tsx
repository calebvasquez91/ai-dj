"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { PlusIcon, QueueIcon } from "@/components/Icons";

export default function PlaylistsPage() {
  const router = useRouter();
  const playlists = useStore((s) => s.playlists);
  const playlistsLoaded = useStore((s) => s.playlistsLoaded);
  const createPlaylist = useStore((s) => s.createPlaylist);

  async function handleCreate() {
    const id = await createPlaylist();
    if (id) router.push(`/playlist?id=${id}`);
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-4 max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl heading">Playlists</h1>
        <button type="button" onClick={handleCreate} className="btn-outline" title="Create playlist">
          <PlusIcon size={14} />
          New playlist
        </button>
      </div>

      {playlists.length === 0 ? (
        <p className="text-sm text-muted">
          {playlistsLoaded ? "Playlists you create will show up here." : "Loading…"}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <Link
                href={`/playlist?id=${playlist.id}`}
                className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-elevate-sm hover:bg-surface-hover"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-teal/20 to-accent-purple/20 text-accent-purple">
                  <QueueIcon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{playlist.name}</span>
                  <span className="block text-xs text-muted">
                    {playlist.tracks.length} {playlist.tracks.length === 1 ? "track" : "tracks"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
