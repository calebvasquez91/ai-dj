"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { pinnedFirst } from "@/lib/homeSections";
import { PlusIcon } from "@/components/Icons";
import { Button, CoverMosaic, MediaCard, Skeleton, Text } from "@/ui";

export default function PlaylistsPage() {
  const router = useRouter();
  const playlists = useStore((s) => s.playlists);
  const playlistsLoaded = useStore((s) => s.playlistsLoaded);
  const createPlaylist = useStore((s) => s.createPlaylist);

  async function handleCreate() {
    const id = await createPlaylist();
    if (id) router.push(`/playlist?id=${id}`);
  }

  const ordered = pinnedFirst(playlists);
  const spooky = ordered.find((p) => p.theme === "spooky");
  const others = ordered.filter((p) => p.theme !== "spooky");
  const count = (n: number) => `${n} song${n === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Playlists</h1>
        <Button variant="primary" onClick={handleCreate}>
          <PlusIcon size={14} />
          New playlist
        </Button>
      </div>

      {!playlistsLoaded ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 desktop:grid-cols-5" aria-busy="true" aria-label="Loading playlists">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : playlists.length === 0 ? (
        <Text variant="secondary">Playlists you create will show up here.</Text>
      ) : (
        <>
          {spooky && (
            <button
              type="button"
              onClick={() => router.push(`/playlist?id=${spooky.id}`)}
              className="spooky-card-pulse flex w-full items-center gap-4 rounded-card p-4 text-left text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:max-w-md"
              style={{ background: "linear-gradient(135deg, #1a0500, #3d1200)" }}
            >
              <span className="text-4xl" aria-hidden="true">
                🎃
              </span>
              <span className="min-w-0">
                <span className="block truncate text-lg font-bold">{spooky.name}</span>
                <span className="block text-sm text-white/70">{count(spooky.tracks.length)}</span>
              </span>
            </button>
          )}
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 desktop:grid-cols-5">
            {others.map((p) => (
              <li key={p.id}>
                <MediaCard
                  href={`/playlist?id=${p.id}`}
                  cover={<CoverMosaic title={p.name} items={p.tracks.map((t) => ({ title: t.title, src: t.thumbnailUrl }))} />}
                  title={p.name}
                  subtitle={count(p.tracks.length)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
