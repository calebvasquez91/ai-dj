"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@/lib/store";
import {
  clampPopupToViewport,
  highlightSegments,
  searchAll,
  type PopupRect,
  type SearchGroup,
} from "@/lib/search";
import { formatTime } from "@/lib/format";
import { CloseIcon, LibraryIcon, PlayIcon, QueueIcon } from "@/components/Icons";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import type { FxSound, Playlist, Track } from "@/types/music";

/**
 * The ?q= param on /library is only a shareable/reload-safe mirror of the box,
 * so its write is debounced and goes through history.replaceState (no server
 * round trip). Filtering itself never waits on it — it reads the store.
 */
const URL_SYNC_DEBOUNCE_MS = 300;
const FX_PREVIEW_MAX_SEC = 5;

type Row =
  | { key: string; kind: "track"; track: Track; tracks: Track[]; index: number }
  | { key: string; kind: "playlist"; playlist: Playlist }
  | { key: string; kind: "fx"; fx: FxSound }
  | { key: string; kind: "see-all"; count: number };

const GROUP_LABEL: Record<SearchGroup["kind"], string> = { tracks: "Songs", playlists: "Playlists", fx: "FX" };

/** Flattens ranked groups into the keyboard-navigable row list (group headers aren't rows). Also returns where each group starts, for rendering headers. */
function buildRows(groups: SearchGroup[]): { rows: Row[]; headerAt: Map<number, string> } {
  const rows: Row[] = [];
  const headerAt = new Map<number, string>();
  for (const g of groups) {
    headerAt.set(rows.length, GROUP_LABEL[g.kind]);
    if (g.kind === "tracks") {
      const queue = g.all.map((h) => h.item);
      g.hits.forEach((h) =>
        rows.push({ key: `t:${h.item.id}`, kind: "track", track: h.item, tracks: queue, index: h.index })
      );
      if (g.all.length > g.hits.length) rows.push({ key: "see-all", kind: "see-all", count: g.all.length });
    } else if (g.kind === "playlists") {
      g.hits.forEach((h) => rows.push({ key: `p:${h.item.id}`, kind: "playlist", playlist: h.item }));
    } else {
      g.hits.forEach((h) => rows.push({ key: `f:${h.item.id}`, kind: "fx", fx: h.item }));
    }
  }
  return { rows, headerAt };
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((s, i) =>
        s.match ? (
          <mark key={i} className="bg-transparent text-accent-purple font-semibold">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

// One FX audition at a time, shared across keystrokes/rows — module-level so
// a re-render (or the dropdown unmounting) never leaves a stray Audio playing.
let fxPreviewAudio: HTMLAudioElement | null = null;
let fxPreviewTimer: ReturnType<typeof setTimeout> | null = null;
function previewFx(fx: FxSound) {
  stopFxPreview();
  const audio = new Audio(fx.sourceUrl);
  audio.volume = 0.8;
  fxPreviewAudio = audio;
  void audio.play().catch(() => stopFxPreview());
  fxPreviewTimer = setTimeout(stopFxPreview, FX_PREVIEW_MAX_SEC * 1000);
  audio.addEventListener("ended", stopFxPreview, { once: true });
}
function stopFxPreview() {
  if (fxPreviewTimer) clearTimeout(fxPreviewTimer);
  fxPreviewTimer = null;
  fxPreviewAudio?.pause();
  fxPreviewAudio = null;
}

const ResultRow = memo(function ResultRow({
  id,
  row,
  query,
  active,
  onHover,
  onSelect,
}: {
  id: string;
  row: Row;
  query: string;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  let icon: React.ReactNode;
  let primary: React.ReactNode;
  let secondary: React.ReactNode = null;
  if (row.kind === "track") {
    icon = <TrackThumbnail thumbnailUrl={row.track.thumbnailUrl} title={row.track.title} size={36} />;
    primary = <Highlighted text={row.track.title} query={query} />;
    secondary = <Highlighted text={row.track.artist || "Unknown artist"} query={query} />;
  } else if (row.kind === "playlist") {
    icon = (
      <span className="w-9 h-9 rounded-lg bg-surface-hover flex items-center justify-center text-accent-purple shrink-0">
        <QueueIcon size={16} />
      </span>
    );
    primary = <Highlighted text={row.playlist.name} query={query} />;
    secondary = `Playlist · ${row.playlist.tracks.length} ${row.playlist.tracks.length === 1 ? "track" : "tracks"}`;
  } else if (row.kind === "fx") {
    icon = (
      <span className="w-9 h-9 rounded-lg bg-accent-teal/15 flex items-center justify-center text-accent-teal shrink-0">
        <PlayIcon size={14} />
      </span>
    );
    primary = <Highlighted text={row.fx.name} query={query} />;
    secondary = `${row.fx.category} · ${formatTime(row.fx.durationSec)} · tap to preview`;
  } else {
    icon = (
      <span className="w-9 h-9 rounded-lg bg-surface-hover flex items-center justify-center text-accent-teal shrink-0">
        <LibraryIcon size={16} />
      </span>
    );
    primary = `See all ${row.count} songs in Music Library`;
  }
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      // mousedown (not click) + preventDefault: keeps focus in the input so a
      // click can't blur-close the panel before the selection lands.
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className={`flex items-center gap-3 px-3 py-2 cursor-pointer rounded-lg ${active ? "bg-surface-hover" : ""}`}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm truncate">{primary}</p>
        {secondary && <p className="text-xs text-muted truncate">{secondary}</p>}
      </div>
    </div>
  );
});

const SYNC_ERROR_VISIBLE_MS = 7000;

/** Transient toast for a background save the server rejected (the store has already rolled the UI back) — see store.ts reportSyncError. */
function SyncErrorToast() {
  const message = useStore((s) => s.syncError);
  const clear = useStore((s) => s.clearSyncError);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(clear, SYNC_ERROR_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [message, clear]);
  if (!message) return null;
  return createPortal(
    <div
      role="alert"
      className="fixed right-4 top-[4.5rem] z-[70] w-[min(24rem,calc(100vw-2rem))] flex items-start gap-3 rounded-xl bg-surface shadow-elevate-md border border-accent-pink/40 px-4 py-3 text-sm"
    >
      <p className="flex-1 min-w-0 break-words text-accent-pink">{message}</p>
      <button type="button" onClick={clear} aria-label="Dismiss" className="btn-icon text-muted shrink-0">
        <CloseIcon size={14} />
      </button>
    </div>,
    document.body
  );
}

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const urlQuery = useSearchParams().get("q") ?? "";
  const query = useStore((s) => s.searchQuery);
  const setQuery = useStore((s) => s.setSearchQuery);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const playTrackList = useStore((s) => s.playTrackList);
  const localLibrary = useStore((s) => s.localLibrary);
  const playlists = useStore((s) => s.playlists);
  const fxLibrary = useStore((s) => s.fxLibrary);
  const libraryLoaded = useStore((s) => s.libraryLoaded);

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<PopupRect | null>(null);
  const [mounted, setMounted] = useState(false);

  // ---- URL mirror -------------------------------------------------------
  // Values we've written to the URL and not yet seen come back through
  // useSearchParams. An echo of our own write must not overwrite what the
  // user has typed since; anything else is an external navigation (a
  // /library?q= link, back/forward, leaving the page) and wins.
  const pendingWrites = useRef<string[]>([]);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const target = pathname === "/library" ? urlQuery : "";
    const at = pathname === "/library" ? pendingWrites.current.indexOf(target) : -1;
    if (at >= 0) {
      pendingWrites.current.splice(0, at + 1);
      return;
    }
    pendingWrites.current = [];
    if (urlTimer.current) clearTimeout(urlTimer.current);
    if (useStore.getState().searchQuery !== target) setQuery(target);
  }, [pathname, urlQuery, setQuery]);

  const scheduleUrlWrite = useCallback(
    (value: string) => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
      if (pathname !== "/library") return;
      urlTimer.current = setTimeout(() => {
        const trimmed = value.trim();
        const next = trimmed ? `/library?q=${encodeURIComponent(trimmed)}` : "/library";
        if (trimmed === urlQuery && pendingWrites.current.length === 0) return;
        pendingWrites.current.push(trimmed);
        // The native History API is integrated with the Next router (it
        // updates usePathname/useSearchParams) but triggers no navigation, no
        // RSC fetch and no auth() round trip — unlike router.replace.
        window.history.replaceState(null, "", next);
      }, URL_SYNC_DEBOUNCE_MS);
    },
    [pathname, urlQuery]
  );

  useEffect(
    () => () => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
    },
    []
  );

  // ---- Results ----------------------------------------------------------
  // The <input> reads `query` (synchronous); everything below follows the
  // deferred copy, so a slow render of results can be interrupted by the next
  // keystroke instead of delaying it.
  const deferredQuery = useDeferredValue(query);
  const groups = useMemo(
    () => searchAll({ tracks: localLibrary, playlists, fx: fxLibrary }, deferredQuery),
    [localLibrary, playlists, fxLibrary, deferredQuery]
  );
  const { rows, headerAt } = useMemo(() => buildRows(groups), [groups]);
  const hasQuery = deferredQuery.trim().length > 0;
  const showPanel = open && query.trim().length > 0 && mounted;

  // Reset the highlighted row to the top hit whenever the result set changes.
  const [prevGroups, setPrevGroups] = useState(groups);
  if (prevGroups !== groups) {
    setPrevGroups(groups);
    setActiveIndex(0);
  }
  const safeActive = Math.min(activeIndex, Math.max(0, rows.length - 1));

  // ---- Positioning (fixed + clamped to the viewport) ---------------------
  const reposition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const a = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const width = vv?.width ?? document.documentElement.clientWidth;
    const height = vv?.height ?? document.documentElement.clientHeight;
    const next = clampPopupToViewport(a, { width, height }, { preferredWidth: 480, minWidth: 280 });
    setRect((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.maxHeight === next.maxHeight
        ? prev
        : next
    );
  }, []);

  useEffect(() => {
    // Portals can't render during SSR; flag that we're on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!showPanel) return;
    reposition();
    const vv = window.visualViewport;
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    vv?.addEventListener("resize", reposition);
    vv?.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      vv?.removeEventListener("resize", reposition);
      vv?.removeEventListener("scroll", reposition);
    };
  }, [showPanel, reposition]);

  // ---- Open/close + global shortcuts ------------------------------------
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      setOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Navigating somewhere closes the panel (state adjusted during render, not in an effect).
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!showPanel) return;
    panelRef.current?.querySelector(`[id="${listId}-${safeActive}"]`)?.scrollIntoView({ block: "nearest" });
  }, [showPanel, safeActive, listId]);

  function handleChange(value: string) {
    setQuery(value);
    setOpen(true);
    scheduleUrlWrite(value);
  }

  function clear() {
    setQuery("");
    scheduleUrlWrite("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function selectRow(row: Row) {
    switch (row.kind) {
      case "track":
        playTrackList(row.tracks, row.tracks.indexOf(row.track));
        setOpen(false);
        break;
      case "playlist":
        router.push(`/playlist?id=${row.playlist.id}`);
        setOpen(false);
        break;
      case "fx":
        previewFx(row.fx); // an audition — keep the panel open so the next one is a keypress away
        break;
      case "see-all":
        router.push(`/library?q=${encodeURIComponent(query.trim())}`);
        setOpen(false);
        break;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (query.trim().length === 0) return;
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (rows.length === 0) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((safeActive + delta + rows.length) % rows.length);
        break;
      }
      case "Enter": {
        const row = rows[safeActive];
        if (!row || !open || hasQuery === false) return;
        e.preventDefault();
        selectRow(row);
        break;
      }
      case "Escape":
        if (open && query.trim().length > 0) {
          e.preventDefault();
          setOpen(false);
        } else if (query.length > 0) {
          e.preventDefault();
          clear();
        } else {
          inputRef.current?.blur();
        }
        break;
    }
  }

  const activeId = showPanel && rows.length > 0 ? `${listId}-${safeActive}` : undefined;

  return (
    <header className="h-16 shrink-0 flex items-center gap-4 px-4 sm:px-6 shadow-elevate-md surface-glass">
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="btn-icon md:hidden text-accent-purple hover:text-accent-pink text-xl leading-none"
        title="Toggle menu"
      >
        ☰
      </button>
      <div ref={wrapRef} className="flex-1 min-w-0 max-w-xl mx-auto relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted text-sm">
          🔍
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={showPanel ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search songs, playlists and FX"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Search songs, playlists, FX…  ( / )"
          className="w-full rounded-full bg-background pl-9 pr-9 py-2.5 text-sm outline-none shadow-elevate-sm focus:shadow-none focus:border focus:border-accent-purple placeholder:text-muted"
        />
        {query.length > 0 && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            title="Clear search"
            aria-label="Clear search"
            className="btn-icon absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-accent-pink"
          >
            <CloseIcon size={14} />
          </button>
        )}
      </div>

      {mounted && <SyncErrorToast />}

      {showPanel &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            aria-label="Search results"
            style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.maxHeight }}
            className="z-[70] overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl bg-surface shadow-elevate-md border border-border/10 p-1.5"
          >
            {rows.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted break-words">
                {!libraryLoaded
                  ? "Loading your library…"
                  : hasQuery
                    ? `No results for “${deferredQuery.trim()}”. Try fewer or different words.`
                    : ""}
              </p>
            ) : (
              rows.map((row, i) => (
                <div key={row.key}>
                  {headerAt.has(i) && (
                    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {headerAt.get(i)}
                    </p>
                  )}
                  <ResultRow
                    id={`${listId}-${i}`}
                    row={row}
                    query={deferredQuery}
                    active={i === safeActive}
                    onHover={() => setActiveIndex(i)}
                    onSelect={() => selectRow(row)}
                  />
                </div>
              ))
            )}
          </div>,
          document.body
        )}
    </header>
  );
}
