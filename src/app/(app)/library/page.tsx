"use client";

import { Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { filesToTracks } from "@/lib/localAudio";
import { searchTracks } from "@/lib/search";
import { useLiked } from "@/lib/liked";
import { LIBRARY_VIEWS, artistsOf, likedTracks, parseLibraryView, type LibraryView } from "@/lib/library";
import { TrackGrid } from "@/components/TrackGrid";
import { AddSelectedToPlaylistButton } from "@/components/AddSelectedToPlaylistButton";
import { ConnectYouTubeButton } from "@/components/ConnectYouTubeButton";
import { YouTubeImportModal } from "@/components/YouTubeImportModal";
import { FxLibraryPanel } from "@/components/FxLibraryPanel";
import { CloseIcon, PlusIcon, ShuffleIcon } from "@/components/Icons";
import { Chip, ChipRow, CoverMosaic, MediaCard, Text } from "@/ui";

type SourceFilter = "all" | "local" | "youtube";

function LibraryContent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const localLibrary = useStore((s) => s.localLibrary);
  const addLocalTracks = useStore((s) => s.addLocalTracks);
  const removeLocalTrack = useStore((s) => s.removeLocalTrack);
  const startShuffle = useStore((s) => s.startShuffle);
  const libraryLoaded = useStore((s) => s.libraryLoaded);
  // The query is mirrored from the store (the top search box writes it on
  // every keystroke) through a low-priority transition: the box and its
  // dropdown stay instant while the heavy grid re-render yields to the next
  // keystroke instead of blocking it. The initial value comes from the ?q=
  // param so a reload/shared link renders already-filtered with no flash.
  const params = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  // The segment (Songs, Artists, Liked, FX) starts from ?view= so a link can open on one; after that it is local state,
  // since the top search box keeps rewriting the URL's ?q= and must not fight over it.
  const [view, setView] = useState<LibraryView>(() => parseLibraryView(params.get("view")));
  const likedIds = useLiked((s) => s.ids);
  useEffect(() => {
    const sync = (q: string) => startTransition(() => setQuery(q));
    // Whenever this page mounts the URL is the source of truth (TopBar
    // clears the box on navigation and fills it from ?q=), so the initial
    // state above is already right; only later edits need mirroring.
    return useStore.subscribe((s, prev) => {
      if (s.searchQuery !== prev.searchQuery) sync(s.searchQuery);
    });
  }, []);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  // Liked is the library narrowed to the songs liked on this device; every other control works on whatever is shown.
  const pool = useMemo(() => (view === "liked" ? likedTracks(localLibrary, likedIds) : localLibrary), [view, localLibrary, likedIds]);
  const searched = useMemo(
    () => (query.trim() ? searchTracks(pool, query).map((h) => h.item) : pool),
    [pool, query]
  );
  const artists = useMemo(() => artistsOf(localLibrary), [localLibrary]);
  const filtered = useMemo(
    () => (sourceFilter === "all" ? searched : searched.filter((t) => t.source === sourceFilter)),
    [searched, sourceFilter]
  );
  const shufflableCount = filtered.filter((t) => t.playPreference !== "do-not").length;
  const hasYoutubeTracks = localLibrary.some((t) => t.source === "youtube");

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);

  // Bulk "add to playlist" — selecting and moving tracks into a playlist
  // never removes them from the library; it only adds a reference, exactly
  // like the existing single-track "+" button already does.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedTracks = filtered.filter((t) => selectedIds.has(t.id));

  // Stable identities (useCallback) so TrackGrid's memoized cards don't all
  // re-render whenever this page does.
  const toggleSelect = useCallback((trackId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((t) => t.id))));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setLoading(true);
    setUploadError(null);
    try {
      const tracks = await filesToTracks(files);
      addLocalTracks(tracks);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to add files.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  const handleRemove = useCallback(
    (trackId: string) => {
      void removeLocalTrack(trackId);
    },
    [removeLocalTrack]
  );

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 sm:gap-4">
        <h1 className="text-2xl heading">Music Library</h1>
        <div className={`flex flex-wrap items-center justify-between sm:justify-end gap-1.5 sm:gap-3 ${view === "songs" || view === "liked" ? "" : "hidden"}`}>
          <button
            type="button"
            onClick={() => startShuffle(filtered)}
            disabled={shufflableCount < 2}
            className="btn-outline"
            title="Play these tracks ordered by tempo/key/energy/theme compatibility — skips Do-Not-Play tracks, puts Must-Play tracks first"
          >
            <ShuffleIcon size={15} />
            <span className="hidden sm:inline">Shuffle Play</span>
          </button>
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            disabled={filtered.length === 0}
            data-active={selectMode}
            className="btn-outline"
            title="Select tracks to add to a playlist — they stay in your library too"
          >
            {selectMode ? <CloseIcon size={15} /> : <span className="w-[15px] h-[15px] rounded-[4px] border-2 border-current shrink-0" aria-hidden="true" />}
            <span className="hidden sm:inline">{selectMode ? "Cancel" : "Select"}</span>
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="btn"
          >
            {loading ? <span aria-hidden="true">…</span> : <PlusIcon size={15} />}
            <span className="hidden sm:inline">{loading ? "Adding…" : "Add Files"}</span>
          </button>
          <ConnectYouTubeButton onReady={() => setYoutubeModalOpen(true)} />
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleFilesSelected}
          className="hidden"
        />
      </div>

      <ChipRow label="Library sections">
        {LIBRARY_VIEWS.map((v) => (
          <Chip key={v.id} selected={view === v.id} onClick={() => setView(v.id)}>
            {v.label}
          </Chip>
        ))}
      </ChipRow>

      {(view === "songs" || view === "liked") && (
      <>
      {query.trim() && (
        // The top search box that set this filter is hidden on a phone, so the filter shows (and clears) itself here.
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Showing songs matching</span>
          <Chip selected onClick={() => useStore.getState().setSearchQuery("")} aria-label={`Clear filter ${query.trim()}`} title="Clear filter">
            &ldquo;{query.trim()}&rdquo; ✕
          </Chip>
        </div>
      )}
      {selectMode && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface shadow-elevate-sm px-4 py-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={filtered.length > 0 && selectedIds.size === filtered.length}
              onChange={toggleSelectAll}
              className="w-4 h-4 accent-accent-purple"
            />
            Select all
          </label>
          <span className="text-sm text-muted">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <AddSelectedToPlaylistButton tracks={selectedTracks} onDone={exitSelectMode} />
        </div>
      )}

      {hasYoutubeTracks && (
        <div className="flex items-center gap-2">
          {(["all", "local", "youtube"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSourceFilter(option)}
              data-active={sourceFilter === option}
              className="btn-outline"
            >
              {option === "all" ? "All" : option === "local" ? "Local files" : "YouTube"}
            </button>
          ))}
        </div>
      )}

      {uploadError && <p className="text-xs text-accent-pink">{uploadError}</p>}

      {!libraryLoaded ? (
        <p className="text-xs text-accent-teal">Loading your library…</p>
      ) : localLibrary.length === 0 ? (
        <p className="text-sm text-muted">
          Add audio files from your computer to start building a set. They&apos;re
          saved to your account so they&apos;re there next time you log in, on any
          device.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted">
          {query.trim()
            ? `No tracks match "${query.trim()}".`
            : view === "liked"
              ? "Songs you like show up here. Tap the heart on any song; likes are saved on this device."
              : "No tracks in this filter."}
        </p>
      ) : (
        <TrackGrid
          tracks={filtered}
          onRemove={handleRemove}
          selectedIds={selectMode ? selectedIds : undefined}
          onToggleSelect={selectMode ? toggleSelect : undefined}
        />
      )}

      </>
      )}

      {view === "artists" &&
        (artists.length === 0 ? (
          <Text variant="secondary">Artists show up here once you add music.</Text>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 desktop:grid-cols-5">
            {artists.map((a) => (
              <li key={a.name}>
                <MediaCard
                  cover={<CoverMosaic title={a.name} items={a.tracks.map((t) => ({ title: t.title, src: t.thumbnailUrl }))} />}
                  title={a.name}
                  subtitle={`${a.tracks.length} song${a.tracks.length === 1 ? "" : "s"}`}
                  onClick={() => {
                    // Their songs: the Songs segment, searched for the artist (the top search box shows it too).
                    useStore.getState().setSearchQuery(a.name);
                    setView("songs");
                  }}
                />
              </li>
            ))}
          </ul>
        ))}

      {view === "fx" && (
        <div className="flex max-w-2xl flex-col rounded-card border border-border-subtle bg-surface">
          <FxLibraryPanel />
        </div>
      )}

      {youtubeModalOpen && <YouTubeImportModal onClose={() => setYoutubeModalOpen(false)} />}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryContent />
    </Suspense>
  );
}
