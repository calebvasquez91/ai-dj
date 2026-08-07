"use client";

import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { AddToPlaylistButton } from "@/components/AddToPlaylistButton";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import type { Track } from "@/types/music";

export function TrackList({ tracks }: { tracks: Track[] }) {
  const playTrackList = useStore((s) => s.playTrackList);
  const currentTrack = useStore((s) => s.currentTrack);

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
          className={`flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer hover:bg-surface-hover ${
            currentTrack?.id === track.id ? "bg-surface-hover" : ""
          }`}
        >
          <TrackThumbnail thumbnailUrl={track.thumbnailUrl} title={track.title} size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{track.title}</p>
            <p className="text-xs text-muted truncate">{track.artist}</p>
          </div>
          <span className="text-xs text-muted">{formatTime(track.durationSec)}</span>
          <AddToPlaylistButton track={track} />
        </div>
      ))}
    </div>
  );
}
