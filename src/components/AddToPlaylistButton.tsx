"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import type { Track } from "@/types/music";

export function AddToPlaylistButton({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const playlists = useStore((s) => s.playlists);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const addTrackToPlaylist = useStore((s) => s.addTrackToPlaylist);
  const removeTrackFromPlaylist = useStore((s) => s.removeTrackFromPlaylist);

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

  return (
    <div
      ref={containerRef}
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-accent-purple hover:text-accent-pink text-lg leading-none px-2"
        title="Add to playlist"
      >
        +
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-48 rounded-xl border-2 border-border bg-surface shadow-lg py-1">
          {playlists.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No playlists yet.</p>
          ) : (
            playlists.map((playlist) => {
              const inPlaylist = playlist.tracks.some((t) => t.id === track.id);
              return (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() =>
                    inPlaylist
                      ? removeTrackFromPlaylist(playlist.id, track.id)
                      : addTrackToPlaylist(playlist.id, track)
                  }
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-surface-hover"
                >
                  <span className="truncate">{playlist.name}</span>
                  {inPlaylist && <span className="text-accent-teal">✓</span>}
                </button>
              );
            })
          )}
          <div className="border-t-2 border-border mt-1 pt-1">
            <button
              type="button"
              onClick={async () => {
                const id = await createPlaylist();
                addTrackToPlaylist(id, track);
                setOpen(false);
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
