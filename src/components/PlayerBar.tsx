"use client";

import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { DualDeckStage } from "@/components/DualDeckStage";
import { YouTubeDeckStage } from "@/components/YouTubeDeckStage";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import { Que } from "@/components/Que";
import { genreFamilies } from "@/data/styles";
import type { DjSetMode } from "@/lib/mix-engine";
import { DecksIcon, MixerIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, QueueIcon } from "@/components/Icons";

export const CROSSFADE_PRESETS = [5, 10, 15, 20, 30];

export const DJ_MODES: { id: DjSetMode; label: string; title: string }[] = [
  { id: "auto", label: "Mode: Auto", title: "No bias — pick whatever scores best" },
  { id: "club", label: "Club", title: "Favors beatmatched, EQ-driven blends over flashy effects" },
  { id: "wedding", label: "Wedding", title: "Favors clean, safe blends; avoids scratches, risers, and other flashy effects" },
  { id: "party", label: "Party", title: "Leans into crowd-hype moments — tags, word play, risers, drops" },
  { id: "chill", label: "Chill", title: "Favors long, smooth blends and reverb washes; avoids anything abrupt" },
  { id: "open-format", label: "Open Format", title: "Leans into bold genre/tempo bridges — tempo ramps, brakes, spin-ups, hard cuts" },
];

