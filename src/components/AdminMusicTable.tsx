"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GenrePicker } from "@/components/GenrePicker";
import { PAGE_SIZES, splitTagInput, type MissingField, type MusicRow, type SortDir, type SortKey } from "@/lib/adminMusic";

type Counts = { library: number; missingArtist: number; missingTitle: number; missingGenre: number; missingAny: number };
/** `counts` is null unless the request asked for them (they do not depend on the search). */
type Page = { rows: MusicRow[]; total: number; page: number; pages: number; pageSize: number; counts: Counts | null };

// The first two columns stay pinned while the rest scroll sideways, so the song is always named. On a phone they are narrower so some of the
// other columns still fit beside them.
const ARTIST_W = "w-[110px] min-w-[110px] max-w-[110px] sm:w-[180px] sm:min-w-[180px] sm:max-w-[180px]";
const SONG_W = "w-[140px] min-w-[140px] max-w-[140px] sm:w-[240px] sm:min-w-[240px] sm:max-w-[240px]";
const SONG_LEFT = "left-[110px] sm:left-[180px]";

const COLUMNS: { key: SortKey | "tags"; label: string; sortable: boolean; className: string }[] = [
  { key: "artist", label: "Artist", sortable: true, className: `sticky left-0 z-20 ${ARTIST_W}` },
  { key: "title", label: "Song", sortable: true, className: `sticky ${SONG_LEFT} z-20 ${SONG_W} border-r border-border-subtle` },
  { key: "genre", label: "Genre", sortable: true, className: "w-[170px] min-w-[170px]" },
  { key: "plays", label: "Plays", sortable: true, className: "w-[80px] min-w-[80px]" },
  { key: "tags", label: "Tags / keywords", sortable: false, className: "w-[200px] min-w-[200px]" },
  { key: "bpm", label: "BPM", sortable: true, className: "w-[90px] min-w-[90px]" },
  { key: "key", label: "Key", sortable: true, className: "w-[130px] min-w-[130px]" },
];

const MISSING_LABEL: Record<MissingField, string> = { artist: "artist", title: "song name", genre: "genre" };

/** A cell that shows a value and turns into a box when clicked: Enter or leaving the box saves, Escape cancels. `onSave` returns an error message, or null when it worked. */
function EditableCell({
  display,
  initial,
  missing,
  label,
  placeholder,
  inputMode,
  onSave,
}: {
  display: React.ReactNode;
  initial: string;
  missing?: boolean;
  label: string;
  placeholder?: string;
  inputMode?: "text" | "decimal";
  onSave: (text: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cancelled = useRef(false);

  async function commit() {
    if (cancelled.current || saving) return;
    if (draft.trim() === initial.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const error = await onSave(draft);
    setSaving(false);
    setProblem(error);
    if (error === null) setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <input
          autoFocus
          value={draft}
          disabled={saving}
          inputMode={inputMode}
          aria-label={label}
          aria-invalid={problem ? true : undefined}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              cancelled.current = true;
              setProblem(null);
              setEditing(false);
            }
          }}
          className="w-full rounded bg-surface-raised px-2 py-1.5 text-sm text-foreground outline outline-1 outline-accent-purple disabled:opacity-60"
        />
        {problem && <span className="text-xs text-red-500">{problem}</span>}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      title="Click to edit"
      onClick={() => {
        cancelled.current = false;
        setDraft(initial);
        setEditing(true);
      }}
      className={`block w-full text-left rounded px-1 py-1 hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-purple ${missing ? "font-semibold text-red-500" : ""}`}
    >
      {display}
    </button>
  );
}

/** A BPM or key that comes from the file's own tag (the app has not measured the song yet): shown, marked, and not editable here. */
function FromTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1" title="From the file's own tags. The app measures its own the first time the song plays.">
      {children}
      <span className="ml-1 align-middle text-[10px] font-semibold uppercase text-faint">tag</span>
    </span>
  );
}

