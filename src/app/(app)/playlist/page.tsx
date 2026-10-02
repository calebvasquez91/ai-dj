"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { TrackThumbnail } from "@/components/TrackThumbnail";

/**
 * The playlist name as a textarea that grows with its content, not an
 * <input>: an input can't wrap, so a long name was clipped (and on a phone
 * pushed the whole page sideways). Enter commits instead of inserting a newline.
 */
function PlaylistTitleField({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(resize, [value, resize]);
  // Re-measure when the available width changes (rotate, resize, sidebar toggle).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [resize]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label="Playlist name"
      className="block w-full min-w-0 resize-none overflow-hidden break-words text-xl sm:text-2xl font-bold bg-transparent outline-none border-b-2 border-transparent focus:border-accent-purple"
    />
  );
}

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
  const startShuffle = useStore((s) => s.startShuffle);
  const currentTrack = useStore((s) => s.currentTrack);
  const setTrackPlayPreference = useStore((s) => s.setTrackPlayPreference);

  if (!playlist) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted">
          {playlistsLoaded ? "Playlist not found." : "Loading…"}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <PlaylistTitleField
            value={playlist.name}
            onChange={(name) => renamePlaylist(playlist.id, name)}
            onCommit={() => persistPlaylistName(playlist.id)}
          />
        </div>
        {!playlist.theme && (
          <button
            type="button"
            onClick={() => {
              removePlaylist(playlist.id);
              router.push("/");
            }}
            className="btn-outline !text-xs hover:!text-accent-pink shrink-0"
          >
            Delete playlist
          </button>
        )}
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
              onClick={() => playTrackList(playlist.tracks, 0, playlist.theme)}
              className="btn self-start"
            >
              ▶ Play
            </button>
            <button
              type="button"
              onClick={() => startShuffle(playlist.tracks)}
              disabled={playlist.tracks.filter((t) => t.playPreference !== "do-not").length < 2}
              className="btn-outline self-start"
              title="Play this playlist ordered by tempo/key/energy/theme compatibility — skips Do-Not-Play tracks, puts Must-Play tracks first"
            >
              🔀 Shuffle Play
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {playlist.tracks.map((track, index) => {
              // Auto-included via a tag-matching rule (e.g. Spooky Music's
              // halloween/spooky union) — there's no PlaylistTrack row to
              // reorder or remove, so offering those controls would silently
              // no-op and the track would just reappear on the next load.
              const autoIncluded = playlist.autoIncludedTrackIds?.includes(track.id) ?? false;
              return (
              <div
                key={track.id}
                role="button"
                tabIndex={0}
                onClick={() => playTrackList(playlist.tracks, index, playlist.theme)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    playTrackList(playlist.tracks, index, playlist.theme);
                }}
                // flex-wrap: on a narrow screen the controls drop to a second
                // line under the title (the title block keeps a min basis)
                // instead of squeezing the title down to nothing.
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 cursor-pointer border border-transparent hover:border-accent/40 hover:bg-surface-hover transition-colors ${
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
                <div className="min-w-0 flex-1 basis-32">
                  <p className="text-sm font-medium break-words line-clamp-2">{track.title}</p>
                  <p className="text-xs text-muted break-words line-clamp-1">{track.artist}</p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
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
                    className={`btn-icon text-sm leading-none ${
                      track.playPreference === "must" ? "text-accent-yellow" : "text-muted hover:text-foreground"
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
                    onClick={() =>
                      setTrackPlayPreference(track.id, track.playPreference === "do-not" ? undefined : "do-not")
                    }
                    className={`btn-icon text-sm leading-none ${
                      track.playPreference === "do-not" ? "text-accent-pink" : "text-muted hover:text-foreground"
                    }`}
                    title={
                      track.playPreference === "do-not"
                        ? "Do-Not-Play — excluded from Shuffle Play (click to clear). A direct click here still plays it."
                        : "Mark Do-Not-Play (excluded from Shuffle Play)"
                    }
                  >
                    🚫
                  </button>
                  {autoIncluded ? (
                    <span
                      className="text-[10px] text-muted px-1.5 shrink-0"
                      title="Added automatically because this track is tagged halloween/spooky — edit its tags in Music Library to remove it from here"
                    >
                      via tag
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => moveTrackInPlaylist(playlist.id, index, "up")}
                        disabled={index === 0}
                        className="btn-icon text-muted hover:text-foreground"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTrackInPlaylist(playlist.id, index, "down")}
                        disabled={index === playlist.tracks.length - 1}
                        className="btn-icon text-muted hover:text-foreground"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTrackFromPlaylist(playlist.id, track.id)}
                        className="btn-icon text-muted hover:text-accent-pink"
                        title="Remove from playlist"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
                </div>
              </div>
              );
            })}
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
