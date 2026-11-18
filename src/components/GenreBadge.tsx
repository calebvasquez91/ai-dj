"use client";

import { useIsAdmin } from "@/components/FeedbackOwnerProvider";
import { useGenreClient } from "@/lib/genreClient";
import type { Track } from "@/types/music";

const CHIP = "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide";

/**
 * What a track card shows about its genre: a progress chip while it is waiting for or in a classification job (or if the
 * job failed), else its genre, with a dot when it is waiting for a person to look at it. Nothing for a track with neither.
 */
export function GenreBadge({ track, addWhenEmpty = false }: { track: Track; /** Show an "Add genre" button for a track with no genre (Now Playing), instead of nothing. */ addWhenEmpty?: boolean }) {
  const job = useGenreClient((s) => s.jobs[track.id]);
  // A playlist's tracks do not carry genres; the genre store has them for every classified track.
  const info = useGenreClient((s) => s.fields[track.id]) ?? track;
  const openSheet = useGenreClient((s) => s.openSheet);
  // Genres belong to the shared song: everybody sees them, only the admin changes them.
  const isAdmin = useIsAdmin();
  if (job === "running") return <span className={`${CHIP} bg-accent-purple/15 text-accent-purple`} role="status">Classifying…</span>;
  if (job === "queued") return <span className={`${CHIP} bg-surface-raised text-muted`} role="status">Queued</span>;
  if (job === "failed") return <span className={`${CHIP} bg-accent-pink/15 text-accent-pink`} role="status">Genre failed</span>;
  if (!info.genre) {
    if (!addWhenEmpty || !isAdmin) return null;
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); openSheet(track.id); }} className={`${CHIP} normal-case tracking-normal font-semibold border border-border-subtle text-muted hover:text-foreground`}>
        + Add genre
      </button>
    );
  }
  const review = info.genreStatus === "needs-review";
  if (!isAdmin) {
    return (
      <span className={`${CHIP} normal-case tracking-normal font-semibold bg-surface-raised text-foreground`}>
        {info.genre}
        {info.subgenres?.[0] ? ` · ${info.subgenres[0]}` : ""}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openSheet(track.id);
      }}
      className={`${CHIP} normal-case tracking-normal font-semibold bg-surface-raised text-foreground hover:bg-surface-hover`}
      title={`${review ? "Genre needs review" : info.genreStatus === "confirmed" ? "Genre confirmed" : "Genre set automatically"}. Click to see or change it.`}
    >
      {info.genre}
      {info.subgenres?.[0] ? ` · ${info.subgenres[0]}` : ""}
      {review && <span aria-label="needs review" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent-yellow align-middle" />}
    </button>
  );
}
