// Backend-aware upload of a track's audio bytes + metadata. Branches once on
// NEXT_PUBLIC_STORAGE_BACKEND (see src/lib/storage.ts for the server side):
//  - "local": plain multipart POST straight to /api/tracks, server saves the
//    file to disk and creates the DB row in one step.
//  - "blob": bytes go client -> Vercel Blob directly (server route bodies
//    are capped at 4.5MB, well under typical audio file sizes), then a
//    small JSON POST to /api/tracks just records the resulting URL.
import type { Track } from "@/types/music";

interface UploadMetadata {
  title: string;
  artist: string;
  durationSec: number;
}

export async function uploadTrack(file: File, metadata: UploadMetadata): Promise<Track> {
  const backend = process.env.NEXT_PUBLIC_STORAGE_BACKEND === "blob" ? "blob" : "local";

  const res =
    backend === "local"
      ? await uploadLocal(file, metadata)
      : await uploadToBlob(file, metadata);

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as Track;
}

async function uploadLocal(file: File, metadata: UploadMetadata): Promise<Response> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", metadata.title);
  formData.append("artist", metadata.artist);
  formData.append("durationSec", String(metadata.durationSec));
  return fetch("/api/tracks", { method: "POST", body: formData });
}

async function uploadToBlob(file: File, metadata: UploadMetadata): Promise<Response> {
  const { upload } = await import("@vercel/blob/client");
  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: "/api/tracks/upload-token",
  });
  return fetch("/api/tracks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: metadata.title,
      artist: metadata.artist,
      durationSec: metadata.durationSec,
      blobUrl: blob.url,
      mimeType: file.type,
    }),
  });
}
