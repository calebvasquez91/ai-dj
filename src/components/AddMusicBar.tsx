"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { searchForAddMusic, type AddMusicResult, type TrackFacts } from "@/lib/addMusicSearch";
import { useKeyboardInset } from "@/lib/useKeyboardInset";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import { CloseIcon } from "@/components/Icons";
import type { Playlist, Track } from "@/types/music";

/** How long typing pauses before the library is searched. */
const DEBOUNCE_MS = 250;
/** How long an added track keeps its check mark in the results before it drops out of them. */
const ADDED_LINGER_MS = 1000;
/** How long the "Added to ..." line stays up. */
const CONFIRM_MS = 2500;
/** A preview plays this long. */
const PREVIEW_SEC = 10;
/** The results list shows this many rows before it scrolls. */
const VISIBLE_ROWS = 6;
const ROW_PX = 56;
const HEADER_PX = 28;

/**
 * "Add Music": the bar pinned to the bottom of every playlist. Collapsed it is one button; opened it is a search box
 * over the user's own library (lib/addMusicSearch.ts) with the matches in a list above it. "＋" adds a track to the end
 * of the playlist (store.addTrackToPlaylist: saved to the server, and into the live queue or shuffle pool if this
 * playlist is playing), tapping a row previews ten seconds of it. There is nothing here that deletes a track.
 *
 * Escape collapses it, Enter adds the top result, and once something has been added a tap outside collapses it. On a
 * phone, while the keyboard is up, it sits just above the keyboard.
 */
export function AddMusicBar({ playlist }: { playlist: Playlist }) {
  const library = useStore((s) => s.localLibrary);
  const trackAnalysis = useStore((s) => s.trackAnalysis);
  const addTrackToPlaylist = useStore((s) => s.addTrackToPlaylist);
  const { inset, visibleHeight } = useKeyboardInset();

  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [justAdded, setJustAdded] = useState<ReadonlySet<string>>(new Set());
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const addedSinceOpen = useRef(false);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const listId = useId();

  const stopPreview = useCallback(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    previewRef.current?.pause();
    previewRef.current = null;
    setPreviewingId(null);
  }, []);

  const collapse = useCallback(() => {
    stopPreview();
    setExpanded(false);
    setQuery("");
    setDebounced("");
    addedSinceOpen.current = false;
  }, [stopPreview]);

  // Leaving the page (or switching playlist) silences a preview and drops the pending timers.
  useEffect(() => {
    const linger = lingerTimers.current;
    return () => {
      stopPreview();
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      linger.forEach(clearTimeout);
    };
  }, [stopPreview]);

  // Once something has been added, a tap outside the bar puts it away.
  useEffect(() => {
    if (!expanded) return;
    function onPointerDown(e: PointerEvent) {
      if (!addedSinceOpen.current) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) collapse();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [expanded, collapse]);

  const playlistTrackIds = useMemo(() => new Set(playlist.tracks.map((t) => t.id)), [playlist.tracks]);
  const spookyPlaylist = playlist.theme === "spooky";

  const results = useMemo(() => {
    if (!expanded) return [];
    const facts = (t: Track): TrackFacts => {
      const a = trackAnalysis[t.id];
      const bpm = a && !a.fallback ? a.bpm : t.source === "local" ? (t.bpm ?? null) : null;
      return { bpm: bpm && bpm > 0 ? bpm : null, key: a && !a.fallback ? a.camelotKey : null };
    };
    return searchForAddMusic({ library, playlistTrackIds, keepIds: justAdded, facts, query: debounced, spookyPlaylist });
  }, [expanded, library, playlistTrackIds, justAdded, trackAnalysis, debounced, spookyPlaylist]);

  function add(track: Track) {
    if (playlistTrackIds.has(track.id)) return;
    addTrackToPlaylist(playlist.id, track);
    addedSinceOpen.current = true;
    stopPreview();
    setJustAdded((prev) => new Set(prev).add(track.id));
    setConfirmation(`Added to ${playlist.name}`);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmation(null), CONFIRM_MS);
    const timer = setTimeout(() => {
      lingerTimers.current.delete(timer);
      setJustAdded((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }, ADDED_LINGER_MS);
    lingerTimers.current.add(timer);
  }

  function togglePreview(track: Track) {
    if (previewingId === track.id) {
      stopPreview();
      return;
    }
    stopPreview();
    if (track.source !== "local") return; // a YouTube track has no audio file to play from here
    const audio = new Audio(track.sourceUrl);
    audio.volume = 0.8;
    previewRef.current = audio;
    setPreviewingId(track.id);
    void audio.play().catch(stopPreview);
    previewTimer.current = setTimeout(stopPreview, PREVIEW_SEC * 1000);
    audio.addEventListener("ended", stopPreview, { once: true });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      collapse();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const top = results.find((r) => !playlistTrackIds.has(r.track.id));
      if (top) add(top.track);
    }
  }

  // With the keyboard up the bar leaves the page flow and rides just above it.
  const floating = expanded && inset > 0;
  const listMaxPx = Math.min(HEADER_PX + VISIBLE_ROWS * ROW_PX, floating ? Math.max(120, visibleHeight - 110) : Infinity);
  const hasQuery = debounced.trim().length > 0;

  if (!expanded) {
    return (
      <div ref={containerRef} className="sticky bottom-2 z-20 mx-auto w-full max-w-2xl">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="btn w-full shadow-elevate-md"
          title="Search your library and add songs to this playlist"
        >
          ＋ Add Music
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={floating ? "fixed inset-x-0 z-[65] px-3 pb-2" : "sticky bottom-2 z-20"}
      style={floating ? { bottom: inset } : undefined}
    >
      <div className="relative mx-auto w-full max-w-2xl">
        <div
          className="absolute bottom-full left-0 right-0 mb-2 overflow-y-auto overscroll-contain rounded-2xl bg-surface shadow-elevate-lg border border-border/10"
          style={{ maxHeight: listMaxPx }}
          id={listId}
          role="listbox"
          aria-label="Songs to add"
        >
          <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted" style={{ height: HEADER_PX }}>
            {hasQuery ? "Matches in your library" : "Recently added to library"}
          </p>
          {results.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">
              {hasQuery ? "No songs found — try a different search" : "Nothing to add yet — every song in your library is already in this playlist."}
            </p>
          ) : (
            results.map((r) => (
              <ResultRow
                key={r.track.id}
                result={r}
                added={playlistTrackIds.has(r.track.id)}
                previewing={previewingId === r.track.id}
                onPreview={() => togglePreview(r.track)}
                onAdd={() => add(r.track)}
              />
            ))
          )}
        </div>

        <div className="flex items-center gap-2 rounded-2xl bg-surface shadow-elevate-lg border border-border/10 px-3 py-2">
          <span aria-hidden="true" className="text-sm">
            🔍
          </span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-label={`Add music to ${playlist.name}`}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder="Search your library — song, artist, BPM, key…"
            // 16px: iOS Safari zooms the whole page when a field under 16px takes focus.
            className="min-w-0 flex-1 bg-transparent py-1.5 text-base outline-none placeholder:text-muted"
          />
          <button type="button" onClick={collapse} className="btn-icon shrink-0 text-muted hover:text-accent-pink" title="Close (Esc)" aria-label="Close Add Music">
            <CloseIcon size={16} />
          </button>
        </div>
        <p role="status" aria-live="polite" className={`mt-1 text-center text-xs font-medium text-accent-teal ${confirmation ? "" : "invisible"}`}>
          {confirmation ?? "."}
        </p>
      </div>
    </div>
  );
}