export function PlayerBar() {
  const currentTrack = useStore((s) => s.currentTrack);
  const isPlaying = useStore((s) => s.isPlaying);
  const togglePlay = useStore((s) => s.togglePlay);
  const volume = useStore((s) => s.volume);
  const setVolume = useStore((s) => s.setVolume);
  const autoDjEnabled = useStore((s) => s.autoDjEnabled);
  const requestFx = useStore((s) => s.requestFx);
  const fxLayerActive = useStore((s) => s.fxLayerActive);
  const setAutoDj = useStore((s) => s.setAutoDj);
  const currentTimeSec = useStore((s) => s.currentTimeSec);
  const requestSeek = useStore((s) => s.requestSeek);
  const next = useStore((s) => s.next);
  const previous = useStore((s) => s.previous);
  const queue = useStore((s) => s.queue);
  const isTransitioning = useStore((s) => s.isTransitioning);
  const requestMixNow = useStore((s) => s.requestMixNow);
  const crossfadeOverrideSec = useStore((s) => s.crossfadeOverrideSec);
  const setCrossfadeOverride = useStore((s) => s.setCrossfadeOverride);
  const toggleQueuePanel = useStore((s) => s.toggleQueuePanel);
  const toggleDeckView = useStore((s) => s.toggleDeckView);
  const toggleMixerPanel = useStore((s) => s.toggleMixerPanel);
  const styleGenreHint = useStore((s) => s.styleGenreHint);
  const setStyleGenreHint = useStore((s) => s.setStyleGenreHint);
  const djMode = useStore((s) => s.djMode);
  const setDjMode = useStore((s) => s.setDjMode);
  const analyzingTrackIds = useStore((s) => s.analyzingTrackIds);
  const nextTrackAnalyzing = queue[0] ? analyzingTrackIds.has(queue[0].id) : false;
  const nowPlayingExpanded = useStore((s) => s.nowPlayingExpanded);
  const setNowPlayingExpanded = useStore((s) => s.setNowPlayingExpanded);

  const durationSec = currentTrack?.durationSec ?? 0;
  const progressPercent =
    durationSec > 0 ? Math.min(100, (currentTimeSec / durationSec) * 100) : 0;

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!currentTrack || durationSec === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    requestSeek(Math.max(0, Math.min(1, ratio)) * durationSec);
  }

  return (
    <footer
      className="relative min-h-20 shrink-0 shadow-elevate-top surface-glass border-t border-border/10 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] flex flex-wrap items-center gap-2 lg:gap-4"
      inert={nowPlayingExpanded ? true : undefined}
    >
      {currentTrack && (
        <div className="absolute -top-9 left-4 z-10">
          <Que />
        </div>
      )}
      <div className="flex items-center gap-3 w-28 sm:w-48 lg:w-64 min-w-0 shrink-0">
        {currentTrack ? (
          <>
            <DualDeckStage />
            <YouTubeDeckStage />
            <div
              role="button"
              tabIndex={0}
              onClick={() => setNowPlayingExpanded(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setNowPlayingExpanded(true);
              }}
              className="group flex items-center gap-3 min-w-0 cursor-pointer"
              title="Open full-screen now playing"
            >
              <div className="transition-transform duration-200 group-hover:scale-105">
                <TrackThumbnail
                  thumbnailUrl={currentTrack.thumbnailUrl}
                  title={currentTrack.title}
                  size={48}
                />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{currentTrack.title}</p>
                <p className="text-xs text-muted truncate">{currentTrack.artist}</p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Nothing playing</p>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center gap-1 max-w-xl mx-auto min-w-0">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={previous}
            disabled={!currentTrack}
            className="btn-icon text-accent-purple hover:text-accent-pink disabled:text-muted"
            title="Previous (←)"
          >
            <PreviousIcon />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            disabled={!currentTrack}
            className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-teal to-accent-purple text-white flex items-center justify-center disabled:opacity-40 shadow-elevate-md transition-transform hover:scale-105 active:scale-95"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} className="translate-x-0.5" />}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!currentTrack}
            className="btn-icon text-accent-purple hover:text-accent-pink disabled:text-muted"
            title="Next (→)"
          >
            <NextIcon />
          </button>
        </div>
        <div className="w-full flex items-center gap-2 text-xs text-muted">
          {isTransitioning && queue[0] ? (
            <span className="flex-1 text-center text-accent-pink font-semibold truncate">
              Mixing into &ldquo;{queue[0].title}&rdquo;
            </span>
          ) : (
            <>
              <span>{formatTime(currentTimeSec)}</span>
              <div
                className="flex-1 h-1.5 rounded-full bg-background overflow-hidden cursor-pointer"
                onClick={handleSeekClick}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-teal to-accent-purple"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span>{formatTime(durationSec)}</span>
            </>
          )}
        </div>
      </div>

      {/* Own row below 850px: between ~768 and ~815px the transport column is narrower than its own buttons and Next would sit on top of FX. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-2 justify-between min-[850px]:justify-end w-full min-[850px]:w-auto shrink-0">
        <button
          type="button"
          onClick={() => requestFx()}
          aria-pressed={fxLayerActive}
          className={`btn-icon transition-all ${
            fxLayerActive
              ? "bg-accent-purple text-white shadow-[0_0_12px_var(--accent-purple)]"
              : "text-accent-purple/60 hover:text-accent-pink"
          }`}
          aria-label="FX"
          title={
            fxLayerActive
              ? "FX playing — press again to stop it"
              : "FX — play a random sound from your FX Library's Effects category (press again while it plays to stop it)"
          }
        >
          <span aria-hidden="true" className="text-sm font-bold leading-none">FX</span>
        </button>
        <button
          type="button"
          onClick={toggleDeckView}
          disabled={!currentTrack}
          className="btn-icon text-accent-purple hover:text-accent-pink disabled:text-muted"
          title="Show the DJ decks — tempo, key, and what's lined up next"
        >
          <DecksIcon />
        </button>
        <button
          type="button"
          onClick={toggleMixerPanel}
          disabled={!currentTrack}
          className="btn-icon text-accent-purple hover:text-accent-pink disabled:text-muted"
          title="Mixer — watch the AI's live crossfader, EQ, and filter"
        >
          <MixerIcon />
        </button>
        <button
          type="button"
          onClick={toggleQueuePanel}
          className="btn-icon relative text-accent-purple hover:text-accent-pink"
          title="Queue (Q)"
        >
          <QueueIcon />
          {queue.length > 0 && (
            <span className="absolute -top-1 -right-1 text-[10px] leading-none bg-accent-pink text-white rounded-full w-4 h-4 flex items-center justify-center">
              {queue.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={requestMixNow}
          disabled={!currentTrack || queue.length === 0 || isTransitioning || nextTrackAnalyzing}
          className="btn-outline"
          title={
            nextTrackAnalyzing
              ? "Analyzing next track's beat/tempo…"
              : "Beatmatch and mix into the next queued track now (M)"
          }
        >
          {isTransitioning ? (
            <>
              Mix<span className="max-sm:hidden">ing</span>…
            </>
          ) : nextTrackAnalyzing ? (
            <>
              <span className="sm:hidden">…</span>
              <span className="max-sm:hidden">Analyzing…</span>
            </>
          ) : (
            <>
              Mix<span className="max-sm:hidden">&nbsp;Now</span>
            </>
          )}
        </button>
        <select
          value={djMode}
          onChange={(e) => setDjMode(e.target.value as DjSetMode)}
          title="DJ set mode — biases which transition techniques get chosen"
          className="hidden xl:block bg-surface shadow-elevate-sm rounded-full text-xs text-muted px-2 py-1.5 outline-none"
        >
          {DJ_MODES.map((m) => (
            <option key={m.id} value={m.id} title={m.title}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={styleGenreHint ?? "auto"}
          onChange={(e) => setStyleGenreHint(e.target.value === "auto" ? null : e.target.value)}
          title="Style influence for chosen transitions"
          className="hidden xl:block bg-surface shadow-elevate-sm rounded-full text-xs text-muted px-2 py-1.5 outline-none"
        >
          <option value="auto">Style: Auto</option>
          {genreFamilies.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          value={crossfadeOverrideSec ?? "auto"}
          onChange={(e) =>
            setCrossfadeOverride(
              e.target.value === "auto" ? null : Number(e.target.value)
            )
          }
          title="Crossfade length"
          className="hidden xl:block bg-surface shadow-elevate-sm rounded-full text-xs text-muted px-2 py-1.5 outline-none"
        >
          <option value="auto">Auto</option>
          {CROSSFADE_PRESETS.map((sec) => (
            <option key={sec} value={sec}>
              {sec}s
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setAutoDj(!autoDjEnabled)}
          data-active={autoDjEnabled}
          className="btn-outline"
          title="Toggle automatic DJ transitions"
        >
          Auto-DJ<span className="max-sm:hidden">&nbsp;{autoDjEnabled ? "On" : "Off"}</span>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="hidden md:block w-20 accent-accent-purple"
        />
      </div>
    </footer>
  );
}
