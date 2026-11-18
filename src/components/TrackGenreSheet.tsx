"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { useGenreClient } from "@/lib/genreClient";
import { genreChipLabels, suggestionRows } from "@/lib/genreLibrary";
import { GenrePicker } from "@/components/GenrePicker";
import { Sheet, Text } from "@/ui";

const STATUS_TEXT = {
  auto: "Set automatically.",
  "needs-review": "Needs a look: the sources were unsure or disagreed.",
  confirmed: "Confirmed by you. A re-run never changes this.",
} as const;

/**
 * The track's genre sheet: its genres and moods, what each source suggested (one tap takes a suggestion), a picker for
 * any genre on the list, and the actions: re-classify, and take back your own choice. Opened from any genre chip.
 * Each person edits their own copy of a track.
 */
export function TrackGenreSheetHost() {
  const trackId = useGenreClient((s) => s.sheetTrackId);
  const close = useGenreClient((s) => s.closeSheet);
  const libraryTrack = useStore((s) => (trackId ? s.localLibrary.find((t) => t.id === trackId) : undefined));
  const fields = useGenreClient((s) => (trackId ? s.fields[trackId] : undefined));
  const job = useGenreClient((s) => (trackId ? s.jobs[trackId] : undefined));
  const setGenres = useGenreClient((s) => s.setGenres);
  const clearGenres = useGenreClient((s) => s.clearGenres);
  const reclassify = useGenreClient((s) => s.reclassify);
  const error = useGenreClient((s) => s.error);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const track = libraryTrack ? { ...libraryTrack, ...fields } : undefined;
  const chips = track ? genreChipLabels(track) : { genres: [], moods: [] };
  const suggestions = track ? suggestionRows(track) : [];
  const confirmed = track?.genreStatus === "confirmed";

  async function save(picks: { genre: string; subgenre?: string }[]) {
    setSaving(true);
    try {
      if (await setGenres(trackId!, picks)) setPicking(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={track != null} onClose={() => { setPicking(false); close(); }} title={track ? `Genres: ${track.title}` : "Genres"} bottomOffset="0px">
      {track && (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1.5">
            <Text variant="caption">{track.artist}</Text>
            {chips.genres.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Genres">
                {chips.genres.map((g) => (
                  <li key={g} className="rounded-full bg-surface-raised px-3 py-1 text-sm font-semibold">{g}</li>
                ))}
              </ul>
            ) : (
              <Text variant="secondary">{job ? "Looking up the genre…" : "No genre yet."}</Text>
            )}
            {chips.moods.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Moods">
                {chips.moods.map((m) => (
                  <li key={m} className="rounded-full border border-border-subtle px-2.5 py-0.5 text-xs text-muted">{m}</li>
                ))}
              </ul>
            )}
            {track.genreStatus && <Text variant="caption">{STATUS_TEXT[track.genreStatus]}</Text>}
            {track.genreDisagrees && (
              <Text variant="caption" className="text-accent-yellow">
                The sources now point somewhere else than your choice. Yours is kept.
              </Text>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Text variant="heading" as="h3">Suggestions</Text>
              <ul className="flex flex-col gap-1.5">
                {suggestions.map((s) => (
                  <li key={`${s.tag.source}-${s.label}`}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void save([{ genre: s.tag.genre, ...(s.tag.subgenre ? { subgenre: s.tag.subgenre } : {}) }])}
                      className="flex w-full items-center justify-between gap-3 rounded-lg bg-surface-raised px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
                      title="Use this genre"
                    >
                      <span className="font-semibold">{s.label}</span>
                      <span className="text-xs text-muted">{s.percent}% · {s.sourceLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {picking ? (
              <GenrePicker onPick={(p) => void save([p])} onCancel={() => setPicking(false)} busy={saving} />
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn" onClick={() => setPicking(true)}>Choose another genre</button>
                <button type="button" className="btn-outline" onClick={() => void reclassify({ trackIds: [track.id] })} disabled={job === "queued" || job === "running"}>
                  Re-classify
                </button>
                {confirmed && (
                  <button type="button" className="btn-outline" onClick={() => void clearGenres(track.id)}>
                    Back to automatic
                  </button>
                )}
              </div>
            )}
            {error && <p role="alert" className="text-xs text-accent-pink">{error}</p>}
          </div>
        </div>
      )}
    </Sheet>
  );
}