function ResultRow({
  result,
  added,
  previewing,
  onPreview,
  onAdd,
}: {
  result: AddMusicResult;
  added: boolean;
  previewing: boolean;
  onPreview: () => void;
  onAdd: () => void;
}) {
  const { track, bpm, key } = result;
  return (
    <div
      role="option"
      aria-selected={previewing}
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          onPreview();
        }
      }}
      title={track.source === "local" ? (previewing ? "Stop preview" : "Preview 10 seconds") : "No preview for YouTube tracks"}
      className={`flex items-center gap-3 px-3 cursor-pointer hover:bg-surface-hover transition-colors ${previewing ? "bg-surface-hover" : ""}`}
      style={{ height: ROW_PX }}
    >
      <TrackThumbnail thumbnailUrl={track.thumbnailUrl} title={track.title} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {previewing && <span aria-hidden="true">▶ </span>}
          {track.title}
        </p>
        <p className="truncate text-xs text-muted">{track.artist}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {bpm != null && <span className="rounded-full bg-accent-teal/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-teal">{Math.round(bpm)} BPM</span>}
        {key && <span className="rounded-full bg-accent-purple/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-purple">{key}</span>}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        disabled={added}
        aria-label={added ? `${track.title} added` : `Add ${track.title}`}
        title={added ? "Added" : "Add to the end of this playlist"}
        className={`btn-icon shrink-0 text-base font-semibold ${added ? "text-accent-teal" : "text-accent-purple hover:text-accent-pink"}`}
      >
        {added ? "✓" : "＋"}
      </button>
    </div>
  );
}
