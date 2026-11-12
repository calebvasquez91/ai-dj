"use client";

import { useStore } from "@/lib/store";
import {
  describeSongSyncBpmRow,
  describeSongSyncKeyRow,
  type SongSyncPhase,
  type SongSyncStatus,
} from "@/lib/songSync";

/**
 * Song Sync Mode on the DJ board: the SYNC button, the Auto switch, and a live readout of the morph (lib/songSync.ts,
 * run by DualDeckStage). The panel only mirrors the real morph through store.songSync; the one thing it drives is the
 * request counter behind the SYNC button.
 *
 * Button: SYNC (idle) -> ANALYZING... (the sync report is being built and the AI DJ confirms the plan) -> MORPHING
 * (with a progress bar by bar) -> LOCKED (the playing track now matches the next one's tempo and key, and the
 * crossfade runs). Auto: when on, every automatic transition is the morph; when off the ordinary transitions run and
 * SYNC only acts when pressed.
 */

type ButtonState = "off" | "analyzing" | "morphing" | "locked";

function buttonState(status: SongSyncStatus | null): ButtonState {
  if (!status) return "off";
  switch (status.phase) {
    case "analyzing":
      return "analyzing";
    case "morphing":
    case "aligning":
      return "morphing";
    default:
      return "locked";
  }
}

const PHASE_STEPS: { id: SongSyncPhase[]; label: string }[] = [
  { id: ["aligning"], label: "Aligning…" },
  { id: ["locked"], label: "LOCKED" },
  { id: ["crossfading"], label: "CROSSFADING" },
  { id: ["done"], label: "DONE" },
];

export function SongSyncPanel() {
  const status = useStore((s) => s.songSync);
  const auto = useStore((s) => s.songSyncAuto);
  const setAuto = useStore((s) => s.setSongSyncAuto);
  const requestSongSync = useStore((s) => s.requestSongSync);
  const hasNext = useStore((s) => s.queue.length > 0);
  const hasTrack = useStore((s) => s.currentTrack != null);

  const state = buttonState(status);
  const morphing = state === "morphing";
  const busy = state !== "off";
  const morphDone = status != null && (status.phase === "aligning" || status.phase === "locked" || status.phase === "crossfading" || status.phase === "done");
  const filledBars = status == null ? 0 : morphDone ? status.morphBars : Math.max(0, status.bar - 1);
  const pitchMoves = status != null && status.pitchTarget !== 0;

  const buttonClass =
    state === "analyzing"
      ? "bg-accent-yellow/25 text-accent-yellow animate-pulse"
      : state === "morphing"
        ? "bg-accent-purple text-white"
        : state === "locked"
          ? "bg-emerald-500 text-white"
          : "bg-surface text-muted opacity-70 hover:opacity-100";
  const label = state === "analyzing" ? "ANALYZING..." : state === "morphing" ? "MORPHING" : state === "locked" ? "LOCKED ✓" : "SYNC";

  return (
    <section
      aria-label="Song Sync"
      className="rounded-xl bg-surface-hover px-3 py-2 flex flex-col gap-2"
      data-testid="song-sync-panel"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={requestSongSync}
          disabled={busy || !hasTrack || !hasNext}
          data-testid="song-sync-button"
          data-phase={status?.phase ?? "off"}
          title={
            busy
              ? "Morphing the playing track onto the next one's tempo and key"
              : "Morph the playing track onto the next one's tempo and key, then crossfade"
          }
          className={`rounded-full px-4 py-1.5 text-xs font-bold tracking-wide shadow-elevate-sm transition-colors disabled:cursor-not-allowed ${buttonClass}`}
        >
          {label}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer" title="On: every automatic transition is the morph, started at the right musical moment. Off: the ordinary transitions run, and SYNC only acts when pressed.">
          <input
            type="checkbox"
            role="switch"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
            data-testid="song-sync-auto"
            className="accent-accent-purple"
          />
          Auto
        </label>
        {status == null && (
          <span className="text-[11px] text-muted">
            {auto ? "Every automatic mix is a tempo and key morph." : "Auto is off: ordinary transitions run."}
          </span>
        )}
      </div>

      {status && (
        <div className="flex flex-col gap-1.5 text-xs" data-testid="song-sync-readout" data-phase={status.phase}>
          <p className="font-semibold text-foreground" data-testid="song-sync-headline">
            {status.headline}
          </p>
          <p className="text-muted" data-testid="song-sync-plan">
            {status.planLine}
          </p>

          <div className="flex flex-col gap-0.5" data-testid="song-sync-bpm-row" data-bar={status.bar} data-bpm-now={status.bpmNow.toFixed(2)}>
            <div className="flex items-center justify-between tabular-nums text-muted">
              <span>{status.bpmFrom.toFixed(2)}</span>
              <span>{status.bpmTo.toFixed(2)}</span>
            </div>
            <ProgressSegments filled={filledBars} total={status.morphBars} active={morphing} />
            <p className="text-muted">{describeSongSyncBpmRow(status)}</p>
          </div>

          {pitchMoves && (
            <div className="flex flex-col gap-0.5" data-testid="song-sync-key-row" data-pitch-now={status.pitchNow.toFixed(2)}>
              <div className="flex items-center justify-between text-muted">
                <span>{status.keyFrom}</span>
                <span>{status.keyTo}</span>
              </div>
              <ProgressSegments filled={filledBars} total={status.morphBars} active={morphing} />
              <p className="text-muted">{describeSongSyncKeyRow(status)}</p>
            </div>
          )}

          {morphDone && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="song-sync-phase-row" data-phase={status.phase}>
              {PHASE_STEPS.map((step, i) => {
                const reached = PHASE_STEPS.findIndex((p) => p.id.includes(status.phase)) >= i;
                const current = step.id.includes(status.phase);
                return (
                  <span key={step.label} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-muted">{"→"}</span>}
                    <span className={`flex items-center gap-1 ${current ? "font-semibold text-foreground" : reached ? "text-muted" : "text-muted/50"}`}>
                      <span aria-hidden="true">{reached ? "●" : "○"}</span>
                      {step.label}
                    </span>
                  </span>
                );
              })}
              {status.phaseErrorMs != null && (
                <span className="ml-auto text-[11px] text-muted tabular-nums" data-testid="song-sync-phase-error">
                  {Math.round(status.phaseErrorMs)} ms off
                </span>
              )}
            </div>
          )}

          {status.listenerNote && (
            <p className="text-accent-purple" data-testid="song-sync-note">
              {"🤖"} {status.listenerNote}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** One segment per bar of the morph, filled as the bars go by. */
function ProgressSegments({ filled, total, active }: { filled: number; total: number; active: boolean }) {
  return (
    <div className="flex gap-0.5" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={filled}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-sm ${i < filled ? (active ? "bg-accent-purple" : "bg-emerald-500") : "bg-border/50"}`}
        />
      ))}
    </div>
  );
}
