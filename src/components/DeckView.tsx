"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { camelotCompatibility, planTransition, type DjSetMode } from "@/lib/mix-engine";
import { fallbackAnalysis, type TrackAnalysis } from "@/lib/audio-analysis";
import { useDjWeights } from "@/lib/dj-weights";
import { useTapTempo } from "@/lib/tapTempo";
import { submitYoutubeTapTempo } from "@/lib/youtubeBpm";
import { computeAutoHotCues, mergeHotCues, HOT_CUE_LABELS, type HotCueSlot } from "@/lib/hot-cues";
import { formatTime } from "@/lib/format";
import { BEAT_JUMP_COUNT } from "@/lib/beat-grid";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import { JogWheel } from "@/components/JogWheel";
import { transitions } from "@/data/transitions";
import { genreFamilies } from "@/data/styles";
import { CROSSFADE_PRESETS, DJ_MODES } from "@/components/PlayerBar";
import { CloseIcon } from "@/components/Icons";
import type { AmbienceFrequency } from "@/lib/ambience";
import { HalloweenLayers } from "@/components/HalloweenLayers";
import { EnergyGraph } from "@/components/EnergyGraph";
import { resampleBuckets } from "@/lib/resample";
import type { Track, DeckId } from "@/types/music";

const PICKABLE_TRANSITIONS = transitions.filter((t) => t.executable);

const AMBIENCE_FREQUENCIES: { id: AmbienceFrequency; label: string }[] = [
  { id: "occasional", label: "Occasional" },
  { id: "frequent", label: "Frequent" },
];

// Mirrors mix-engine's own key-confidence gate for scoring — a key label
// below this confidence is more likely noise than signal, so don't surface
// it as if the DJ "knows" the key.
const MIN_KEY_CONFIDENCE_FOR_DISPLAY = 0.15;

