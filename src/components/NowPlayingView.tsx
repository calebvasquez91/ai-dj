"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { ChevronDownIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "@/components/Icons";
import { Que } from "@/components/Que";
import { SpookySparkles } from "@/components/SpookyBackdrop";
import { LayerIndicator } from "@/components/LayerIndicator";

const PARTICLE_EMOJIS = ["🍂", "🕸️", "⚡"];
const PARTICLE_LIFETIME_MS = 4000;
const PARTICLE_MIN_INTERVAL_MS = 2000;
const PARTICLE_MAX_INTERVAL_MS = 3000;

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
  const spooky = useStore((s) => s.activePlaylistTheme === "spooky");

  // Nothing left to show full-screen (track ended, nothing queued) — drop
  // back to whatever the user was browsing rather than leaving an empty
  // now-playing screen up.
  useEffect(() => {
    if (expanded && !currentTrack) setExpanded(false);
  }, [expanded, currentTrack, setExpanded]);

  // Floating particles drifting up behind the album art (spec #11) — a
  // self-rescheduling timer (not setInterval) so the 2-3s gap between
  // spawns jitters instead of ticking on a fixed grid. Each particle
  // removes itself after its own CSS animation's lifetime.
  const [particles, setParticles] = useState<{ id: number; leftPercent: number; emoji: string }[]>([]);
  const nextParticleIdRef = useRef(0);
  useEffect(() => {
    if (!spooky) {
      // Resets immediately on exit, same "not derivable at render time"
      // reasoning as Que.tsx's own talkFrame reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParticles([]);
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout>;
    const spawn = () => {
      const id = nextParticleIdRef.current++;
      const emoji = PARTICLE_EMOJIS[Math.floor(Math.random() * PARTICLE_EMOJIS.length)];
      const leftPercent = 15 + Math.random() * 70;
      setParticles((prev) => [...prev, { id, leftPercent, emoji }]);
      setTimeout(() => setParticles((prev) => prev.filter((p) => p.id !== id)), PARTICLE_LIFETIME_MS);
      timeoutId = setTimeout(spawn, PARTICLE_MIN_INTERVAL_MS + Math.random() * (PARTICLE_MAX_INTERVAL_MS - PARTICLE_MIN_INTERVAL_MS));
    };
    timeoutId = setTimeout(spawn, PARTICLE_MIN_INTERVAL_MS + Math.random() * (PARTICLE_MAX_INTERVAL_MS - PARTICLE_MIN_INTERVAL_MS));
    return () => clearTimeout(timeoutId);
  }, [spooky]);

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
      className={`now-playing-panel fixed inset-x-0 top-0 h-dvh z-50 bg-background flex flex-col overflow-hidden transition-colors duration-1000 ${
        spooky ? "spooky" : ""
      } ${expanded ? "translate-y-0" : "translate-y-full"}`}
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
      {/* Spooky Music backdrop — solid black with sparkling glimmers,
          painted above the normal blurred-artwork layer (later in DOM
          order, same -z-10 context) and faded in/out over 1s via opacity
          alone, so leaving Spooky Music reverts smoothly instead of
          snapping back to the plain scrim. */}
      <div
        className="absolute inset-0 -z-10 bg-black transition-opacity duration-1000"
        style={{ opacity: spooky ? 1 : 0 }}
        aria-hidden="true"
      >
        {spooky && <SpookySparkles />}
      </div>

      <div className="flex items-center justify-center p-4 shrink-0">
        {spooky && (
          <span className="absolute right-4 text-xs font-semibold flex items-center gap-1" style={{ color: "#ff8a3d" }}>
            🎃 Spooky Mode
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="btn-icon absolute left-4 text-2xl text-accent-purple hover:text-accent-pink"
          title="Back to browsing"
        >
          <ChevronDownIcon size={22} />
        </button>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Now Playing</span>
      </div>

      {currentTrack && (
        // Outer box scrolls, inner box centers: on a short or landscape
        // screen the content scrolls instead of being clipped by this
        // panel's overflow-hidden (centering alone would cut off the top).
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="min-h-full flex flex-col items-center justify-center gap-4 sm:gap-8 px-4 sm:px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="relative w-[min(100%,24rem,38dvh)] aspect-square">
            <TrackThumbnailFill thumbnailUrl={currentTrack.thumbnailUrl} title={currentTrack.title} />
            {particles.map((p) => (
              <span
                key={p.id}
                className="spooky-particle"
                style={{ left: `${p.leftPercent}%` }}
                aria-hidden="true"
              >
                {p.emoji}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-3 w-full max-w-md min-w-0">
            <Que size={spooky ? 48 : 30} visible={expanded} />
            <div className="text-center flex-1 min-w-0">
              <p className="text-xl sm:text-2xl font-bold break-words line-clamp-2 transition-colors duration-1000">
                {currentTrack.title}
              </p>
              <p className="text-base text-muted break-words line-clamp-2 transition-colors duration-1000">
                {currentTrack.artist}
              </p>
            </div>
          </div>

          {spooky && <LayerIndicator />}

          <div className="w-full max-w-md flex flex-col gap-2">
            {isTransitioning && queue[0] ? (
              <p className="text-center text-accent-pink font-semibold break-words line-clamp-2">
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
              className="btn-icon text-3xl text-accent-purple hover:text-accent-pink"
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
              className="btn-icon text-3xl text-accent-purple hover:text-accent-pink"
              title="Next (→)"
            >
              <NextIcon size={28} />
            </button>
          </div>
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
