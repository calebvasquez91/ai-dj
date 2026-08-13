"use client";

import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import { shuffle } from "@/lib/shuffle";

export default function PlaylistPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const playlist = useStore((s) => s.playlists.find((p) => p.id === params.id));
  const renamePlaylist = useStore((s) => s.renamePlaylist);
  const removePlaylist = useStore((s) => s.removePlaylist);
  const removeTrackFromPlaylist = useStore((s) => s.removeTrackFromPlaylist);
  const moveTrackInPlaylist = useStore((s) => s.moveTrackInPlaylist);
  const playTrackList = useStore((s) => s.playTrackList);
  const currentTrack = useStore((s) => s.currentTrack);

  if (!playlist) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted">Playlist not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <input
          value={playlist.name}
          onChange={(e) => renamePlaylist(playlist.id, e.target.value)}
          className="text-2xl font-bold bg-transparent outline-none border-b border-transparent focus:border-border flex-1"
        />
        <button
          type="button"
          onClick={() => {
            removePlaylist(playlist.id);
            router.push("/");
          }}
          className="text-xs text-muted hover:text-red-400 border border-border rounded-full px-3 py-1.5 shrink-0"
        >
          Delete playlist
        </button>
      </div>

      {playlist.tracks.length === 0 ? (
        <p className="text-sm text-muted">
          No tracks yet. Add local files and use the + button to add them here.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => playTrackList(playlist.tracks, 0)}
              className="self-start rounded-full bg-accent text-white text-sm font-semibold px-5 py-2 hover:bg-accent-strong"
            >
              ▶ Play
            </button>
            <button
              type="button"
              onClick={() => playTrackList(shuffle(playlist.tracks), 0)}
              disabled={playlist.tracks.length < 2}
              className="self-start rounded-full border border-border text-sm font-semibold px-5 py-2 hover:bg-surface-hover disabled:opacity-40"
              title="Play this playlist in a random order"
            >
              🔀 Shuffle Play
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {playlist.tracks.map((track, index) => (
              <div
                key={track.id}
                role="button"
                tabIndex={0}
                onClick={() => playTrackList(playlist.tracks, index)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    playTrackList(playlist.tracks, index);
                }}
                className={`flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer hover:bg-surface-hover ${
                  currentTrack?.id === track.id ? "bg-surface-hover" : ""
                }`}
              >
                <span className="w-5 text-xs text-muted text-right shrink-0">
                  {index + 1}
                </span>
                <TrackThumbnail
                  thumbnailUrl={track.thumbnailUrl}
                  title={track.title}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{track.title}</p>
                  <p className="text-xs text-muted truncate">{track.artist}</p>
                </div>
                <span className="text-xs text-muted">
                  {formatTime(track.durationSec)}
                </span>
                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => moveTrackInPlaylist(playlist.id, index, "up")}
                    disabled={index === 0}
                    className="text-muted hover:text-foreground disabled:opacity-30 px-1"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTrackInPlaylist(playlist.id, index, "down")}
                    disabled={index === playlist.tracks.length - 1}
                    className="text-muted hover:text-foreground disabled:opacity-30 px-1"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTrackFromPlaylist(playlist.id, track.id)}
                    className="text-muted hover:text-red-400 px-1"
                    title="Remove from playlist"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