function Waveform({
  peaks,
  progressRatio,
  markerRatio,
  spooky = false,
}: {
  peaks: number[];
  progressRatio?: number;
  markerRatio?: number;
  /** Halloween waveform theme (spec #10) — true while the Spooky Music playlist is active (store.activePlaylistTheme === "spooky"). */
  spooky?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // How many bars physically fit: each needs ≥1px plus a 1px gap, so a
  // fixed ~240-peak waveform overflowed (and clipped its right end) in any
  // card narrower than ~250px. Resample down to what fits instead.
  const [fitCount, setFitCount] = useState<number | null>(null);
  const hasPeaks = peaks.length > 0;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setFitCount(Math.max(24, Math.floor((el.clientWidth - 8) / 2))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPeaks]);
  const bars = useMemo(() => {
    if (!fitCount || fitCount >= peaks.length) return peaks;
    return resampleBuckets(peaks, fitCount, "max");
  }, [peaks, fitCount]);

  if (peaks.length === 0) {
    return (
      <div className="h-12 rounded-md bg-surface-hover flex items-center justify-center text-[10px] text-muted">
        Analyzing…
      </div>
    );
  }
  return (
    <div ref={containerRef} className="relative h-12 flex items-center gap-px overflow-hidden rounded-md bg-surface-hover px-1">
      {bars.map((p, i) => {
        const barProgress = i / Math.max(1, bars.length - 1);
        const played = progressRatio != null && barProgress <= progressRatio;
        return (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-colors duration-1000 ${
              played
                ? spooky
                  ? "spooky-bar-played"
                  : "bg-gradient-to-t from-accent-teal to-accent-purple"
                : spooky
                  ? "spooky-bar-unplayed"
                  : "bg-border/40"
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
  deckId,
  track,
  analysis,
  progressRatio,
  markerRatio,
  hotCues,
  currentTimeSec,
}: {
  label: string;
  /** Which physical deck (A/B) this card corresponds to — drives the real, read-only jog wheel (see JogWheel.tsx/DualDeckStage.tsx); "Cued Next" only actually starts spinning once a transition loads it onto that deck. */
  deckId: DeckId;
  track: Track | null;
  analysis: TrackAnalysis | undefined;
  progressRatio?: number;
  markerRatio?: number;
  /** Only supplied for the Now Playing card — jumping playback to a cue only makes sense for the track that's actually live. */
  hotCues?: HotCueSlot[];
  currentTimeSec?: number;
}) {
  const spooky = useStore((s) => s.activePlaylistTheme === "spooky");

  if (!track) {
    return (
      <div className="card p-3 flex flex-col gap-2 flex-1 min-w-0">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">{label}</p>
        <p className="text-sm text-muted">Nothing here yet.</p>
      </div>
    );
  }
  const camelot =
    analysis && analysis.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_DISPLAY ? analysis.camelotKey : null;
  return (
    <div className="card p-3 flex flex-col gap-2 flex-1 min-w-0">
      <p className="text-xs font-semibold text-accent-purple uppercase tracking-wide">{label}</p>
      <div className="flex items-center gap-3 min-w-0">
        <JogWheel deckId={deckId} />
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <TrackThumbnail thumbnailUrl={track.thumbnailUrl} title={track.title} size={36} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{track.title}</p>
            <p className="text-xs text-muted truncate">{track.artist}</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="rounded-full border border-border px-2 py-0.5 font-mono">
          {analysis && !analysis.fallback
            ? `${Math.round(analysis.bpm)} BPM${track.source === "youtube" && track.bpmSource === "metadata" ? " (est.)" : ""}`
            : track.source === "youtube"
              ? "No BPM yet"
              : "Analyzing…"}
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
      {track.source === "youtube" && <TapTempoControl key={track.id} trackId={track.id} />}
      <EnergyGraph peaks={analysis?.waveformPeaks ?? []} progressRatio={progressRatio} />
      <Waveform peaks={analysis?.waveformPeaks ?? []} progressRatio={progressRatio} markerRatio={markerRatio} spooky={spooky} />
      {hotCues && currentTimeSec != null && (
        <HotCuePads trackId={track.id} slots={hotCues} currentTimeSec={currentTimeSec} />
      )}
      {hotCues && currentTimeSec != null && track.source === "local" && <LiveDeckControls />}
    </div>
  );
}

/**
 * Real-time CDJ-style manual controls for whatever's actually playing —
 * distinct from the read-only Mixer panel (never a slider/drag control) and
 * from Hot Cues (which are per-track, persisted positions): these fire an
 * instant, one-shot action on the live deck, same request-counter pattern
 * as the existing Mix Now button (see requestMixNow/mixNowRequestId).
 * Local-track only — beat jump/backspin manipulate DualDeckStage's own
 * <audio> element, which YouTubeDeckStage owns instead for a YouTube track.
 */
function LiveDeckControls() {
  const requestBeatJump = useStore((s) => s.requestBeatJump);
  const requestBackspin = useStore((s) => s.requestBackspin);
  const requestReverse = useStore((s) => s.requestReverse);
  const requestLoopIn = useStore((s) => s.requestLoopIn);
  const requestLoopOut = useStore((s) => s.requestLoopOut);
  const requestLoopExit = useStore((s) => s.requestLoopExit);
  const manualLoopActive = useStore((s) => s.manualLoopActive);
  const manualLoopInSec = useStore((s) => s.manualLoopInSec);
  const manualLoopOutSec = useStore((s) => s.manualLoopOutSec);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => requestBeatJump(-1)}
        className="btn-outline !px-2 !py-1 text-xs"
        title={`Beat Jump back ${BEAT_JUMP_COUNT} beats — instant, no restart`}
      >
        ⏪ {BEAT_JUMP_COUNT}
      </button>
      <button
        type="button"
        onClick={() => requestBeatJump(1)}
        className="btn-outline !px-2 !py-1 text-xs"
        title={`Beat Jump forward ${BEAT_JUMP_COUNT} beats — instant, no restart`}
      >
        {BEAT_JUMP_COUNT} ⏩
      </button>
      <button
        type="button"
        onClick={() => requestBackspin()}
        className="btn-outline !px-2 !py-1 text-xs"
        title="Vinyl Brake Stop — decelerates to a stop and spins back up, same technique the ambience system uses opportunistically"
      >
        🛑 Brake Stop
      </button>
      <button
        type="button"
        onClick={() => requestReverse()}
        className="btn-outline !px-2 !py-1 text-xs"
        title="Reverse Playback — plays the last couple of seconds backwards, then hands back to normal playback at the same spot"
      >
        ◀◀ Reverse
      </button>
      <button
        type="button"
        onClick={() => requestLoopIn()}
        disabled={manualLoopActive}
        className="btn-outline !px-2 !py-1 text-xs"
        title="Loop In — marks the current position as the loop's start"
      >
        Loop In
      </button>
      <button
        type="button"
        onClick={() => requestLoopOut()}
        disabled={manualLoopActive || manualLoopInSec == null}
        className="btn-outline !px-2 !py-1 text-xs"
        title="Loop Out — marks the current position as the loop's end and starts it looping indefinitely"
      >
        Loop Out
      </button>
      <button
        type="button"
        onClick={() => requestLoopExit()}
        disabled={!manualLoopActive}
        className={`btn-outline !px-2 !py-1 text-xs ${manualLoopActive ? "bg-accent-purple/15 text-accent-purple" : ""}`}
        title="Exit Loop — releases the active loop and continues playing forward normally"
      >
        {manualLoopActive
          ? `Looping ${formatTime(manualLoopInSec ?? 0)}–${formatTime(manualLoopOutSec ?? 0)}`
          : "Exit Loop"}
      </button>
    </div>
  );
}

/**
 * 8 fixed-role Hot Cue pads — same structural meaning on every track (see
 * lib/hot-cues.ts), so they compose across decks: cue-in on Cue 1, line up
 * an outro on Cue 7, a drop-swap at Cue 3/4, jump straight to Cue 5 to
 * shorten a track, etc. A placed pad jumps playback there; an unset one
 * (or the small re-set corner button on a placed one) captures the
 * current position instead — auto placement is always just a starting
 * point, never the only option.
 */
function HotCuePads({
  trackId,
  slots,
  currentTimeSec,
}: {
  trackId: string;
  slots: HotCueSlot[];
  currentTimeSec: number;
}) {
  const requestSeek = useStore((s) => s.requestSeek);
  const setHotCueOverride = useStore((s) => s.setHotCueOverride);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">Hot Cues</p>
      <div className="grid grid-cols-4 gap-1.5">
        {slots.map((slot, i) => (
          <div key={i} className="relative group">
            <button
              type="button"
              onClick={() => (slot.atSec != null ? requestSeek(slot.atSec) : setHotCueOverride(trackId, i + 1, currentTimeSec))}
              data-active={slot.atSec != null}
              className="btn-outline w-full !flex-col !gap-0.5 !px-1 !py-1.5"
              title={
                slot.atSec != null
                  ? `Jump to ${HOT_CUE_LABELS[i]} (${formatTime(slot.atSec)})${
                      slot.source === "auto" ? " — auto-detected, best effort" : ""
                    }`
                  : `Tap to set ${HOT_CUE_LABELS[i]} at the current playback position`
              }
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide">{HOT_CUE_LABELS[i]}</span>
              <span className="text-[10px] font-mono">{slot.atSec != null ? formatTime(slot.atSec) : "Tap to set"}</span>
            </button>
            {slot.atSec != null && (
              <button
                type="button"
                onClick={() => setHotCueOverride(trackId, i + 1, currentTimeSec)}
                className="btn-icon absolute -top-2 -right-2 !p-0.5 text-[9px] leading-none bg-surface shadow-elevate-sm opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                title="Re-set to the current playback position"
              >
                ↺
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted">
        Cues 1/2/7/8 are beat-grid math and should always land somewhere reasonable. Cues 3-6 are best-effort
        build/drop detection — it works best on house/EDM-shaped tracks and won&apos;t always find a second (or
        even first) build/drop. Tap any pad to set or move it by hand.
      </p>
    </div>
  );
}

/**
 * Manual tap-tempo — the fallback/override for a YouTube track's bpm when
 * there's no metadata match (lib/youtubeBpm.ts) or the match is wrong.
 * Keyed by track id from DeckCard so switching tracks always starts a
 * fresh reading instead of carrying over stale taps.
 */
function TapTempoControl({ trackId }: { trackId: string }) {
  const { bpm, canCommit, tap, reset } = useTapTempo();
  const [justSaved, setJustSaved] = useState(false);

  function handleCommit() {
    if (bpm == null) return;
    submitYoutubeTapTempo(trackId, bpm);
    reset();
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <button
        type="button"
        onClick={tap}
        className="btn-outline !px-2 !py-0.5"
        title="Tap along with the beat a few times to set (or correct) this track's tempo by hand"
      >
        👆 Tap{bpm != null ? ` (${bpm})` : ""}
      </button>
      {canCommit && (
        <button
          type="button"
          onClick={handleCommit}
          className="text-accent-teal font-semibold"
          title="Save this tempo"
        >
          {justSaved ? "Saved ✓" : "Set"}
        </button>
      )}
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
  const activeDeckId = useStore((s) => s.activeDeckId);
  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const trackAnalysis = useStore((s) => s.trackAnalysis);
  const currentTimeSec = useStore((s) => s.currentTimeSec);
  const styleGenreHint = useStore((s) => s.styleGenreHint);
  const setStyleGenreHint = useStore((s) => s.setStyleGenreHint);
  const crossfadeOverrideSec = useStore((s) => s.crossfadeOverrideSec);
  const setCrossfadeOverride = useStore((s) => s.setCrossfadeOverride);
  const isTransitioning = useStore((s) => s.isTransitioning);
  const activeTransitionRationale = useStore((s) => s.activeTransitionRationale);
  const djMode = useStore((s) => s.djMode);
  const setDjMode = useStore((s) => s.setDjMode);
  const forcedTransitionId = useStore((s) => s.forcedTransitionId);
  const setForcedTransitionId = useStore((s) => s.setForcedTransitionId);
  const rerolledTransitionIds = useStore((s) => s.rerolledTransitionIds);
  const addRerolledTransitionId = useStore((s) => s.addRerolledTransitionId);
  const djVarietyBias = useStore((s) => s.djVarietyBias);
  const setDjVarietyBias = useStore((s) => s.setDjVarietyBias);
  const ambienceEnabled = useStore((s) => s.ambienceEnabled);
  const setAmbienceEnabled = useStore((s) => s.setAmbienceEnabled);
  const ambienceFrequency = useStore((s) => s.ambienceFrequency);
  const setAmbienceFrequency = useStore((s) => s.setAmbienceFrequency);
  const mashupEnabled = useStore((s) => s.mashupEnabled);
  const setMashupEnabled = useStore((s) => s.setMashupEnabled);
  const quantizeEnabled = useStore((s) => s.quantizeEnabled);
  const setQuantizeEnabled = useStore((s) => s.setQuantizeEnabled);
  const categoryWeights = useDjWeights((s) => s.categoryWeights);

  const nextTrack = queue[0] ?? null;
  const currentAnalysis = currentTrack ? trackAnalysis[currentTrack.id] : undefined;
  const nextAnalysis = nextTrack ? trackAnalysis[nextTrack.id] : undefined;

  // Hot Cues: never auto-detected for a YouTube track (no waveform to run
  // the detector on — every cue there comes from hotCueOverrides alone).
  const autoHotCues = useMemo(() => {
    if (!currentTrack || currentTrack.source !== "local" || !currentAnalysis) return new Array(8).fill(null);
    return computeAutoHotCues(currentAnalysis, currentTrack.durationSec);
  }, [currentTrack, currentAnalysis]);
  const hotCueSlots = useMemo(
    () => mergeHotCues(autoHotCues, currentTrack?.hotCueOverrides),
    [autoHotCues, currentTrack?.hotCueOverrides]
  );

  const preview = useMemo(() => {
    if (!currentTrack || !nextTrack) return null;
    return planTransition({
      current: { track: currentTrack, analysis: currentAnalysis ?? fallbackAnalysis() },
      next: { track: nextTrack, analysis: nextAnalysis ?? fallbackAnalysis() },
      genreHint: styleGenreHint,
      overrideSec: crossfadeOverrideSec,
      currentElapsedSec: currentTimeSec,
      djMode,
      forceTransitionId: forcedTransitionId,
      excludeTransitionIds: rerolledTransitionIds,
      varietyBias: djVarietyBias,
      categoryWeights,
      quantize: quantizeEnabled,
    });
  }, [
    currentTrack,
    nextTrack,
    currentAnalysis,
    nextAnalysis,
    styleGenreHint,
    crossfadeOverrideSec,
    currentTimeSec,
    djMode,
    forcedTransitionId,
    rerolledTransitionIds,
    djVarietyBias,
    categoryWeights,
    quantizeEnabled,
  ]);

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
      {/* max-h is "everything above the player bar, minus a margin" (bottom-32 /
          md:bottom-24 + 1rem top), not a flat 70vh — 70vh + the bottom offset
          overshoots short screens and pushes the title bar off the top. */}
      <div className="fixed inset-x-4 bottom-32 md:bottom-24 z-50 mx-auto max-w-3xl max-h-[calc(100dvh-9rem)] md:max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain rounded-2xl bg-surface/95 backdrop-blur-xl p-4 flex flex-col gap-3 shadow-elevate-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm heading">DJ Decks</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label
              className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
              title="Take more chances on bold transitions instead of defaulting to a safe cut when tempo is uncertain"
            >
              <input
                type="checkbox"
                checked={djVarietyBias}
                onChange={(e) => setDjVarietyBias(e.target.checked)}
                className="accent-accent-purple"
              />
              Favor variety
            </label>
            <label
              className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
              title="Occasional mid-track FX (a filter/riser build, an echo throw on a breakdown) — separate from transition FX, which always play"
            >
              <input
                type="checkbox"
                checked={ambienceEnabled}
                onChange={(e) => setAmbienceEnabled(e.target.checked)}
                className="accent-accent-purple"
              />
              Ambience
            </label>
            {ambienceEnabled && (
              <select
                value={ambienceFrequency}
                onChange={(e) => setAmbienceFrequency(e.target.value as AmbienceFrequency)}
                title="How often mid-track ambience FX can fire"
                className="bg-surface shadow-elevate-sm rounded-full text-xs text-muted px-2 py-1 outline-none"
              >
                {AMBIENCE_FREQUENCIES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}
            <label
              className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
              title="Opportunistic tempo/key-matched dual-track mashup moments — a rarer, bigger highlight than a normal transition, only for pairs that are genuinely close in tempo and key"
            >
              <input
                type="checkbox"
                checked={mashupEnabled}
                onChange={(e) => setMashupEnabled(e.target.checked)}
                className="accent-accent-purple"
              />
              Mashups
            </label>
            <label
              className="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
              title="Snap transitions, mashups, and loops to the beat grid — a real CDJ-style setting, on by default. Turn off for raw, unsnapped timing."
            >
              <input
                type="checkbox"
                checked={quantizeEnabled}
                onChange={(e) => setQuantizeEnabled(e.target.checked)}
                className="accent-accent-purple"
              />
              Quantize
            </label>
            <button
              type="button"
              onClick={toggle}
              className="btn-icon text-accent-purple hover:text-accent-pink"
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <HalloweenLayers />

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={djMode}
            onChange={(e) => setDjMode(e.target.value as DjSetMode)}
            title="DJ set mode — biases which transition techniques get chosen"
            className="bg-surface shadow-elevate-sm rounded-full text-xs text-muted px-2 py-1.5 outline-none"
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
            className="bg-surface shadow-elevate-sm rounded-full text-xs text-muted px-2 py-1.5 outline-none"
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
            onChange={(e) => setCrossfadeOverride(e.target.value === "auto" ? null : Number(e.target.value))}
            title="Crossfade length"
            className="bg-surface shadow-elevate-sm rounded-full text-xs text-muted px-2 py-1.5 outline-none"
          >
            <option value="auto">Crossfade: Auto</option>
            {CROSSFADE_PRESETS.map((sec) => (
              <option key={sec} value={sec}>
                {sec}s
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <DeckCard
            label="Now Playing"
            deckId={activeDeckId}
            track={currentTrack}
            analysis={currentAnalysis}
            progressRatio={progressRatio}
            hotCues={hotCueSlots}
            currentTimeSec={currentTimeSec}
          />
          <DeckCard
            label="Cued Next"
            deckId={activeDeckId === "A" ? "B" : "A"}
            track={nextTrack}
            analysis={nextAnalysis}
            markerRatio={markerRatio}
          />
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
            <p className="text-xs text-muted">
              {isTransitioning && activeTransitionRationale ? activeTransitionRationale : preview.rationale}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1.5 mt-0.5 border-t border-border/60">
              <select
                value={forcedTransitionId ?? ""}
                onChange={(e) => setForcedTransitionId(e.target.value || null)}
                title="Pick a specific transition for the upcoming mix, or let Auto-DJ choose"
                className="bg-surface shadow-elevate-sm rounded-full text-xs text-muted px-2 py-1 outline-none max-w-[55%]"
              >
                <option value="">Auto-DJ chooses</option>
                {PICKABLE_TRANSITIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => addRerolledTransitionId(preview.transitionId)}
                disabled={Boolean(forcedTransitionId)}
                className="btn-outline disabled:opacity-40 disabled:cursor-not-allowed"
                title="Try a different transition for the upcoming mix"
              >
                🎲 Try another
              </button>
            </div>
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
