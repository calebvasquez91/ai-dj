"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";

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
      className={`fixed inset-0 z-50 bg-background flex flex-col transition-transform duration-300 ease-in-out ${
        expanded ? "translate-y-0" : "translate-y-full"
      }`}
      aria-hidden={!expanded}
      inert={!expanded ? true : undefined}
    >
      <div className="flex items-center justify-center p-4 shrink-0">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="absolute left-4 text-2xl text-accent-purple hover:text-accent-pink"
          title="Back to browsing"
        >
          ⌄
        </button>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Now Playing</span>
      </div>

      {currentTrack && (
        <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 pb-10 min-h-0">
          <div className="w-full max-w-xs sm:max-w-sm aspect-square">
            <TrackThumbnailFill thumbnailUrl={currentTrack.thumbnailUrl} title={currentTrack.title} />
          </div>

          <div className="text-center max-w-md">
            <p className="text-2xl font-bold truncate">{currentTrack.title}</p>
            <p className="text-base text-muted truncate">{currentTrack.artist}</p>
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
                  className="flex-1 h-2 rounded-full bg-surface overflow-hidden cursor-pointer border border-border"
                  onClick={handleSeekClick}
                >
                  <div
                    className="h-full bg-gradient-to-r from-accent-teal via-accent-purple to-accent-pink"
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
              className="text-3xl text-accent-purple hover:text-accent-pink"
              title="Previous (←)"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="w-16 h-16 rounded-full bg-gradient-to-br from-accent-teal to-accent-purple text-white border-2 border-border flex items-center justify-center text-2xl shadow-[3px_3px_0_var(--border)]"
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button
              type="button"
              onClick={next}
              className="text-3xl text-accent-purple hover:text-accent-pink"
              title="Next (→)"
            >
              ⏭
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
      <div className="w-full h-full rounded-2xl border-2 border-border bg-gradient-to-br from-accent-teal via-accent-purple to-accent-pink flex items-center justify-center text-white text-6xl">
        ♪
      </div>
    );
  }
  return (
    <div className="relative w-full h-full">
      <Image src={thumbnailUrl} alt={title} fill className="rounded-2xl object-cover border-2 border-border" />
    </div>
  );
}
