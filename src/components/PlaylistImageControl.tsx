"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { ConfirmSheet } from "@/ui";
import { confirmRemovePlaylistImage } from "@/lib/confirmCopy";
import { checkPickedImage, MAX_IMAGE_SIDE, targetSize } from "@/lib/playlistImage";
import type { Playlist } from "@/types/music";

function setImage(playlistId: string, imageUrl: string | undefined) {
  useStore.setState((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? { ...p, imageUrl } : p)) }));
}

/** The picture, shrunk in the browser to at most 800 px on its longer side and saved as WebP (JPEG where WebP is not available). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = targetSize(bitmap.width, bitmap.height, MAX_IMAGE_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg");
  if (!jpeg) throw new Error("That picture could not be prepared.");
  return jpeg;
}

/**
 * Add, replace or remove a playlist's own picture. The owner and the admin see it; removing asks first. The picture is checked (JPG, PNG or
 * WebP, under 10 MB), shrunk and compressed here, and the server checks it again before saving it.
 */
export function PlaylistImageControl({ playlist }: { playlist: Pick<Playlist, "id" | "name" | "imageUrl"> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    const check = checkPickedImage(file);
    if (!check.ok) return setError(check.error);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", await shrink(file), "playlist-image");
      const res = await fetch(`/api/playlists/${playlist.id}/image`, { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { imageUrl?: string; error?: string } | null;
      if (!res.ok || !body?.imageUrl) return setError(body?.error ?? "That picture could not be saved. Try again.");
      setImage(playlist.id, body.imageUrl);
    } catch {
      setError("That picture could not be used. Try a different one.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}/image`, { method: "DELETE" });
      if (!res.ok) return setError("The picture could not be removed. Try again.");
      setImage(playlist.id, undefined);
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onPick(e.target.files?.[0])} />
        <button type="button" className="btn-outline !text-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Saving…" : playlist.imageUrl ? "Change image" : "Add image"}
        </button>
        {playlist.imageUrl && (
          <button type="button" className="btn-outline !text-xs hover:!text-accent-pink" disabled={busy} onClick={() => setAsking(true)}>
            Remove image
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs text-accent-pink" role="alert">
          {error}
        </p>
      )}
      <ConfirmSheet copy={asking ? confirmRemovePlaylistImage(playlist.name) : null} busy={busy} onCancel={() => setAsking(false)} onConfirm={() => void remove()} />
    </div>
  );
}
