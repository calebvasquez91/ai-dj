"use client";

import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { AddToPlaylistButton } from "@/components/AddToPlaylistButton";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import type { Track } from "@/types/music";

export function TrackList({
  tracks,
  onRemove,
}: {
  tracks: Track[];
  onRemove?: (trackId: string) => void;
}) {
  const playTrackList = useStore((s) => s.playTrackList);
  const currentTrack = useStore((s) => s.currentTrack);
  const setTrackPlayPreference = useStore((s) => s.setTrackPlayPreference);

  return (
    <div className="flex flex-col gap-1">
      {tracks.map((track, index) => (
        <div
          key={track.id}
          role="button"
          tabIndex={0}
          onClick={() => playTrackList(tracks, index)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") playTrackList(tracks, index);
          }}
          className={`group flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer border border-transparent hover:border-accent/40 hover:bg-surface-hover transition-colors ${
            currentTrack?.id === track.id ? "bg-surface-hover border-accent/40" : ""
          }`}
        >
          <TrackThumbnail thumbnailUrl={track.thumbnailUrl} title={track.title} size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{track.title}</p>
            <p className="text-xs text-muted truncate">{track.artist}</p>
          </div>
          <span className="text-xs text-muted">{formatTime(track.durationSec)}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTrackPlayPreference(track.id, track.playPreference === "must" ? undefined : "must");
            }}
            className={`px-1 text-sm leading-none transition-opacity ${
              track.playPreference === "must"
                ? "text-accent-yellow"
                : "text-muted opacity-0 group-hover:opacity-100 focus:opacity-100"
            }`}
            title={
              track.playPreference === "must"
                ? "Must-Play — click to clear"
                : "Mark Must-Play (guaranteed + first in Shuffle Play)"
            }
          >
            ★
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTrackPlayPreference(track.id, track.playPreference === "do-not" ? undefined : "do-not");
            }}
            className={`px-1 text-sm leading-none transition-opacity ${
              track.playPreference === "do-not"
                ? "text-accent-pink"
                : "text-muted opacity-0 group-hover:opacity-100 focus:opacity-100"
            }`}
            title={
              track.playPreference === "do-not"
                ? "Do-Not-Play — excluded from Shuffle Play (click to clear). A direct click here still plays it."
                : "Mark Do-Not-Play (excluded from Shuffle Play)"
            }
          >
            🚫
          </button>
          <AddToPlaylistButton track={track} />
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(track.id);
              }}
              className="text-muted hover:text-accent-pink px-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              title="Remove from library"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
