"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { smartPlaylists } from "@/lib/smartPlaylists";
import { savePlaylistFromTracks } from "@/lib/savePlaylist";
import { Text } from "@/ui";

/**
 * Playlists the DJ proposes from the library's genres ("Hip-Hop", "Late-night Hip-Hop"), refreshed by themselves as tracks
 * are classified. Play one, or Freeze it: that saves its current tracks as a normal playlist you can edit.
 */
export function SmartPlaylists() {
  const router = useRouter();
  const library = useStore((s) => s.localLibrary);
  const playTrackList = useStore((s) => s.playTrackList);
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
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 desktop:grid-cols-3">
        {lists.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-base font-semibold">{p.title}</span>
              <span className="shrink-0 rounded-full bg-accent-purple/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-purple">Smart</span>
            </div>
            <Text variant="caption">{p.trackIds.length} songs</Text>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const tracks = p.trackIds.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => t != null);
                  if (tracks.length > 0) playTrackList(tracks, 0);
                }}
              >
                Play
              </button>
              <button
                type="button"
                className="btn-outline"
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
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
