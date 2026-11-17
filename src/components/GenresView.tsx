"use client";

import { useMemo } from "react";
import { genreOverview, type GenreFilter } from "@/lib/genreLibrary";
import { useStore } from "@/lib/store";
import { useGenreClient } from "@/lib/genreClient";
import { Text } from "@/ui";

/**
 * Library > Genres: a tile for each genre with its track count, its subgenres under it, and a count of the tracks waiting
 * for review. A tile opens the Songs view filtered to that genre (or subgenre).
 */
export function GenresView({ onPick, onReview, selected }: { onPick: (filter: GenreFilter) => void; onReview: () => void; selected: GenreFilter | null }) {
  const library = useStore((s) => s.localLibrary);
  const overview = useMemo(() => genreOverview(library), [library]);
  const pending = useGenreClient((s) => s.queued + s.running);
  const ready = useGenreClient((s) => s.ready);
  const loaded = useGenreClient((s) => s.loaded);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        {overview.needsReview > 0 && (
          <button type="button" onClick={onReview} className="btn-outline" title="Tracks whose genre the sources were unsure about">
            <span>Needs review</span>
            <span className="ml-2 rounded-full bg-accent-yellow/20 px-2 py-0.5 text-xs font-bold text-accent-yellow" aria-label={`${overview.needsReview} tracks need review`}>
              {overview.needsReview}
            </span>
          </button>
        )}
        {pending > 0 && <Text variant="caption" role="status">Classifying {pending} track{pending === 1 ? "" : "s"}…</Text>}
        {loaded && !ready && <Text variant="caption">Genre classification is not set up on this server yet.</Text>}
      </div>

      {overview.genres.length === 0 ? (
        <Text variant="secondary">
          {library.length === 0 ? "Genres show up here once you add music." : "No genres yet. They appear as your tracks are classified in the background."}
        </Text>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 desktop:grid-cols-3">
          {overview.genres.map((g) => {
            const active = selected?.genre === g.genre;
            return (
              <li key={g.genre} className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
                <button
                  type="button"
                  onClick={() => onPick({ genre: g.genre })}
                  aria-label={`${g.genre}, ${g.count} song${g.count === 1 ? "" : "s"}`}
                  className={`flex items-baseline justify-between gap-3 text-left ${active && !selected?.subgenre ? "text-accent" : ""}`}
                >
                  <span className="text-lg font-semibold">{g.genre}</span>
                  <span className="font-mono text-sm tabular-nums text-muted">{g.count}</span>
                </button>
                {g.subgenres.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {g.subgenres.map((s) => (
                      <li key={s.subgenre}>
                        <button
                          type="button"
                          onClick={() => onPick({ genre: g.genre, subgenre: s.subgenre })}
                          aria-label={`${g.genre}, ${s.subgenre}, ${s.count} song${s.count === 1 ? "" : "s"}`}
                          className="rounded-full bg-surface-raised px-2.5 py-1 text-xs font-semibold hover:bg-surface-hover"
                        >
                          {s.subgenre} <span className="ml-1 font-mono tabular-nums text-muted">{s.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {overview.unclassified > 0 && overview.genres.length > 0 && (
        <Text variant="caption">{overview.unclassified} song{overview.unclassified === 1 ? " has" : "s have"} no genre yet.</Text>
      )}
    </div>
  );
}
