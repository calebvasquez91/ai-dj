"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { smartPlaylists } from "@/lib/smartPlaylists";
import { savePlaylistFromTracks } from "@/lib/savePlaylist";
import { useIsAdmin } from "@/components/FeedbackOwnerProvider";
import { GenreCover } from "@/components/GenreCover";
import { PlayIcon } from "@/components/Icons";
import { Text } from "@/ui";

/**
 * Playlists the DJ proposes from the library's genres ("Hip-Hop", "Late-night Hip-Hop"), refreshed by themselves as tracks
 * are classified. Each is a big cover with the genre's name over a gradient and a play button; Freeze saves its current tracks
 * as a normal playlist you can edit. The number of songs is shown to the admin only.
 */
export function SmartPlaylists() {
  const router = useRouter();
  const library = useStore((s) => s.localLibrary);
  const playTrackList = useStore((s) => s.playTrackList);
  const isAdmin = useIsAdmin();
  const [freezing, setFreezing] = useState<string | null>(null);
  const lists = useMemo(() => smartPlaylists(library), [library]);
  const byId = useMemo(() => new Map(library.map((t) => [t.id, t])), [library]);
  if (lists.length === 0) return null;

  return (
    <section aria-label="Made by your DJ" className="flex flex-col gap-3">
      <div>
        <Text variant="heading" as="h2">Made by your DJ</Text>
        <Text variant="caption">Smart playlists by genre. They update as your songs are classified. Freeze one to keep and edit it.</Text>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 desktop:grid-cols-4">
        {lists.map((p) => (
          <li key={p.id} className="flex flex-col gap-2">
            <div className="group relative aspect-square w-full overflow-hidden rounded-card border border-border-subtle">
              <GenreCover genre={p.genre} />
              {/* The gradient that keeps the title readable over any cover. */}
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Smart</span>
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-white drop-shadow">{p.title}</p>
                  {isAdmin && <p className="text-xs text-white/80">{p.trackIds.length} songs</p>}
                </div>
                <button
                  type="button"
                  aria-label={`Play ${p.title}`}
                  title={`Play ${p.title}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-background shadow-elevate-md transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
                  onClick={() => {
                    const tracks = p.trackIds.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => t != null);
                    if (tracks.length > 0) playTrackList(tracks, 0);
                  }}
                >
                  <PlayIcon size={20} className="translate-x-0.5" />
                </button>
              </div>
            </div>
            <button
              type="button"
              className="btn-outline !text-xs self-start"
              disabled={freezing === p.id}
              title="Save these songs as a playlist of your own"
              onClick={async () => {
                setFreezing(p.id);
                try {
                  const id = await savePlaylistFromTracks(p.title, p.trackIds);
                  if (id) router.push(`/playlist?id=${id}`);
                } finally {
                  setFreezing(null);
                }
              }}
            >
              {freezing === p.id ? "Saving…" : "Freeze"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
