"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { filesToTracks } from "@/lib/localAudio";
import { deleteAudioFile } from "@/lib/audioDb";
import { TrackList } from "@/components/TrackList";
import { shuffleForPlay } from "@/lib/shuffle";

function LibraryContent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const localLibrary = useStore((s) => s.localLibrary);
  const addLocalTracks = useStore((s) => s.addLocalTracks);
  const removeLocalTrack = useStore((s) => s.removeLocalTrack);
  const playTrackList = useStore((s) => s.playTrackList);
  const audioHydrated = useStore((s) => s.audioHydrated);
  const query = (useSearchParams().get("q") ?? "").trim().toLowerCase();

  const filtered = query
    ? localLibrary.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          t.artist.toLowerCase().includes(query)
      )
    : localLibrary;
  const shufflableCount = filtered.filter((t) => t.playPreference !== "do-not").length;

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setLoading(true);
    try {
      const tracks = await filesToTracks(files);
      addLocalTracks(tracks);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  function handleRemove(trackId: string) {
    removeLocalTrack(trackId);
    void deleteAudioFile(trackId);
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold retro-heading">Local Files</h1>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => playTrackList(shuffleForPlay(filtered), 0)}
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

      {!audioHydrated && localLibrary.length > 0 && (
        <p className="text-xs text-accent-teal">
          Restoring your saved tracks…
        </p>
      )}

      {localLibrary.length === 0 ? (
        <p className="text-sm text-muted">
          Add audio files from your computer to start building a set. They&apos;re
          saved in this browser so you won&apos;t need to re-add them next time.
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
