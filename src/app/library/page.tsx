"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { filesToTracks } from "@/lib/localAudio";
import { TrackList } from "@/components/TrackList";

function LibraryContent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const localLibrary = useStore((s) => s.localLibrary);
  const addLocalTracks = useStore((s) => s.addLocalTracks);
  const query = (useSearchParams().get("q") ?? "").trim().toLowerCase();

  const filtered = query
    ? localLibrary.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          t.artist.toLowerCase().includes(query)
      )
    : localLibrary;

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

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Local Files</h1>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="rounded-full bg-accent text-white text-sm font-semibold px-4 py-2 hover:bg-accent-strong disabled:opacity-50 shrink-0"
        >
          {loading ? "Adding…" : "+ Add Files"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleFilesSelected}
          className="hidden"
        />
      </div>

      {localLibrary.length === 0 ? (
        <p className="text-sm text-muted">
          Add audio files from your computer to start building a set. Files stay
          in this browser tab only — you&apos;ll need to re-add them after a
          reload.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted">No local files match &quot;{query}&quot;.</p>
      ) : (
        <TrackList tracks={filtered} />
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
