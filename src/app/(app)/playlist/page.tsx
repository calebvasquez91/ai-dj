"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import { dropTheNeedle, shuffleForPlay } from "@/lib/shuffle";

function PlaylistContent() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();

  const playlist = useStore((s) => s.playlists.find((p) => p.id === id));
  const playlistsLoaded = useStore((s) => s.playlistsLoaded);
  const renamePlaylist = useStore((s) => s.renamePlaylist);
  const persistPlaylistName = useStore((s) => s.persistPlaylistName);
  const removePlaylist = useStore((s) => s.removePlaylist);
  const removeTrackFromPlaylist = useStore((s) => s.removeTrackFromPlaylist);
  const moveTrackInPlaylist = useStore((s) => s.moveTrackInPlaylist);
  const playTrackList = useStore((s) => s.playTrackList);
  const currentTrack = useStore((s) => s.currentTrack);
  const setTrackPlayPreference = useStore((s) => s.setTrackPlayPreference);
  const trackAnalysis = useStore((s) => s.trackAnalysis);
  const trackLyricalFingerprints = useStore((s) => s.trackLyricalFingerprints);

  if (!playlist) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted">
          {playlistsLoaded ? "Playlist not found." : "Loading…"}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <input
          value={playlist.name}
          onChange={(e) => renamePlaylist(playlist.id, e.target.value)}
          onBlur={() => persistPlaylistName(playlist.id)}
          className="text-2xl font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-accent-purple flex-1"
        />
        <button
          type="button"
          onClick={() => {
            removePlaylist(playlist.id);
            router.push("/");
          }}
          className="text-xs text-muted hover:text-accent-pink border-2 border-border rounded-full px-3 py-1.5 shrink-0"
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
              className="btn-retro self-start"
            >
              ▶ Play
            </button>
            <button
              type="button"
              onClick={() => playTrackList(shuffleForPlay(playlist.tracks, trackAnalysis, trackLyricalFingerprints), 0)}
              disabled={playlist.tracks.filter((t) => t.playPreference !== "do-not").length < 2}
              className="btn-retro-outline self-start"
              title="Play this playlist ordered by tempo/key/energy/theme compatibility — skips Do-Not-Play tracks, puts Must-Play tracks first"
            >
              🔀 Shuffle Play
            </button>
            <button
              type="button"
              onClick={() => playTrackList(dropTheNeedle(playlist.tracks), 0)}
              disabled={playlist.tracks.filter((t) => t.playPreference !== "do-not").length < 2}
              className="btn-retro-outline self-start"
              title="Play this playlist in a genuinely random order — skips Do-Not-Play tracks, puts Must-Play tracks first"
            >
              🎲 Drop the Needle
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
                className={`flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer border border-transparent hover:border-accent/40 hover:bg-surface-hover transition-colors ${
                  currentTrack?.id === track.id ? "bg-surface-hover border-accent/40" : ""
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
                    onClick={() =>
                      setTrackPlayPreference(track.id, track.playPreference === "must" ? undefined : "must")
                    }
                    className={`px-1 text-sm leading-none ${
                      track.playPreference === "must" ? "text-accent-yellow" : "text-muted hover:text-foreground"
                    }`}
                    title={
                      track.playPreference === "must"
                        ? "Must-Play — click to clear"
                        : "Mark Must-Play (guaranteed + first in Shuffle Play / Drop the Needle)"
                    }
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setTrackPlayPreference(track.id, track.playPreference === "do-not" ? undefined : "do-not")
                    }
                    className={`px-1 text-sm leading-none ${
                      track.playPreference === "do-not" ? "text-accent-pink" : "text-muted hover:text-foreground"
                    }`}
                    title={
                      track.playPreference === "do-not"
                        ? "Do-Not-Play — excluded from Shuffle Play / Drop the Needle (click to clear). A direct click here still plays it."
                        : "Mark Do-Not-Play (excluded from Shuffle Play / Drop the Needle)"
                    }
                  >
                    🚫
                  </button>
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
                    className="text-muted hover:text-accent-pink px-1"
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

export default function PlaylistPage() {
  return (
    <Suspense>
      <PlaylistContent />
    </Suspense>
  );
}
