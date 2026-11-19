"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { searchTracksWithGenres } from "@/lib/search";
import { TrackList } from "@/components/TrackList";
import { useIsAdmin } from "@/components/FeedbackOwnerProvider";
import { coverGradient } from "@/lib/coverGradient";
import { artistsOf, topTags } from "@/lib/library";
import { genreOverview } from "@/lib/genreLibrary";
import { Button, SectionHeader, Text } from "@/ui";

/** A colored tile that opens the library searched for `label`. */
function BrowseTile({ label, count, showCount = true }: { label: string; count: number; showCount?: boolean }) {
  return (
    <Link
      href={`/library?q=${encodeURIComponent(label)}`}
      className="flex h-24 flex-col justify-between rounded-card p-3 text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ background: coverGradient(label) }}
    >
      <span className="line-clamp-2 text-base font-bold leading-tight">{label}</span>
      {showCount && (
        <span className="text-xs text-white/75">
          {count} song{count === 1 ? "" : "s"}
        </span>
      )}
    </Link>
  );
}

/** How many songs the results list shows at first; "Show more" adds this many again. */
const RESULTS_PAGE = 100;

/** The full list of songs matching a submitted search (Enter or the magnifying glass in the top bar). */
function SearchResults({ query }: { query: string }) {
  const library = useStore((s) => s.localLibrary);
  const libraryLoaded = useStore((s) => s.libraryLoaded);
  const playTrackList = useStore((s) => s.playTrackList);
  const [shown, setShown] = useState(RESULTS_PAGE);
  const results = useMemo(() => searchTracksWithGenres(library, query).map((h) => h.item), [library, query]);
  // A new search starts from the top again (state adjusted while rendering, keyed on the query).
  const [forQuery, setForQuery] = useState(query);
  if (forQuery !== query) {
    setForQuery(query);
    setShown(RESULTS_PAGE);
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6" aria-label="Search results">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Text variant="heading" as="h1">Results for &ldquo;{query}&rdquo;</Text>
          <Text variant="caption">{!libraryLoaded ? "Loading your library…" : `${results.length} song${results.length === 1 ? "" : "s"}`}</Text>
        </div>
        {results.length > 0 && (
          <Button variant="primary" onClick={() => playTrackList(results, 0)}>
            Play these
          </Button>
        )}
      </div>
      {libraryLoaded && results.length === 0 ? (
        <Text variant="secondary">No songs match. Try fewer or different words, a genre like &ldquo;trap&rdquo;, or a decade like &ldquo;90s&rdquo;.</Text>
      ) : (
        <>
          <TrackList tracks={results.slice(0, shown)} />
          {results.length > shown && (
            <Button variant="secondary" className="self-center" onClick={() => setShown((n) => n + RESULTS_PAGE)}>
              Show more ({results.length - shown} left)
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The Search page. With a submitted search in its address (?q=) it shows the full list of matching songs. Without one, on a phone it is deliberately empty: the search box lives in the top bar (TopBar shows it here and
 * only here) and its suggestions and results open right under it. A tablet or desktop already has that box on every
 * page, so there the page offers "Browse all": colored tiles for the genres (tags) and artists in the library, each of
 * which opens the library searched for it.
 */
function SearchBrowse() {
  // A genre's song count is shown to the admin only.
  const isAdmin = useIsAdmin();
  const localLibrary = useStore((s) => s.localLibrary);
  const genres = useMemo(() => genreOverview(localLibrary).genres.slice(0, 12), [localLibrary]);
  const tags = useMemo(() => topTags(localLibrary, 12), [localLibrary]);
  const artists = useMemo(() => artistsOf(localLibrary).filter((a) => a.name !== "Unknown artist").sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 12), [localLibrary]);

  return (
    <div className="hidden flex-col gap-6 p-6 tablet:flex">
      {genres.length === 0 && tags.length === 0 && artists.length === 0 ? (
        <Text variant="secondary">Use the search box at the top to find songs, playlists and FX.</Text>
      ) : (
        <>
          <Text variant="secondary">Use the search box at the top, or browse all.</Text>
          {genres.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Genres" />
              <div className="grid grid-cols-3 gap-3 desktop:grid-cols-5">
                {genres.map((g) => (
                  <BrowseTile key={g.genre} label={g.genre} count={g.count} showCount={isAdmin} />
                ))}
              </div>
            </section>
          )}
          {tags.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Tags" />
              <div className="grid grid-cols-3 gap-3 desktop:grid-cols-5">
                {tags.map((g) => (
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

function SearchPageContent() {
  const submitted = useSearchParams().get("q")?.trim() ?? "";
  return submitted ? <SearchResults query={submitted} /> : <SearchBrowse />;
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageContent />
    </Suspense>
  );
}
