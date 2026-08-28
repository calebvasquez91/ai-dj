"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { filesToTracks } from "@/lib/localAudio";
import { TrackList } from "@/components/TrackList";
import { shuffleForPlay } from "@/lib/shuffle";

function LibraryContent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const localLibrary = useStore((s) => s.localLibrary);
  const addLocalTracks = useStore((s) => s.addLocalTracks);
  const removeLocalTrack = useStore((s) => s.removeLocalTrack);
  const playTrackList = useStore((s) => s.playTrackList);
  const libraryLoaded = useStore((s) => s.libraryLoaded);
  const trackAnalysis = useStore((s) => s.trackAnalysis);
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
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => playTrackList(shuffleForPlay(filtered, trackAnalysis), 0)}
            disabled={shufflableCount < 2}
            className="btn-retro-outline"
            title="Play these tracks in a random order — skips Do-Not-Play tracks, puts Must-Play tracks first"
          >
            🔀 Shuffle Play
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="btn-retro"
          >
            {loading ? "Adding…" : "+ Add Files"}
          </button>
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
        <TrackList tracks={filtered} onRemove={handleRemove} />
      )}
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
