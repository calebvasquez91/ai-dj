"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { camelotCompatibility, planTransition } from "@/lib/mix-engine";
import { fallbackAnalysis, type TrackAnalysis } from "@/lib/audio-analysis";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import type { Track } from "@/types/music";

// Mirrors mix-engine's own key-confidence gate for scoring — a key label
// below this confidence is more likely noise than signal, so don't surface
// it as if the DJ "knows" the key.
const MIN_KEY_CONFIDENCE_FOR_DISPLAY = 0.15;

function Waveform({
  peaks,
  progressRatio,
  markerRatio,
}: {
  peaks: number[];
  progressRatio?: number;
  markerRatio?: number;
}) {
  if (peaks.length === 0) {
    return (
      <div className="h-12 rounded-md bg-surface-hover flex items-center justify-center text-[10px] text-muted">
        Analyzing…
      </div>
    );
  }
  return (
    <div className="relative h-12 flex items-center gap-px overflow-hidden rounded-md bg-surface-hover px-1">
      {peaks.map((p, i) => {
        const barProgress = i / Math.max(1, peaks.length - 1);
        const played = progressRatio != null && barProgress <= progressRatio;
        return (
          <div
            key={i}
            className={`flex-1 rounded-sm ${
              played ? "bg-gradient-to-t from-accent-teal to-accent-purple" : "bg-border/40"
            }`}
            style={{ height: `${Math.max(8, p * 100)}%` }}
          />
        );
      })}
      {progressRatio != null && (
        <div
          className="absolute top-0 bottom-0 w-px bg-accent-pink"
          style={{ left: `${progressRatio * 100}%` }}
        />
      )}
      {markerRatio != null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-accent-yellow"
          style={{ left: `${Math.max(0, Math.min(100, markerRatio * 100))}%` }}
          title="Where the mix will enter this track"
        />
      )}
    </div>
  );
}

function DeckCard({
  label,
  track,
  analysis,
  progressRatio,
  markerRatio,
}: {
  label: string;
  track: Track | null;
  analysis: TrackAnalysis | undefined;
  progressRatio?: number;
  markerRatio?: number;
}) {
  if (!track) {
    return (
      <div className="card-retro p-3 flex flex-col gap-2 flex-1 min-w-0">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">{label}</p>
        <p className="text-sm text-muted">Nothing here yet.</p>
      </div>
    );
  }
  const camelot =
    analysis && analysis.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_DISPLAY ? analysis.camelotKey : null;
  return (
    <div className="card-retro p-3 flex flex-col gap-2 flex-1 min-w-0">
      <p className="text-xs font-semibold text-accent-purple uppercase tracking-wide">{label}</p>
      <div className="flex items-center gap-2 min-w-0">
        <TrackThumbnail thumbnailUrl={track.thumbnailUrl} title={track.title} size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{track.title}</p>
          <p className="text-xs text-muted truncate">{track.artist}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="rounded-full border border-border px-2 py-0.5 font-mono">
          {analysis && !analysis.fallback ? `${Math.round(analysis.bpm)} BPM` : "Analyzing…"}
        </span>
        {camelot && (
          <span
            className="rounded-full border border-border px-2 py-0.5 font-mono text-accent-teal"
            title={analysis?.key ?? undefined}
          >
            {camelot}
          </span>
        )}
      </div>
      <Waveform peaks={analysis?.waveformPeaks ?? []} progressRatio={progressRatio} markerRatio={markerRatio} />
    </div>
  );
}

/**
 * A Serato-style readout of what the Auto-DJ actually knows and is about to
 * do: the currently playing track, the next one cued up, both tracks'
 * measured tempo/key, and a live preview of the transition that would run
 * between them right now (recomputed from the same planTransition() the
 * real mix engine uses — read-only here, purely for display).
 */
