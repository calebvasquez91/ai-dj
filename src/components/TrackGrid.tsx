"use client";

import { useStore } from "@/lib/store";
import { formatRelativeTime, isRecentlyAdded } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { AddToPlaylistButton } from "@/components/AddToPlaylistButton";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import type { Track } from "@/types/music";

/** Image-forward grid variant of TrackList, for the Library page's browsing view. Same actions (play, Must/Do-Not-Play, add to playlist, remove, select mode) as the row list — just laid out as tiles. */
export function TrackGrid({
  tracks,
  onRemove,
  selectedIds,
  onToggleSelect,
}: {
  tracks: Track[];
  onRemove?: (trackId: string) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (trackId: string) => void;
}) {
  const playTrackList = useStore((s) => s.playTrackList);
  const currentTrack = useStore((s) => s.currentTrack);
  const setTrackPlayPreference = useStore((s) => s.setTrackPlayPreference);
  const now = useNow();
  const selectMode = Boolean(onToggleSelect);

  return (
    <div className="flex flex-wrap gap-4">
      {tracks.map((track, index) => {
        const isNew = isRecentlyAdded(track.addedAt, now);
        const isSelected = selectedIds?.has(track.id) ?? false;
        const isCurrent = currentTrack?.id === track.id;
        return (
          <div
            key={track.id}
            role="button"
            tabIndex={0}
            onClick={() => (selectMode ? onToggleSelect!(track.id) : playTrackList(tracks, index))}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              if (selectMode) onToggleSelect!(track.id);
              else playTrackList(tracks, index);
            }}
            className={`group relative w-36 sm:w-40 rounded-xl p-2 cursor-pointer transition-all ${
              isSelected
                ? "bg-accent-purple/10 shadow-elevate-sm"
                : isCurrent
                  ? "bg-surface-hover shadow-elevate-sm"
                  : "hover:bg-surface-hover hover:shadow-elevate-sm"
            }`}
          >
            <div className="relative">
              <TrackThumbnail thumbnailUrl={track.thumbnailUrl} title={track.title} size={144} />
              {selectMode && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect!(track.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-1.5 left-1.5 w-4 h-4 accent-accent-purple"
                />
              )}
              {isNew && (
                <span className="absolute top-1.5 right-1.5 text-[10px] font-bold uppercase tracking-wide text-white bg-accent-teal rounded-full px-1.5 py-0.5">
                  New
                </span>
              )}
            </div>

            <p className="mt-2 text-sm font-medium truncate" title={track.title}>
              {track.title}
            </p>
            <p className="text-xs text-muted truncate">
              {track.artist} · {formatRelativeTime(track.addedAt, now)}
            </p>

            {!selectMode && (
              <div className="mt-1 flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTrackPlayPreference(track.id, track.playPreference === "must" ? undefined : "must");
                  }}
                  className={`btn-icon text-sm leading-none ${
                    track.playPreference === "must" ? "text-accent-yellow" : "text-muted"
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
                  className={`btn-icon text-sm leading-none ${
                    track.playPreference === "do-not" ? "text-accent-pink" : "text-muted"
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
                    className="btn-icon text-muted hover:text-accent-pink text-sm leading-none ml-auto"
                    title="Remove from library"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
