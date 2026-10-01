"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { ChevronDownIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "@/components/Icons";
import { Que } from "@/components/Que";

/**
 * Full-screen now-playing view, expanded from the compact PlayerBar footer
 * (tap the artwork/title there to open). Always mounted — collapsed state
 * is a transform off-screen, not an unmount, so the open/close transition
 * animates smoothly instead of an abrupt swap. Deliberately lean: just the
 * artwork/track info/transport a real "now playing" screen needs, not a
 * second copy of every PlayerBar control (DJ mode, style, crossfade, etc.
 * stay in the compact bar only).
 */
export function NowPlayingView() {
  const expanded = useStore((s) => s.nowPlayingExpanded);
  const setExpanded = useStore((s) => s.setNowPlayingExpanded);
  const currentTrack = useStore((s) => s.currentTrack);
  const isPlaying = useStore((s) => s.isPlaying);
  const togglePlay = useStore((s) => s.togglePlay);
  const currentTimeSec = useStore((s) => s.currentTimeSec);
  const requestSeek = useStore((s) => s.requestSeek);
  const next = useStore((s) => s.next);
  const previous = useStore((s) => s.previous);
  const queue = useStore((s) => s.queue);
  const isTransitioning = useStore((s) => s.isTransitioning);

  // Nothing left to show full-screen (track ended, nothing queued) — drop
  // back to whatever the user was browsing rather than leaving an empty
  // now-playing screen up.
  useEffect(() => {
    if (expanded && !currentTrack) setExpanded(false);
  }, [expanded, currentTrack, setExpanded]);

  const durationSec = currentTrack?.durationSec ?? 0;
  const progressPercent = durationSec > 0 ? Math.min(100, (currentTimeSec / durationSec) * 100) : 0;

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!currentTrack || durationSec === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    requestSeek(Math.max(0, Math.min(1, ratio)) * durationSec);
  }

  return (
    <div
      className={`now-playing-panel fixed inset-0 z-50 bg-background flex flex-col overflow-hidden ${
        expanded ? "translate-y-0" : "translate-y-full"
      }`}
      aria-hidden={!expanded}
      inert={!expanded ? true : undefined}
    >
      {/* Immersive blurred-artwork backdrop, Apple Music/Spotify full-screen
          player style — the same cover art, scaled up and heavily blurred,
          with a scrim of the page's own --background over it so text stays
          readable regardless of how bright/dark the art is. Negative
          z-index within this panel's own stacking context (it's `fixed` +
          `z-50`, so it forms one) keeps it behind the normal-flow content
          below without those elements needing z-index of their own. */}
      {currentTrack?.thumbnailUrl && (
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center opacity-50 blur-3xl scale-125"
          style={{ backgroundImage: `url(${currentTrack.thumbnailUrl})` }}
          aria-hidden="true"
        />
      )}
      <div className="absolute inset-0 -z-10 bg-background/70" aria-hidden="true" />

      <div className="flex items-center justify-center p-4 shrink-0">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="btn-icon absolute left-4 text-accent-purple hover:text-accent-pink"
          title="Back to browsing"
        >
          <ChevronDownIcon size={22} />
        </button>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Now Playing</span>
      </div>

      {currentTrack && (
        <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 pb-10 min-h-0">
          <div className="w-[min(100%,24rem,45vh)] aspect-square">
            <TrackThumbnailFill thumbnailUrl={currentTrack.thumbnailUrl} title={currentTrack.title} />
          </div>

          <div className="flex items-center gap-3 max-w-md min-w-0">
            <Que size={30} />
            <div className="text-center flex-1 min-w-0">
              <p className="text-2xl font-bold truncate">{currentTrack.title}</p>
              <p className="text-base text-muted truncate">{currentTrack.artist}</p>
            </div>
          </div>

          <div className="w-full max-w-md flex flex-col gap-2">
            {isTransitioning && queue[0] ? (
              <p className="text-center text-accent-pink font-semibold truncate">
                Mixing into &ldquo;{queue[0].title}&rdquo;
              </p>
            ) : (
              <div className="flex items-center gap-3 text-xs text-muted">
                <span>{formatTime(currentTimeSec)}</span>
                <div
                  className="flex-1 h-2 rounded-full bg-surface overflow-hidden cursor-pointer"
                  onClick={handleSeekClick}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent-teal to-accent-purple"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span>{formatTime(durationSec)}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-8">
            <button
              type="button"
              onClick={previous}
              className="btn-icon text-accent-purple hover:text-accent-pink"
              title="Previous (←)"
            >
              <PreviousIcon size={28} />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="w-16 h-16 rounded-full bg-gradient-to-br from-accent-teal to-accent-purple text-white flex items-center justify-center shadow-elevate-md transition-transform hover:scale-105 active:scale-95"
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            >
              {isPlaying ? <PauseIcon size={28} /> : <PlayIcon size={28} className="translate-x-0.5" />}
            </button>
            <button
              type="button"
              onClick={next}
              className="btn-icon text-accent-purple hover:text-accent-pink"
              title="Next (→)"
            >
              <NextIcon size={28} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** TrackThumbnail sized to fill its parent instead of a fixed pixel size — the full-screen view needs a responsive square, not one more fixed-size icon. */
function TrackThumbnailFill({ thumbnailUrl, title }: { thumbnailUrl?: string; title: string }) {
  if (!thumbnailUrl) {
    return (
      <div className="w-full h-full rounded-2xl shadow-elevate-md bg-gradient-to-br from-accent-teal to-accent-purple flex items-center justify-center text-white text-6xl">
        ♪
      </div>
    );
  }
  return (
    <div className="relative w-full h-full">
      <Image src={thumbnailUrl} alt={title} fill className="rounded-2xl object-cover shadow-elevate-md" />
    </div>
  );
}
