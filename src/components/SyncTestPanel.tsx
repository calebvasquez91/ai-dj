"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import {
  PHASE_LOCK_MAX_MS,
  STAGE_LABELS,
  SYNC_TEST_PLAYLIST_NAME,
  summarize,
  type PairResult,
  type StageResult,
  type StageStatus,
} from "@/lib/syncTest";
import { cancelSyncTest, exportLog, fixIssuesAutomatically, startSyncTest } from "@/lib/syncTestRunner";
import { useSyncTestStore } from "@/lib/syncTestStore";

/**
 * The sync test suite on the DJ board (lib/syncTest.ts judges, lib/syncTestRunner.ts drives the real player): one
 * amber button that runs every consecutive pair of the "Same Beat" playlist plus the hardest tempo jump through five
 * stages, then a card per pair, a summary card, "Fix Issues Automatically" and "Export Log". It only reads the
 * playlist; while it runs it takes over playback.
 */

const STATUS_TEXT: Record<StageStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };
const STATUS_COLOR: Record<StageStatus, string> = {
  pass: "text-emerald-500",
  warn: "text-amber-500",
  fail: "text-red-500",
  skip: "text-muted",
};
const STATUS_ICON: Record<StageStatus, string> = { pass: "✓", warn: "!", fail: "✕", skip: "–" };

