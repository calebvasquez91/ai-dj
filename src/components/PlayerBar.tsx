"use client";

import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { DualDeckStage } from "@/components/DualDeckStage";
import { TrackThumbnail } from "@/components/TrackThumbnail";

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
    <footer className="h-20 shrink-0 border-t border-border bg-surface px-4 flex items-center gap-4">
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
            className="text-muted hover:text-foreground disabled:opacity-40"
            title="Previous (←)"
          >
            ⏮
          </button>
          <button
            type="button"
            onClick={togglePlay}
            disabled={!currentTrack}
            className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-40"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!currentTrack}
            className="text-muted hover:text-foreground disabled:opacity-40"
            title="Next (→)"
          >
            ⏭
          </button>
        </div>
        <div className="w-full flex items-center gap-2 text-xs text-muted">
          {isTransitioning && queue[0] ? (
            <span className="flex-1 text-center text-accent truncate">
              Mixing into &ldquo;{queue[0].title}&rdquo;
            </span>
          ) : (
            <>
              <span>{formatTime(currentTimeSec)}</span>
              <div
                className="flex-1 h-1 rounded-full bg-border overflow-hidden cursor-pointer"
                onClick={handleSeekClick}
              >
                <div
                  className="h-full bg-accent"
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
          onClick={toggleQueuePanel}
          className="relative text-muted hover:text-foreground px-1"
          title="Queue (Q)"
        >
          ☰
          {queue.length > 0 && (
            <span className="absolute -top-1 -right-1 text-[10px] leading-none bg-accent text-white rounded-full w-4 h-4 flex items-center justify-center">
              {queue.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={requestMixNow}
          disabled={!currentTrack || queue.length === 0 || isTransitioning}
          className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border text-muted hover:text-foreground disabled:opacity-30"
          title="Crossfade into the next queued track now (M)"
        >
          {isTransitioning ? "Mixing…" : "Mix Now"}
        </button>
        <select
          value={crossfadeOverrideSec ?? "auto"}
          onChange={(e) =>
            setCrossfadeOverride(
              e.target.value === "auto" ? null : Number(e.target.value)
            )
          }
          title="Crossfade length"
          className="hidden sm:block bg-transparent border border-border rounded-full text-xs text-muted px-2 py-1.5 outline-none"
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
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
            autoDjEnabled
              ? "bg-accent/20 border-accent text-accent"
              : "border-border text-muted hover:text-foreground"
          }`}
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
          className="hidden sm:block w-20 accent-accent"
        />
      </div>
    </footer>
  );
}
