"use client";

import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { DualDeckStage } from "@/components/DualDeckStage";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import { genreFamilies } from "@/data/styles";

const CROSSFADE_PRESETS = [5, 10, 15, 20, 30];

export function PlayerBar() {
  const currentTrack = useStore((s) => s.currentTrack);
  const isPlaying = useStore((s) => s.isPlaying);
  const togglePlay = useStore((s) => s.togglePlay);
  const volume = useStore((s) => s.volume);
  const setVolume = useStore((s) => s.setVolume);
  const autoDjEnabled = useStore((s) => s.autoDjEnabled);
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
  const styleGenreHint = useStore((s) => s.styleGenreHint);
  const setStyleGenreHint = useStore((s) => s.setStyleGenreHint);
  const analyzingTrackIds = useStore((s) => s.analyzingTrackIds);
  const nextTrackAnalyzing = queue[0] ? analyzingTrackIds.has(queue[0].id) : false;

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
    <footer className="h-20 shrink-0 border-t-2 border-border bg-surface px-4 flex items-center gap-4">
      <div className="flex items-center gap-3 w-48 sm:w-64 min-w-0 shrink-0">
        {currentTrack ? (
          <>
            <DualDeckStage />
            <TrackThumbnail
              thumbnailUrl={currentTrack.thumbnailUrl}
              title={currentTrack.title}
              size={48}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{currentTrack.title}</p>
              <p className="text-xs text-muted truncate">{currentTrack.artist}</p>
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
            className="text-accent-purple hover:text-accent-pink disabled:opacity-40 disabled:text-muted"
            title="Previous (←)"
          >
            ⏮
          </button>
          <button
            type="button"
            onClick={togglePlay}
            disabled={!currentTrack}
            className="w-9 h-9 rounded-full bg-gradient-to-br from-accent-teal to-accent-purple text-white border-2 border-border flex items-center justify-center disabled:opacity-40 shadow-[2px_2px_0_var(--border)]"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!currentTrack}
            className="text-accent-purple hover:text-accent-pink disabled:opacity-40 disabled:text-muted"
            title="Next (→)"
          >
            ⏭
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
                className="flex-1 h-1.5 rounded-full bg-background overflow-hidden cursor-pointer border border-border"
                onClick={handleSeekClick}
              >
                <div
                  className="h-full bg-gradient-to-r from-accent-teal via-accent-purple to-accent-pink"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span>{formatTime(durationSec)}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 justify-end shrink-0">
        <button
          type="button"
          onClick={toggleDeckView}
          disabled={!currentTrack}
          className="text-accent-purple hover:text-accent-pink disabled:opacity-40 disabled:text-muted px-1"
          title="Show the DJ decks — tempo, key, and what's lined up next"
        >
          🎛
        </button>
        <button
          type="button"
          onClick={toggleQueuePanel}
          className="relative text-accent-purple hover:text-accent-pink px-1"
          title="Queue (Q)"
        >
          ☰
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
          className="btn-retro-outline"
          title={
            nextTrackAnalyzing
              ? "Analyzing next track's beat/tempo…"
              : "Beatmatch and mix into the next queued track now (M)"
          }
        >
          {isTransitioning ? "Mixing…" : nextTrackAnalyzing ? "Analyzing…" : "Mix Now"}
        </button>
        <select
          value={styleGenreHint ?? "auto"}
          onChange={(e) => setStyleGenreHint(e.target.value === "auto" ? null : e.target.value)}
          title="Style influence for chosen transitions"
          className="hidden sm:block bg-surface border-2 border-border rounded-full text-xs text-muted px-2 py-1.5 outline-none"
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
          className="hidden sm:block bg-surface border-2 border-border rounded-full text-xs text-muted px-2 py-1.5 outline-none"
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
          className="btn-retro-outline"
          title="Toggle automatic DJ transitions"
        >
          Auto-DJ {autoDjEnabled ? "On" : "Off"}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="hidden sm:block w-20 accent-accent-purple"
        />
      </div>
    </footer>
  );
}
