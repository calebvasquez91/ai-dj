"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmSheet } from "@/ui";
import { confirmDeletePlaylist, confirmRemoveSongFromPlaylist, confirmRenamePlaylist } from "@/lib/confirmCopy";

/**
 * The admin's controls on one playlist (any account's): rename it, delete it. Both go through the same playlist routes the owner
 * uses, which also let the admin in. System playlists (Spooky Music) cannot be deleted, and the route says so.
 */
export function AdminPlaylistActions({ playlistId, name, isSystem }: { playlistId: string; name: string; isSystem: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Renaming and deleting ask first.
  const [pending, setPending] = useState<"rename" | "delete" | null>(null);

  async function call(url: string, init: RequestInit, done: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage(body?.error ?? "That didn't work. Try again.");
        return;
      }
      done();
    } catch {
      setMessage("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = draft.trim();
          if (!next || next === name) return;
          setPending("rename");
        }}
      >
        <label className="sr-only" htmlFor="admin-playlist-name">Playlist name</label>
        <input
          id="admin-playlist-name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={120}
          className="min-w-0 flex-1 rounded-lg bg-surface-hover border border-border/10 px-3 py-2 text-sm outline-none"
        />
        <button type="submit" disabled={busy || !draft.trim() || draft.trim() === name} className="btn-outline !text-xs">
          Rename
        </button>
        {!isSystem && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setPending("delete")}
            className="btn-outline !text-xs text-accent-pink"
          >
            Delete playlist
          </button>
        )}
      </form>
      {message && (
        <p className="text-xs text-accent-pink" role="alert">
          {message}
        </p>
      )}
      <ConfirmSheet
        busy={busy}
        copy={pending === "rename" ? confirmRenamePlaylist(name, draft.trim()) : pending === "delete" ? confirmDeletePlaylist(name) : null}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const action = pending;
          setPending(null);
          if (action === "rename") {
            void call(`/api/playlists/${playlistId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: draft.trim() }) }, () => router.refresh());
          } else if (action === "delete") {
            void call(`/api/playlists/${playlistId}`, { method: "DELETE" }, () => router.push("/admin/playlists"));
          }
        }}
      />
    </div>
  );
}

/** One song's "take out of this playlist" button. The song stays in the library. */
export function AdminRemoveFromPlaylist({ playlistId, trackId, title, playlistName }: { playlistId: string; trackId: string; title: string; playlistName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Take ${title} out of this playlist`}
        title="Take out of this playlist (it stays in the library)"
        onClick={() => setAsking(true)}
        className="btn-icon text-muted hover:text-accent-pink shrink-0"
      >
        ✕
      </button>
      <ConfirmSheet
        busy={busy}
        copy={asking ? confirmRemoveSongFromPlaylist(title, playlistName) : null}
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            const res = await fetch(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: "DELETE" });
            if (res.ok) router.refresh();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      />
    </>
  );
}