export function DeckView() {
  const open = useStore((s) => s.deckViewOpen);
  const toggle = useStore((s) => s.toggleDeckView);
  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const trackAnalysis = useStore((s) => s.trackAnalysis);
  const currentTimeSec = useStore((s) => s.currentTimeSec);
  const styleGenreHint = useStore((s) => s.styleGenreHint);
  const crossfadeOverrideSec = useStore((s) => s.crossfadeOverrideSec);
  const isTransitioning = useStore((s) => s.isTransitioning);
  const djMode = useStore((s) => s.djMode);

  const nextTrack = queue[0] ?? null;
  const currentAnalysis = currentTrack ? trackAnalysis[currentTrack.id] : undefined;
  const nextAnalysis = nextTrack ? trackAnalysis[nextTrack.id] : undefined;

  const preview = useMemo(() => {
    if (!currentTrack || !nextTrack) return null;
    return planTransition({
      current: { track: currentTrack, analysis: currentAnalysis ?? fallbackAnalysis() },
      next: { track: nextTrack, analysis: nextAnalysis ?? fallbackAnalysis() },
      genreHint: styleGenreHint,
      overrideSec: crossfadeOverrideSec,
      currentElapsedSec: currentTimeSec,
      djMode,
    });
  }, [currentTrack, nextTrack, currentAnalysis, nextAnalysis, styleGenreHint, crossfadeOverrideSec, currentTimeSec, djMode]);

  if (!open) return null;

  const progressRatio =
    currentTrack && currentTrack.durationSec > 0
      ? Math.min(1, currentTimeSec / currentTrack.durationSec)
      : undefined;
  const markerRatio =
    nextTrack && preview && nextTrack.durationSec > 0
      ? preview.incomingEntryOffsetSec / nextTrack.durationSec
      : undefined;

  const currentCamelot =
    currentAnalysis && currentAnalysis.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_DISPLAY
      ? currentAnalysis.camelotKey
      : null;
  const nextCamelot =
    nextAnalysis && nextAnalysis.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_DISPLAY
      ? nextAnalysis.camelotKey
      : null;
  const harmonicScore = currentCamelot && nextCamelot ? camelotCompatibility(currentCamelot, nextCamelot) : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={toggle} aria-hidden="true" />
      <div className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-3xl rounded-2xl border-2 border-border bg-surface p-4 flex flex-col gap-3 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm retro-heading">DJ Decks</h2>
          <button
            type="button"
            onClick={toggle}
            className="text-accent-purple hover:text-accent-pink text-lg leading-none px-1"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <DeckCard
            label="Now Playing"
            track={currentTrack}
            analysis={currentAnalysis}
            progressRatio={progressRatio}
          />
          <DeckCard label="Cued Next" track={nextTrack} analysis={nextAnalysis} markerRatio={markerRatio} />
        </div>

        {preview ? (
          <div className="rounded-xl border border-border bg-surface-hover p-3 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-semibold ${
                  preview.tempoSync ? "bg-accent-teal/20 text-accent-teal" : "bg-accent-pink/20 text-accent-pink"
                }`}
              >
                {preview.tempoSync ? "✓ Beatmatched" : "Tempo differs — will ramp or cut"}
              </span>
              {harmonicScore != null && (
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold ${
                    harmonicScore > 0 ? "bg-accent-teal/20 text-accent-teal" : "bg-muted/20 text-muted"
                  }`}
                >
                  {currentCamelot} ↔ {nextCamelot} ·{" "}
                  {harmonicScore >= 2 ? "same key" : harmonicScore === 1 ? "compatible" : "clashing keys"}
                </span>
              )}
              {isTransitioning && <span className="text-accent-pink font-semibold">Mixing now…</span>}
            </div>
            <p className="text-xs text-muted">{preview.rationale}</p>
          </div>
        ) : (
          <p className="text-xs text-muted">
            Queue another track so the DJ has something lined up to mix into.
          </p>
        )}
      </div>
    </>
  );
}
