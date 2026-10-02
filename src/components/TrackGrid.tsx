"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { formatRelativeTime, isRecentlyAdded } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { AddToPlaylistButton } from "@/components/AddToPlaylistButton";
import { SeparateStemsButton } from "@/components/SeparateStemsButton";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import { CloseIcon, NoEntryIcon, PauseIcon, PlayIcon, StarIcon } from "@/components/Icons";
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
  const isPlaying = useStore((s) => s.isPlaying);
  const togglePlay = useStore((s) => s.togglePlay);
  const setTrackPlayPreference = useStore((s) => s.setTrackPlayPreference);
  const setTrackTags = useStore((s) => s.setTrackTags);
  const now = useNow();
  const selectMode = Boolean(onToggleSelect);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagsDraft, setTagsDraft] = useState("");

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
              {!selectMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCurrent) togglePlay();
                    else playTrackList(tracks, index);
                  }}
                  className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-gradient-to-br from-accent-teal to-accent-purple text-white flex items-center justify-center shadow-elevate-md opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus:opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
                  title={isCurrent && isPlaying ? "Pause" : "Play"}
                >
                  {isCurrent && isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} className="translate-x-0.5" />}
                </button>
              )}
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
                  className={`btn-icon ${
                    track.playPreference === "must" ? "text-accent-yellow" : "text-muted"
                  }`}
                  title={
                    track.playPreference === "must"
                      ? "Must-Play — click to clear"
                      : "Mark Must-Play (guaranteed + first in Shuffle Play)"
                  }
                >
                  <StarIcon size={14} filled={track.playPreference === "must"} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTrackPlayPreference(track.id, track.playPreference === "do-not" ? undefined : "do-not");
                  }}
                  className={`btn-icon ${
                    track.playPreference === "do-not" ? "text-accent-pink" : "text-muted"
                  }`}
                  title={
                    track.playPreference === "do-not"
                      ? "Do-Not-Play — excluded from Shuffle Play (click to clear). A direct click here still plays it."
                      : "Mark Do-Not-Play (excluded from Shuffle Play)"
                  }
                >
                  <NoEntryIcon size={14} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagsDraft((track.tags ?? []).join(", "));
                    setEditingTagsId(track.id);
                  }}
                  className={`btn-icon text-[11px] font-semibold ${
                    track.tags && track.tags.length > 0 ? "text-accent-purple" : "text-muted"
                  }`}
                  title={track.tags?.length ? `Tags: ${track.tags.join(", ")}` : "Add tags (e.g. halloween, spooky)"}
                >
                  #
                </button>
                <AddToPlaylistButton track={track} />
                <SeparateStemsButton track={track} />
                {onRemove && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(track.id);
                    }}
                    className="btn-icon text-muted hover:text-accent-pink ml-auto"
                    title="Remove from library"
                  >
                    <CloseIcon size={14} />
                  </button>
                )}
              </div>
            )}

            {editingTagsId === track.id && (
              <input
                autoFocus
                value={tagsDraft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTagsDraft(e.target.value)}
                onBlur={() => {
                  setTrackTags(
                    track.id,
                    tagsDraft
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean)
                  );
                  setEditingTagsId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="tags, comma-separated"
                className="mt-1 w-full text-[10px] rounded bg-surface-hover border border-border/10 px-1.5 py-1 outline-none"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