function SortHeader({ column, sort, dir, onSort }: { column: (typeof COLUMNS)[number]; sort: SortKey; dir: SortDir; onSort: (key: SortKey) => void }) {
  const active = column.sortable && column.key === sort;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
      className={`sticky top-0 z-10 bg-surface-raised px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted ${column.className} ${column.className.includes("sticky left") ? "z-30" : ""}`}
    >
      {column.sortable ? (
        <button type="button" onClick={() => onSort(column.key as SortKey)} className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${active ? "text-foreground" : ""}`}>
          {column.label}
          <span aria-hidden="true">{active ? (dir === "asc" ? "▲" : "▼") : ""}</span>
        </button>
      ) : (
        column.label
      )}
    </th>
  );
}

/**
 * The Music catalog: every song in the app in one table the admin can search, sort and edit in place. Artist and song name are pinned on the left; the
 * other columns scroll sideways. Songs missing an artist, a name or a genre are marked in red. Edits are saved to the shared song, so every account
 * sees them (after its next refresh).
 */
export function AdminMusicTable() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("artist");
  const [dir, setDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [missingOnly, setMissingOnly] = useState(false);
  const [data, setData] = useState<Page | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  // The reload number the counts were last fetched for: they are asked for again after an edit or Refresh, not on every search.
  const countsFor = useRef(-1);
  // Which request the rows on screen answer; while it is not the current one, a load is in flight.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [genreEditing, setGenreEditing] = useState<string | null>(null);
  const [genreBusy, setGenreBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const requestQuery = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize), sort, dir, ...(missingOnly ? { missing: "1" } : {}) }).toString();
  const requestKey = `${requestQuery}#${reload}`;
  const loading = loadedFor !== requestKey;

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(input.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    const controller = new AbortController();
    const withCounts = countsFor.current !== reload;
    fetch(`/api/admin/music?${requestQuery}${withCounts ? "&counts=1" : ""}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `The catalog could not be loaded (${res.status}).`);
        return (await res.json()) as Page;
      })
      .then((next) => {
        if (next.counts) {
          countsFor.current = reload;
          setCounts(next.counts);
        }
        setData(next);
        setError(null);
        setPage(next.page);
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedFor(requestKey);
      });
    return () => controller.abort();
  }, [requestQuery, requestKey, reload]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function onSort(key: SortKey) {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "plays" ? "desc" : "asc");
    }
    setPage(1);
  }

  const replaceRow = useCallback((row: MusicRow) => {
    setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...row, plays: r.plays } : r)) } : d));
  }, []);

  /** Saves a change to one song's artist, name, BPM, key or tags. Returns an error message, or null when it was saved. */
  async function saveEdit(row: MusicRow, patch: Record<string, unknown>, what: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/admin/music/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = (await res.json().catch(() => null)) as (MusicRow & { error?: string }) | null;
      if (!res.ok || !body) {
        const message = body?.error ?? `The change could not be saved (${res.status}).`;
        setError(message);
        return message;
      }
      replaceRow(body);
      setError(null);
      setNotice(`Saved ${what} for ${body.artist} - ${body.title}.`);
      // The counts above the table (songs still missing something) change with an edit.
      setReload((n) => n + 1);
      return null;
    } catch {
      const message = "The change could not be saved. Check the connection and try again.";
      setError(message);
      return message;
    }
  }

  async function saveGenre(row: MusicRow, pick: { genre: string; subgenre?: string }) {
    setGenreBusy(true);
    try {
      const res = await fetch(`/api/tracks/${row.id}/genre`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ picks: [pick] }) });
      if (!res.ok) {
        setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `The genre could not be saved (${res.status}).`);
        return;
      }
      replaceRow({ ...row, genre: pick.genre, subgenres: pick.subgenre ? [pick.subgenre] : [], genreStatus: "confirmed", missing: row.missing.filter((m) => m !== "genre") });
      setGenreEditing(null);
      setError(null);
      setNotice(`Saved genre for ${row.artist} - ${row.title}.`);
      setReload((n) => n + 1);
    } catch {
      setError("The genre could not be saved. Check the connection and try again.");
    } finally {
      setGenreBusy(false);
    }
  }

  const first = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  const pager = (
    <div className="flex items-center gap-2 text-sm">
      <button type="button" disabled={!data || data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg bg-surface-raised px-3 py-1.5 hover:bg-surface-hover disabled:opacity-40">
        Previous
      </button>
      <span className="text-muted tabular-nums">
        Page {data?.page ?? 1} of {data?.pages ?? 1}
      </span>
      <button type="button" disabled={!data || data.page >= data.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg bg-surface-raised px-3 py-1.5 hover:bg-surface-hover disabled:opacity-40">
        Next
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {notice && (
        <p role="status" className="sticky top-2 z-40 rounded-lg bg-emerald-950 border border-emerald-500/40 px-3 py-2 text-sm text-emerald-400 shadow-lg">
          ✓ {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="sticky top-2 z-40 rounded-lg bg-red-950 border border-red-500/40 px-3 py-2 text-sm text-red-400 shadow-lg">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search artist, song, genre, tag, BPM or key…"
          aria-label="Search the music catalog"
          className="min-w-[220px] flex-1 rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground placeholder:text-faint"
        />
        <button
          type="button"
          aria-pressed={missingOnly}
          onClick={() => {
            setMissingOnly((m) => !m);
            setPage(1);
          }}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${missingOnly ? "bg-red-500 text-white" : "bg-red-500/15 text-red-500 hover:bg-red-500/25"}`}
        >
          Missing info{counts ? ` (${counts.missingAny.toLocaleString("en-US")})` : ""}
        </button>
        <label className="flex items-center gap-2 text-sm text-muted">
          Rows
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="rounded-lg bg-surface-raised px-2 py-2 text-sm text-foreground"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setReload((n) => n + 1)} className="rounded-lg bg-surface-raised px-3 py-2 text-sm hover:bg-surface-hover">
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <p>
          {data
            ? data.total === 0
              ? "No songs match."
              : `Showing ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${data.total.toLocaleString("en-US")} ${data.total === 1 ? "song" : "songs"}`
            : "Loading…"}
          {counts && (
            <span className="ml-2 text-faint">
              ({counts.library.toLocaleString("en-US")} in the library · <span className={counts.missingArtist ? "text-red-500" : ""}>{counts.missingArtist} no artist</span> ·{" "}
              <span className={counts.missingTitle ? "text-red-500" : ""}>{counts.missingTitle} no name</span> · <span className={counts.missingGenre ? "text-red-500" : ""}>{counts.missingGenre.toLocaleString("en-US")} no genre</span>)
            </span>
          )}
        </p>
        {pager}
      </div>

      <div className={`overflow-auto rounded-lg border border-border-subtle md:max-h-[calc(100dvh-17rem)] min-h-[200px] transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <SortHeader key={c.key} column={c} sort={sort} dir={dir} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => {
              const lacks = (f: MissingField) => row.missing.includes(f);
              const name = `${row.artist || "(no artist)"} - ${row.title || "(no name)"}`;
              return (
                <tr key={row.id} className="group">
                  <td className={`sticky left-0 z-10 bg-surface p-0 align-top border-b border-border-subtle group-hover:bg-surface-hover ${ARTIST_W}`}>
                    <div className={`px-3 py-2 ${lacks("artist") ? "bg-red-500/15" : ""}`}>
                      <EditableCell
                        label={`Artist for ${name}`}
                        initial={lacks("artist") ? "" : row.artist}
                        missing={lacks("artist")}
                        placeholder="Artist name"
                        display={lacks("artist") ? "Missing artist" : <span className="line-clamp-2 break-words">{row.artist}</span>}
                        onSave={(text) => saveEdit(row, { artist: text }, "artist")}
                      />
                    </div>
                  </td>
                  <td className={`sticky ${SONG_LEFT} z-10 bg-surface p-0 align-top border-b border-r border-border-subtle group-hover:bg-surface-hover ${SONG_W}`}>
                    <div className={`px-3 py-2 ${lacks("title") ? "bg-red-500/15" : ""}`}>
                      <EditableCell
                        label={`Song name for ${name}`}
                        initial={lacks("title") ? "" : row.title}
                        missing={lacks("title")}
                        placeholder="Song name"
                        display={lacks("title") ? "Missing song name" : <span className="line-clamp-2 break-words">{row.title}</span>}
                        onSave={(text) => saveEdit(row, { title: text }, "song name")}
                      />
                    </div>
                  </td>
                  <td className={`px-3 py-2 align-top border-b border-border-subtle group-hover:bg-surface-hover ${lacks("genre") ? "bg-red-500/15" : ""}`}>
                    {genreEditing === row.id ? (
                      <GenrePicker
                        initial={row.genre ? { genre: row.genre, ...(row.subgenres[0] ? { subgenre: row.subgenres[0] } : {}) } : undefined}
                        busy={genreBusy}
                        onPick={(pick) => void saveGenre(row, pick)}
                        onCancel={() => setGenreEditing(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        aria-label={`Genre for ${name}`}
                        title="Click to choose a genre"
                        onClick={() => setGenreEditing(row.id)}
                        className={`block w-full rounded px-1 py-1 text-left hover:bg-surface-raised ${lacks("genre") ? "font-semibold text-red-500" : ""}`}
                      >
                        {row.genre ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <span>{row.genre}</span>
                            {row.subgenres[0] && <span className="text-xs text-muted">· {row.subgenres[0]}</span>}
                            {row.genreStatus === "needs-review" && <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-500">Review</span>}
                          </span>
                        ) : (
                          "Missing genre"
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top tabular-nums border-b border-border-subtle group-hover:bg-surface-hover">{row.plays.toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 align-top border-b border-border-subtle group-hover:bg-surface-hover">
                    <EditableCell
                      label={`Tags for ${name}`}
                      initial={row.tags.join(", ")}
                      placeholder="halloween, spooky, …"
                      display={
                        row.tags.length === 0 ? (
                          <span className="text-faint">Add tags</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {row.tags.map((t) => (
                              <span key={t} className="rounded-full bg-accent-purple/15 px-2 py-0.5 text-xs text-accent-purple">
                                {t}
                              </span>
                            ))}
                          </span>
                        )
                      }
                      onSave={(text) => saveEdit(row, { tags: splitTagInput(text) }, "tags")}
                    />
                  </td>
                  <td className="px-3 py-2 align-top tabular-nums border-b border-border-subtle group-hover:bg-surface-hover">
                    {row.analysed && row.bpm != null ? (
                      <EditableCell
                        label={`BPM for ${name}`}
                        initial={String(Math.round(row.bpm * 100) / 100)}
                        inputMode="decimal"
                        placeholder="e.g. 128"
                        display={Math.round(row.bpm * 10) / 10}
                        onSave={async (text) => (text.trim() === "" ? "Type a BPM from 40 to 300." : saveEdit(row, { bpm: Number(text) }, "BPM"))}
                      />
                    ) : row.bpm != null ? (
                      <FromTag>{Math.round(row.bpm * 10) / 10}</FromTag>
                    ) : (
                      <span className="px-1 text-faint" title="The file has no BPM tag; the app measures one the first time the song plays">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top border-b border-border-subtle group-hover:bg-surface-hover">
                    {row.analysed ? (
                      <EditableCell
                        label={`Key for ${name}`}
                        initial={row.key ?? ""}
                        placeholder="A minor, 8A…"
                        display={row.key ? `${row.key}${row.camelot ? ` · ${row.camelot}` : ""}` : <span className="text-faint">—</span>}
                        onSave={(text) => saveEdit(row, { key: text.trim() === "" ? null : text }, "key")}
                      />
                    ) : row.key ? (
                      <FromTag>{`${row.key}${row.camelot ? ` · ${row.camelot}` : ""}`}</FromTag>
                    ) : (
                      <span className="px-1 text-faint" title="The file has no key tag; the app measures one the first time the song plays">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted">
                  {q || missingOnly ? "No songs match this search." : "The library is empty."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-faint">
          Click any cell to edit it, then press Enter. Red means the song has no {Object.values(MISSING_LABEL).join(", ")} yet. Changes are saved for every account. A BPM or key marked &quot;tag&quot; comes from the file itself; the app measures its own the first time the song plays, and only then can it be corrected here.
        </p>
        {pager}
      </div>
    </div>
  );
}
