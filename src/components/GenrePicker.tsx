"use client";

import { useState } from "react";
import { GENRES, subgenreLabels } from "@/lib/genres";

/**
 * Choose a genre (and optionally a subgenre) from the fixed taxonomy: two selects, so nothing off the list can be typed.
 * `onPick` is called with the choice; the caller decides what saving means.
 */
export function GenrePicker({
  initial,
  onPick,
  onCancel,
  busy = false,
  submitLabel = "Save genre",
}: {
  initial?: { genre: string; subgenre?: string };
  onPick: (pick: { genre: string; subgenre?: string }) => void;
  onCancel?: () => void;
  busy?: boolean;
  submitLabel?: string;
}) {
  const [genre, setGenre] = useState(initial?.genre ?? "");
  const [subgenre, setSubgenre] = useState(initial?.subgenre ?? "");
  const subs = genre ? subgenreLabels(genre) : [];

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (genre) onPick({ genre, ...(subgenre ? { subgenre } : {}) });
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted">
        Genre
        <select
          value={genre}
          onChange={(e) => {
            setGenre(e.target.value);
            setSubgenre("");
          }}
          className="rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground"
        >
          <option value="">Choose a genre…</option>
          {GENRES.map((g) => (
            <option key={g.label} value={g.label}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Subgenre (optional)
        <select
          value={subgenre}
          onChange={(e) => setSubgenre(e.target.value)}
          disabled={!genre}
          className="rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground disabled:opacity-50"
        >
          <option value="">None</option>
          {subs.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={!genre || busy} className="btn">
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-outline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
