"use client";

import { useCallback, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { AnchoredMenu } from "@/components/AnchoredMenu";
import { ConfirmSheet } from "@/ui";
import { confirmRemoveSongFromPlaylist } from "@/lib/confirmCopy";
import type { Track } from "@/types/music";

export function AddToPlaylistButton({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // The playlist this song is about to be taken out of (asks first; the song stays in the library).
  const [removingFrom, setRemovingFrom] = useState<{ id: string; name: string } | null>(null);

  const playlists = useStore((s) => s.playlists);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const addTrackToPlaylist = useStore((s) => s.addTrackToPlaylist);
  const removeTrackFromPlaylist = useStore((s) => s.removeTrackFromPlaylist);

  return (
    <div
      ref={containerRef}
      className="relative"
      onClick={(e) => e.stopPropagation()}
      // The confirmation below is portaled out of this box but its clicks and keys still bubble through it; the row around it plays the song on Enter/Space.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn-icon text-accent-purple hover:text-accent-pink text-lg leading-none"
        title="Add to playlist"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        +
      </button>
      {open && (
        <AnchoredMenu anchorRef={containerRef} onClose={close} width={192} align="end" className="py-1">
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
                    {
                      if (inPlaylist) {
                        setRemovingFrom({ id: playlist.id, name: playlist.name });
                        setOpen(false);
                      } else addTrackToPlaylist(playlist.id, track);
                    }
                  }
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-surface-hover"
                >
                  <span className="break-words min-w-0" title={playlist.name}>
                    {playlist.name}
                  </span>
                  {inPlaylist && <span className="text-accent-teal shrink-0">✓</span>}
                </button>
              );
            })
          )}
          <div className="border-t border-border/10 mt-1 pt-1">
            <button
              type="button"
              onClick={async () => {
                const id = await createPlaylist();
                if (!id) return;
                addTrackToPlaylist(id, track);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-sm text-left text-accent-purple font-semibold hover:bg-surface-hover"
            >
              + New playlist
            </button>
          </div>
        </AnchoredMenu>
      )}
      <ConfirmSheet
        copy={removingFrom ? confirmRemoveSongFromPlaylist(track.title, removingFrom.name) : null}
        onCancel={() => setRemovingFrom(null)}
        onConfirm={() => {
          const target = removingFrom;
          setRemovingFrom(null);
          if (target) removeTrackFromPlaylist(target.id, track.id);
        }}
      />
    </div>
  );
}
