"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { formatTime, formatTotalDuration } from "@/lib/format";
import { ConfirmSheet, IconButton, Text } from "@/ui";
import { PlaylistCover } from "@/components/PlaylistCover";
import { PlaylistImageControl } from "@/components/PlaylistImageControl";
import { useIsAdmin } from "@/components/FeedbackOwnerProvider";
import { confirmDeletePlaylist, confirmRemoveSongFromPlaylist, confirmRenamePlaylist, type ConfirmCopy } from "@/lib/confirmCopy";
import { PlayIcon } from "@/components/Icons";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import { AddMusicBar } from "@/components/AddMusicBar";
import { UploadSongsButton } from "@/components/UploadSongsButton";
import { GenreBadge } from "@/components/GenreBadge";
import { useGenreClient } from "@/lib/genreClient";

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

/** The words for whatever is waiting for a yes on this page. */
function pendingCopy(
  pending: { kind: "rename"; from: string; to: string } | { kind: "delete" } | { kind: "remove"; trackId: string; title: string } | null,
  playlistName: string,
): ConfirmCopy | null {
  if (!pending) return null;
  if (pending.kind === "rename") return confirmRenamePlaylist(pending.from, pending.to);
  if (pending.kind === "delete") return confirmDeletePlaylist(playlistName);
  return confirmRemoveSongFromPlaylist(pending.title, playlistName);
}

function PlaylistContent() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();

  const playlist = useStore((s) => s.playlists.find((p) => p.id === id));
  const playlistsLoaded = useStore((s) => s.playlistsLoaded);
  const renamePlaylist = useStore((s) => s.renamePlaylist);
  const persistPlaylistName = useStore((s) => s.persistPlaylistName);
  const removePlaylist = useStore((s) => s.removePlaylist);
  const addLocalTracks = useStore((s) => s.addLocalTracks);
  const addTrackToPlaylist = useStore((s) => s.addTrackToPlaylist);
  const reclassifyGenres = useGenreClient((s) => s.reclassify);
  const removeTrackFromPlaylist = useStore((s) => s.removeTrackFromPlaylist);
  const moveTrackInPlaylist = useStore((s) => s.moveTrackInPlaylist);
  const playPlaylist = useStore((s) => s.playPlaylist);
  const currentTrack = useStore((s) => s.currentTrack);
  const setTrackPlayPreference = useStore((s) => s.setTrackPlayPreference);
  const analyzingTrackIds = useStore((s) => s.analyzingTrackIds);
  // The do-not-play mark is the admin's alone now; everyone else no longer sees it.
  const isAdmin = useIsAdmin();
  // The name as it is being typed (null when it is not being edited): it is only saved once the change is confirmed.
  const [draftName, setDraftName] = useState<string | null>(null);
  // The change waiting for a yes: renaming this playlist, deleting it, or taking one song out of it.
  const [pending, setPending] = useState<
    { kind: "rename"; from: string; to: string } | { kind: "delete" } | { kind: "remove"; trackId: string; title: string } | null
  >(null);

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="h-40 w-40 shrink-0 sm:h-48 sm:w-48">
          <PlaylistCover playlist={playlist} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Text variant="caption">{playlist.theme === "spooky" ? "Playlist · Spooky Music" : "Playlist"}</Text>
          <PlaylistTitleField
            value={draftName ?? playlist.name}
            onChange={setDraftName}
            onCommit={() => {
              if (draftName === null) return;
              const next = draftName.trim();
              if (!next || next === playlist.name) setDraftName(null);
              else setPending({ kind: "rename", from: playlist.name, to: next });
            }}
          />
          {!playlist.theme && <PlaylistImageControl playlist={playlist} />}
          <Text variant="secondary">
            {playlist.tracks.length} song{playlist.tracks.length === 1 ? "" : "s"}
            {playlist.tracks.length > 0 && ` · ${formatTotalDuration(playlist.tracks.reduce((sum, t) => sum + (t.durationSec || 0), 0))}`}
          </Text>
          <div className="flex flex-wrap items-center gap-3">
            {playlist.tracks.length > 0 && (
              <>
                <IconButton label="Play playlist" variant="play" onClick={() => playPlaylist(playlist)}>
                  <PlayIcon size={22} className="translate-x-0.5" />
                </IconButton>
                <button
                  type="button"
                  onClick={() => playPlaylist(playlist, { shuffle: true })}
                  disabled={playlist.tracks.filter((t) => t.playPreference !== "do-not").length < 2}
                  className="btn-outline"
                  title="Play this playlist ordered by tempo/key/energy/theme compatibility — skips Do-Not-Play tracks, puts Must-Play tracks first"
                >
                  🔀 Shuffle Play
                </button>
              </>
            )}
            {/* On every playlist, Spooky Music and Same Beat included: the files go to the library and onto the end of this playlist. */}
            <UploadSongsButton
              key={playlist.id}
              title="Upload audio files from your computer: they are saved to the music library and added to this playlist"
              onUploaded={async (tracks) => {
                addLocalTracks(tracks);
                // They all appear at once; the store saves them to the server one after another, in the order picked.
                await Promise.all(tracks.map((track) => addTrackToPlaylist(playlist.id, track)));
              }}
            />
            {playlist.tracks.length > 0 && (
              <button
                type="button"
                onClick={() => void reclassifyGenres({ playlistId: playlist.id })}
                className="btn-outline !text-xs shrink-0"
                title="Look up the genres of every track in this playlist again. Genres you set yourself are kept."
              >
                Re-classify genres
              </button>
            )}
            {!playlist.theme && (
              <button
                type="button"
                onClick={() => setPending({ kind: "delete" })}
                className="btn-outline !text-xs hover:!text-accent-pink shrink-0"
              >
                Delete playlist
              </button>
            )}
          </div>
        </div>
      </div>

      {playlist.tracks.length === 0 ? (
        <p className="text-sm text-muted">
          No tracks yet. Upload songs here, or use Add Music below to pick from your library.
        </p>
      ) : (
        <>
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
                onClick={() => playPlaylist(playlist, { startIndex: index })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    playPlaylist(playlist, { startIndex: index });
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
                  <GenreBadge track={track} />
                  {analyzingTrackIds.has(track.id) && (
                    <p className="text-[10px] font-medium text-accent-purple" aria-live="polite">
                      Analyzing…
                    </p>
                  )}
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
                  {isAdmin && (
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
                  )}
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
                        onClick={() => setPending({ kind: "remove", trackId: track.id, title: track.title })}
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

      {/* On every playlist, Spooky Music and Same Beat included; pinned to the bottom of the visible page. */}
      <AddMusicBar key={playlist.id} playlist={playlist} />

      <ConfirmSheet
        copy={pendingCopy(pending, playlist.name)}
        onCancel={() => {
          setPending(null);
          setDraftName(null);
        }}
        onConfirm={() => {
          const action = pending;
          setPending(null);
          if (action?.kind === "rename") {
            renamePlaylist(playlist.id, action.to);
            persistPlaylistName(playlist.id);
            setDraftName(null);
          } else if (action?.kind === "delete") {
            removePlaylist(playlist.id);
            router.push("/");
          } else if (action?.kind === "remove") {
            removeTrackFromPlaylist(playlist.id, action.trackId);
          }
        }}
      />
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