export function SyncTestPanel() {
  const s = useSyncTestStore();
  const hasPlaylist = useStore((st) => st.playlists.some((p) => p.name === SYNC_TEST_PLAYLIST_NAME));
  const [exportNote, setExportNote] = useState<string | null>(null);
  const running = s.phase === "running";
  const busy = running || s.fixing;
  const summary = s.pairs.length > 0 ? summarize(s.pairs) : null;
  const pct = s.stepsTotal > 0 ? Math.round((s.stepsDone / s.stepsTotal) * 100) : 0;

  const buttonLabel = running
    ? `🧪 Testing… ${s.stepsDone}/${s.stepsTotal}`
    : s.fixing
      ? "🧪 Fixing…"
      : s.phase === "done"
        ? `🧪 Run Sync Test Again — ${SYNC_TEST_PLAYLIST_NAME}`
        : s.phase === "failed"
          ? `🧪 Retry Sync Test — ${SYNC_TEST_PLAYLIST_NAME}`
          : `🧪 Run Sync Test — ${SYNC_TEST_PLAYLIST_NAME}`;

  async function onExport() {
    const how = await exportLog();
    setExportNote(how === "shared" ? "Shared." : "Saved to your downloads.");
    setTimeout(() => setExportNote(null), 4000);
  }

  return (
    <section aria-label="Sync test" className="flex flex-col gap-2" data-testid="sync-test-panel">
      <button
        type="button"
        onClick={() => void startSyncTest()}
        disabled={busy || !hasPlaylist}
        data-testid="sync-test-button"
        data-phase={s.phase}
        title={
          hasPlaylist
            ? "Plays every consecutive pair of the playlist through a real SYNC morph and checks it. Takes over playback; the playlist is only read."
            : `Needs a playlist called "${SYNC_TEST_PLAYLIST_NAME}".`
        }
        className={`w-full rounded-xl px-4 py-2.5 text-sm font-bold tracking-wide shadow-elevate-sm transition-colors disabled:cursor-not-allowed ${
          busy
            ? "bg-amber-500/30 text-amber-600 animate-pulse"
            : s.phase === "failed"
              ? "bg-red-500 text-white hover:bg-red-400"
              : "bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
        }`}
      >
        {buttonLabel}
      </button>

      {!hasPlaylist && s.phase === "idle" && (
        <p className="text-[11px] text-muted">Create a playlist named “{SYNC_TEST_PLAYLIST_NAME}” to enable the test.</p>
      )}

      {(running || s.fixing) && (
        <div className="flex flex-col gap-1.5" data-testid="sync-test-progress">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/50" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full bg-amber-500 transition-all" style={{ width: `${running ? pct : 100}%` }} />
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
            <span data-testid="sync-test-label">{s.label}</span>
            <button type="button" onClick={cancelSyncTest} className="underline hover:text-foreground">
              Stop
            </button>
          </div>
        </div>
      )}

      {s.phase === "failed" && s.error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500" data-testid="sync-test-error">
          {s.error}
        </p>
      )}

      {summary && (
        <>
          <div className="flex flex-col gap-2" data-testid="sync-test-results">
            {s.pairs.map((p) => (
              <PairCard key={`${p.index}-${p.fromId}-${p.toId}`} pair={p} />
            ))}
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-surface-hover px-3 py-2.5" data-testid="sync-test-summary" data-verdict={summary.verdict}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-foreground">
                {summary.passed}/{summary.total} pairs passed
                <span className={`ml-2 text-xs font-semibold ${STATUS_COLOR[summary.verdict]}`}>{STATUS_TEXT[summary.verdict]}</span>
              </p>
              <p className="text-[11px] text-muted">
                {summary.morphed} morphed · {summary.refused} refused
              </p>
            </div>
            <ul className="flex flex-col gap-0.5 text-[11px] text-muted">
              {(["A", "B", "C", "D", "E"] as const).map((id) => {
                const t = summary.perStage[id];
                return (
                  <li key={id} className="flex items-center justify-between gap-2">
                    <span>
                      {id} · {STAGE_LABELS[id]}
                    </span>
                    <span className="tabular-nums">
                      <span className="text-emerald-500">{t.pass}</span> / <span className="text-amber-500">{t.warn}</span> /{" "}
                      <span className="text-red-500">{t.fail}</span> / {t.skip}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[10px] text-muted">pass / warn / fail / skipped per stage</p>
            {summary.worstLockMs != null && (
              <p className="text-[11px] text-muted">
                Worst phase lock {summary.worstLockMs} ms (limit {PHASE_LOCK_MAX_MS} ms).
              </p>
            )}
            {s.fixLog.length > 0 && (
              <ul className="flex flex-col gap-0.5 border-t border-border/50 pt-1.5 text-[11px] text-muted" data-testid="sync-test-fixlog">
                {s.fixLog.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void fixIssuesAutomatically()}
                disabled={busy || summary.failed === 0}
                data-testid="sync-test-fix"
                title={
                  summary.failed === 0
                    ? "Nothing failed."
                    : "Re-reads the tempo of tracks behind a tempo failure, re-runs stalled pairs, and re-tests only those. Lists what it can't fix."
                }
                className="rounded-full bg-accent-purple px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Fix Issues Automatically
              </button>
              <button
                type="button"
                onClick={() => void onExport()}
                disabled={busy}
                data-testid="sync-test-export"
                className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-foreground shadow-elevate-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                Export Log
              </button>
              {exportNote && <span className="text-[11px] text-muted">{exportNote}</span>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function PairCard({ pair }: { pair: PairResult }) {
  const [open, setOpen] = useState(pair.status !== "pass");
  return (
    <div className="rounded-xl bg-surface-hover px-3 py-2" data-testid="sync-test-pair" data-status={pair.status} data-index={pair.index}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={open}>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-foreground">
            {pair.fromTitle} → {pair.toTitle}
          </span>
          <span className="block text-[11px] text-muted">
            {pair.kind === "hardest" ? "Hardest tempo jump · " : ""}
            {pair.bpmFrom != null && pair.bpmTo != null ? `${pair.bpmFrom.toFixed(1)} → ${pair.bpmTo.toFixed(1)} BPM · ` : ""}
            {pair.outcome} · {Math.round(pair.durationSec)} s
            {pair.before ? ` · was ${pair.before.status.toUpperCase()}` : ""}
          </span>
        </span>
        <span className={`shrink-0 text-xs font-bold ${STATUS_COLOR[pair.status]}`}>{STATUS_TEXT[pair.status]}</span>
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1 border-t border-border/50 pt-1.5">
          {pair.stages.map((st) => (
            <StageRow key={st.id} stage={st} />
          ))}
          {pair.notes.map((n, i) => (
            <li key={i} className="text-[11px] italic text-muted">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StageRow({ stage }: { stage: StageResult }) {
  return (
    <li className="flex gap-2 text-[11px]" data-testid="sync-test-stage" data-stage={stage.id} data-status={stage.status}>
      <span className={`w-3 shrink-0 text-center font-bold ${STATUS_COLOR[stage.status]}`} aria-label={STATUS_TEXT[stage.status]}>
        {STATUS_ICON[stage.status]}
      </span>
      <span className="min-w-0">
        <span className="font-semibold text-foreground">
          {stage.id} · {stage.label}
        </span>
        <span className="block text-muted">{stage.detail}</span>
      </span>
    </li>
  );
}
