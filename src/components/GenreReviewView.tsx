"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useGenreClient } from "@/lib/genreClient";
import { reviewQueue, suggestionRows } from "@/lib/genreLibrary";
import { GenrePicker } from "@/components/GenrePicker";
import { Text } from "@/ui";
import type { Track } from "@/types/music";

/** The confidence a suggestion needs for "Accept all above" (the same default the server uses). */
const ACCEPT_ABOVE = 0.4;

/**
 * Library > Genre review: the tracks whose genre the sources were unsure about or disagreed on. Each shows what every
 * source suggested with its confidence; one tap takes a suggestion, "Another genre" opens the full list. Bulk: accept the
 * best suggestion for everything it is at least 40% sure of, or confirm the selected tracks as they stand. A counter says
 * how many are left.
 */
export function GenreReviewView() {
  const library = useStore((s) => s.localLibrary);
  const fields = useGenreClient((s) => s.fields);
  const setGenres = useGenreClient((s) => s.setGenres);
  const acceptAbove = useGenreClient((s) => s.acceptAbove);
  const confirmTracks = useGenreClient((s) => s.confirmTracks);
  const error = useGenreClient((s) => s.error);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const queue = useMemo(() => reviewQueue(library.map((t) => (fields[t.id] ? { ...t, ...fields[t.id] } : t))), [library, fields]);

  async function run(work: () => Promise<number>, done: (n: number) => string) {
    setBusy(true);
    setNotice(null);
    try {
      const changed = await work();
      setNotice(done(changed));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Text variant="heading" as="h2" aria-live="polite">
          {queue.length === 0 ? "Nothing to review" : `${queue.length} track${queue.length === 1 ? "" : "s"} to review`}
        </Text>
        <div className="flex-1" />
        <button
          type="button"
          className="btn-outline"
          disabled={busy || queue.length === 0}
          onClick={() => void run(() => acceptAbove(ACCEPT_ABOVE), (n) => `Accepted the best suggestion for ${n} track${n === 1 ? "" : "s"}.`)}
          title="Take the best suggestion for every track it is at least 40% sure of"
        >
          Accept all above 40%
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || selected.size === 0}
          onClick={() => void run(() => confirmTracks([...selected]), (n) => `Confirmed ${n} track${n === 1 ? "" : "s"}.`)}
          title="Keep the selected tracks' genres as they are and mark them confirmed"
        >
          Confirm selected{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </div>
      {notice && <Text variant="caption" role="status">{notice}</Text>}
      {error && <p role="alert" className="text-xs text-accent-pink">{error}</p>}

      <ul className="flex flex-col gap-2">
        {queue.map((track) => (
          <ReviewRow
            key={track.id}
            track={track}
            checked={selected.has(track.id)}
            onToggle={() => toggle(track.id)}
            picking={pickingFor === track.id}
            onPickAnother={() => setPickingFor(pickingFor === track.id ? null : track.id)}
            onChoose={async (picks) => {
              setBusy(true);
              try {
                if (await setGenres(track.id, picks)) setPickingFor(null);
              } finally {
                setBusy(false);
              }
            }}
            busy={busy}
          />
        ))}
      </ul>
    </div>
  );
}

function ReviewRow({
  track,
  checked,
  onToggle,
  picking,
  onPickAnother,
  onChoose,
  busy,
}: {
  track: Track;
  checked: boolean;
  onToggle: () => void;
  picking: boolean;
  onPickAnother: () => void;
  onChoose: (picks: { genre: string; subgenre?: string }[]) => Promise<void>;
  busy: boolean;
}) {
  const rows = suggestionRows(track);
  const top = rows[0];
  return (
    <li className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-3">
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${track.title}`} className="mt-1 h-4 w-4 shrink-0 accent-accent-purple" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{track.title}</p>
          <p className="truncate text-xs text-muted">{track.artist}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {top && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void onChoose([{ genre: top.tag.genre, ...(top.tag.subgenre ? { subgenre: top.tag.subgenre } : {}) }])}
              title={`Use ${top.label}`}
            >
              Accept
            </button>
          )}
          <button type="button" className="btn-outline" onClick={onPickAnother} aria-expanded={picking}>
            Another genre
          </button>
        </div>
      </div>
      {rows.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Suggestions">
          {rows.map((s) => (
            <li key={`${s.tag.source}-${s.label}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onChoose([{ genre: s.tag.genre, ...(s.tag.subgenre ? { subgenre: s.tag.subgenre } : {}) }])}
                className="rounded-full bg-surface-raised px-2.5 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
                title={`Use ${s.label}`}
              >
                <span className="font-semibold">{s.label}</span> <span className="text-muted">{s.percent}% · {s.sourceLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Text variant="caption">No source had a suggestion for this track.</Text>
      )}
      {picking && <GenrePicker onPick={(p) => void onChoose([p])} onCancel={onPickAnother} busy={busy} />}
    </li>
  );
}
