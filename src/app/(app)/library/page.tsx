"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { filesToTracks } from "@/lib/localAudio";
import { TrackList } from "@/components/TrackList";
import { AddSelectedToPlaylistButton } from "@/components/AddSelectedToPlaylistButton";
import { ConnectYouTubeButton } from "@/components/ConnectYouTubeButton";
import { YouTubeImportModal } from "@/components/YouTubeImportModal";
import { shuffleForPlay, dropTheNeedle } from "@/lib/shuffle";

function LibraryContent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const localLibrary = useStore((s) => s.localLibrary);
  const addLocalTracks = useStore((s) => s.addLocalTracks);
  const removeLocalTrack = useStore((s) => s.removeLocalTrack);
  const playTrackList = useStore((s) => s.playTrackList);
  const libraryLoaded = useStore((s) => s.libraryLoaded);
  const trackAnalysis = useStore((s) => s.trackAnalysis);
  const trackLyricalFingerprints = useStore((s) => s.trackLyricalFingerprints);
  const query = (useSearchParams().get("q") ?? "").trim().toLowerCase();

  const filtered = query
    ? localLibrary.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          t.artist.toLowerCase().includes(query)
      )
    : localLibrary;
  const shufflableCount = filtered.filter((t) => t.playPreference !== "do-not").length;

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);

  // Bulk "add to playlist" — selecting and moving tracks into a playlist
  // never removes them from the library; it only adds a reference, exactly
  // like the existing single-track "+" button already does.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedTracks = filtered.filter((t) => selectedIds.has(t.id));

  function toggleSelect(trackId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

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

  function handleRemove(trackId: string) {
    void removeLocalTrack(trackId);
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold retro-heading">Music Library</h1>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => playTrackList(shuffleForPlay(filtered, trackAnalysis, trackLyricalFingerprints), 0)}
            disabled={shufflableCount < 2}
            className="btn-retro-outline"
            title="Play these tracks ordered by tempo/key/energy/theme compatibility — skips Do-Not-Play tracks, puts Must-Play tracks first"
          >
            🔀 Shuffle Play
          </button>
          <button
            type="button"
            onClick={() => playTrackList(dropTheNeedle(filtered), 0)}
            disabled={shufflableCount < 2}
            className="btn-retro-outline"
            title="Play these tracks in a genuinely random order — skips Do-Not-Play tracks, puts Must-Play tracks first"
          >
            🎲 Drop the Needle
          </button>
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            disabled={filtered.length === 0}
            data-active={selectMode}
            className="btn-retro-outline"
            title="Select tracks to add to a playlist — they stay in your library too"
          >
            {selectMode ? "Cancel" : "☑ Select"}
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="btn-retro"
          >
            {loading ? "Adding…" : "+ Add Files"}
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

      {selectMode && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-border bg-surface px-4 py-2">
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
        <p className="text-sm text-muted">No local files match &quot;{query}&quot;.</p>
      ) : (
        <TrackList
          tracks={filtered}
          onRemove={handleRemove}
          selectedIds={selectMode ? selectedIds : undefined}
          onToggleSelect={selectMode ? toggleSelect : undefined}
        />
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
