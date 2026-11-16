"use client";

import { useRef, useState } from "react";
import { uploadFiles } from "@/lib/localAudio";
import { PlusIcon } from "@/components/Icons";
import type { Track } from "@/types/music";

/**
 * "Upload songs": the same file picker the Music Library's "Add Files" button opens. The files are uploaded to the account
 * (so they are in the library for good) and the ones that made it are handed to `onUploaded`, which decides where they go
 * next (a playlist page adds them to that playlist, and the button waits for that). A file that fails does not stop the others; the button says how many.
 */
export function UploadSongsButton({ onUploaded, title }: { onUploaded: (tracks: Track[]) => void | Promise<void>; title?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = ""; // so picking the same file again still fires
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const { tracks, failed } = await uploadFiles(files);
      if (tracks.length > 0) await onUploaded(tracks);
      if (failed.length > 0) {
        setError(
          failed.length === files.length && files.length === 1
            ? `Couldn't upload ${failed[0].name}: ${failed[0].message}`
            : `${failed.length} of ${files.length} files couldn't be uploaded (${failed.map((f) => f.name).join(", ")}): ${failed[0].message}`
        );
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="btn" title={title}>
        {uploading ? <span aria-hidden="true">…</span> : <PlusIcon size={15} />}
        <span>{uploading ? "Uploading…" : "Upload songs"}</span>
      </button>
      <input ref={inputRef} type="file" accept="audio/*" multiple onChange={onChange} className="hidden" aria-label="Upload songs" />
      {error && (
        <p role="alert" className="text-xs text-accent-pink">
          {error}
        </p>
      )}
    </div>
  );
}
