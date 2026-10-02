"use client";

import { useCallback, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { AnchoredMenu } from "@/components/AnchoredMenu";
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
  const close = useCallback(() => setOpen(false), []);

  const playlists = useStore((s) => s.playlists);
  const createPlaylist = useStore((s) => s.createPlaylist);
  const addTrackToPlaylist = useStore((s) => s.addTrackToPlaylist);

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
        className="btn-outline"
        title="Add the selected tracks to a playlist — they stay in your library too"
      >
        + Add to Playlist
      </button>
      {open && (
        <AnchoredMenu anchorRef={containerRef} onClose={close} width={224} align="start" className="py-1">
          {playlists.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No playlists yet.</p>
          ) : (
            playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => addAllTo(playlist.id)}
                title={playlist.name}
                className="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-surface-hover break-words"
              >
                {playlist.name}
              </button>
            ))
          )}
          <div className="border-t border-border/10 mt-1 pt-1">
            <button
              type="button"
              onClick={async () => {
                const id = await createPlaylist();
                if (!id) return;
                addAllTo(id);
              }}
              className="w-full px-3 py-2 text-sm text-left text-accent-purple font-semibold hover:bg-surface-hover"
            >
              + New playlist
            </button>
          </div>
        </AnchoredMenu>
      )}
    </div>
  );
}
