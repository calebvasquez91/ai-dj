"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { coverGradient } from "@/lib/coverGradient";
import { artistsOf, topTags } from "@/lib/library";
import { SectionHeader, Text } from "@/ui";

/** A colored tile that opens the library searched for `label`. */
function BrowseTile({ label, count }: { label: string; count: number }) {
  return (
    <Link
      href={`/library?q=${encodeURIComponent(label)}`}
      className="flex h-24 flex-col justify-between rounded-card p-3 text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ background: coverGradient(label) }}
    >
      <span className="line-clamp-2 text-base font-bold leading-tight">{label}</span>
      <span className="text-xs text-white/75">
        {count} song{count === 1 ? "" : "s"}
      </span>
    </Link>
  );
}

/**
 * The Search page. On a phone it is deliberately empty: the search box lives in the top bar (TopBar shows it here and
 * only here) and its suggestions and results open right under it. A tablet or desktop already has that box on every
 * page, so there the page offers "Browse all": colored tiles for the genres (tags) and artists in the library, each of
 * which opens the library searched for it.
 */
export default function SearchPage() {
  const localLibrary = useStore((s) => s.localLibrary);
  const genres = useMemo(() => topTags(localLibrary, 12), [localLibrary]);
  const artists = useMemo(() => artistsOf(localLibrary).filter((a) => a.name !== "Unknown artist").sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 12), [localLibrary]);

  return (
    <div className="hidden flex-col gap-6 p-6 tablet:flex">
      {genres.length === 0 && artists.length === 0 ? (
        <Text variant="secondary">Use the search box at the top to find songs, playlists and FX.</Text>
      ) : (
        <>
          <Text variant="secondary">Use the search box at the top, or browse all.</Text>
          {genres.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Genres" />
              <div className="grid grid-cols-3 gap-3 desktop:grid-cols-5">
                {genres.map((g) => (
                  <BrowseTile key={g.tag} label={g.tag} count={g.count} />
                ))}
              </div>
            </section>
          )}
          {artists.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Artists" />
              <div className="grid grid-cols-3 gap-3 desktop:grid-cols-5">
                {artists.map((a) => (
                  <BrowseTile key={a.name} label={a.name} count={a.tracks.length} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
