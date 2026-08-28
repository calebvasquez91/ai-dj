"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import type { Track } from "@/types/music";

/**
 * Bulk version of AddToPlaylistButton — adds every track in `tracks` to
 * whichever playlist is picked. Purely additive: this only ever creates
 * PlaylistTrack rows, exactly like the single-track button does, so the
 * library itself is never touched (nothing here can remove or move a
 * track out of it, "move to playlist" always means "copy a reference in").
 * A track already in the target playlist is silently skipped rather than
 * duplicated (addTrackToPlaylist's own existing dedup guard).
 */
export function AddSelectedToPlaylistButton({
  tracks,
  onDone,
}: {
  tracks: Track[];
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const playlists = useStore((s) => s.playlists);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const addTrackToPlaylist = useStore((s) => s.addTrackToPlaylist);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  function addAllTo(playlistId: string) {
    for (const track of tracks) addTrackToPlaylist(playlistId, track);
    setOpen(false);
    onDone?.();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={tracks.length === 0}
        className="btn-retro-outline"
        title="Add the selected tracks to a playlist — they stay in your library too"
      >
        + Add to Playlist
      </button>
      {open && (
        <div className="absolute left-0 z-10 mt-1 w-56 rounded-xl border-2 border-border bg-surface shadow-lg py-1">
          {playlists.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No playlists yet.</p>
          ) : (
            playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => addAllTo(playlist.id)}
                className="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-surface-hover truncate"
              >
                {playlist.name}
              </button>
            ))
          )}
          <div className="border-t-2 border-border mt-1 pt-1">
            <button
              type="button"
              onClick={async () => {
                const id = await createPlaylist();
                addAllTo(id);
              }}
              className="w-full px-3 py-2 text-sm text-left text-accent-purple font-semibold hover:bg-surface-hover"
            >
              + New playlist
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
