/**
 * The sync test suite's judgement, kept pure: given what was observed while a real Song Sync morph ran (the planner's
 * report and plan, the live status samples the DJ board shows, stall events from the audio elements), say whether each
 * of five stages held, build the summary, pick the hardest tempo jump, say what could be fixed automatically, and
 * write the log. The runner (lib/syncTestRunner.ts) does the observing; nothing here touches the player or the DOM.
 *
 * Stages: A the SyncReport is valid and yields a plan; B the tempo walks bar by bar onto the next track's, on a bar
 * grid that can be trusted (the DOWNBEAT diagnostic); C the pitch moves with it, when a pitch move was planned; D the
 * two tracks lock to within PHASE_LOCK_MAX_MS; E the crossfade plays without buffering or unexpected seeks and the
 * next track takes over.
 *
 * The thresholds are the spec's, not tuned to pass: PHASE_LOCK_MAX_MS = 10. The player's own lock loop moves the
 * incoming track whenever its averaged phase error passes SONG_SYNC_PHASE_TOLERANCE_SEC (5 ms, in DualDeckStage), so a
 * lock over 10 ms here means that loop never got to correct it, not that such a lock is normal.
 */

import { isPhraseGridTrustworthy, type SongMap } from "@/lib/song-map";
import {
  SONG_SYNC_MAX_RATE_DELTA,
  songSyncStateAt,
  type SongSyncPhase,
  type SongSyncPlan,
  type SongSyncRefusal,
  type SongSyncStatus,
} from "@/lib/songSync";
import { bestTempoRatio } from "@/lib/tempoRatio";

/** The playlist the suite exercises. */
export const SYNC_TEST_PLAYLIST_NAME = "Same Beat";
/** Stage D: the two tracks must be closer than this once locked, ms. */
export const PHASE_LOCK_MAX_MS = 10;
/** Stage C: the pitch shift must arrive this close to its target, semitones. */
export const PITCH_TOLERANCE_SEMITONES = 0.25;
/** Stage B: the tempo must arrive within this fraction of the target. */
export const BPM_ARRIVAL_TOLERANCE = 0.01;
/** The plausible range for a track's tempo; outside it the reading is a mistake, not music. */
const MIN_PLAUSIBLE_BPM = 40;
const MAX_PLAUSIBLE_BPM = 220;
/** The tempo may wobble this much, BPM, against the direction of the morph before it counts as going the wrong way. */
const BPM_WOBBLE = 0.05;

export type StageId = "A" | "B" | "C" | "D" | "E";
export type StageStatus = "pass" | "warn" | "fail" | "skip";
export type PairStatus = "pass" | "warn" | "fail";
export type PairKind = "consecutive" | "hardest";
export type PairOutcome = "morphed" | "refused" | "timeout" | "error";
/** What "Fix Issues Automatically" can do for a pair: re-read the tempo from the audio, or just run it again. */
export type FixKind = "reanalyze" | "retry";

export const STAGE_LABELS: Record<StageId, string> = {
  A: "SyncReport valid",
  B: "BPM morph + downbeat grid",
  C: "Pitch morph",
  D: `Phase lock under ${PHASE_LOCK_MAX_MS} ms`,
  E: "Crossfade quality",
};

export interface StageResult {
  id: StageId;
  label: string;
  status: StageStatus;
  detail: string;
  /** The stage's headline number when it has one (D: the lock error in ms, absolute), for the summary. */
  value?: number;
}

/** One reading of the DJ board's live status (store.songSync) while the morph runs. */
export interface SyncSample {
  tMs: number;
  phase: SongSyncPhase;
  bar: number;
  bpmNow: number;
  pitchNow: number;
  phaseErrorMs: number | null;
}

/** A buffering stall, error or seek on one of the audio elements, tagged with the morph phase it happened in. */
export interface PlaybackEvent {
  tMs: number;
  type: "waiting" | "stalled" | "seeking" | "error";
  phase: SongSyncPhase | null;
}

/** The phases in which the listener hears both tracks: anything going wrong here is audible. */
const AUDIBLE_PHASES: readonly SongSyncPhase[] = ["locked", "crossfading"];
/** The phases from which the morph's tempo and pitch have arrived. */
const ARRIVED_PHASES: readonly SongSyncPhase[] = ["aligning", "locked", "crossfading", "done"];

function stage(id: StageId, status: StageStatus, detail: string, value?: number): StageResult {
  return value === undefined ? { id, label: STAGE_LABELS[id], status, detail } : { id, label: STAGE_LABELS[id], status, detail, value };
}

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

// ---------------------------------------------------------------------------
// Stage A: the SyncReport
// ---------------------------------------------------------------------------

/** The report fields the planner reads (a subset of SyncReport, so tests need not build a whole one). */
export interface ReportFacts {
  trackA_bpm: number;
  trackB_bpm: number;
  trackB_bpmMatched: number;
  bpmDelta: number;
  tempoConfident: boolean;
  morphPitchShiftSemitones: number;
}

export interface TempoFacts {
  bpm: number;
  bpmConfidence: number;
}

export type PlanOutcome = { ok: true; plan: SongSyncPlan } | { ok: false; reason: SongSyncRefusal };

export interface ReportEvaluation {
  stage: StageResult;
  /** Set when the problem is one a fresh read of the audio could fix. */
  fix: FixKind | null;
}

export function evaluateReport(
  report: ReportFacts,
  planOutcome: PlanOutcome,
  a: TempoFacts,
  b: TempoFacts,
  kind: PairKind = "consecutive"
): ReportEvaluation {
  const numbers: [string, number][] = [
    ["track A BPM", report.trackA_bpm],
    ["track B BPM", report.trackB_bpm],
    ["B matched BPM", report.trackB_bpmMatched],
    ["BPM gap", report.bpmDelta],
    ["pitch shift", report.morphPitchShiftSemitones],
  ];
  const broken = numbers.filter(([, n]) => typeof n !== "number" || !Number.isFinite(n));
  if (broken.length > 0) {
    return { stage: stage("A", "fail", `Report has non-numeric fields: ${broken.map(([name]) => name).join(", ")}.`), fix: null };
  }
  for (const [name, bpm] of [
    ["A", report.trackA_bpm],
    ["B", report.trackB_bpm],
  ] as const) {
    if (bpm < MIN_PLAUSIBLE_BPM || bpm > MAX_PLAUSIBLE_BPM) {
      return {
        stage: stage("A", "fail", `Track ${name} reads ${f1(bpm)} BPM, outside ${MIN_PLAUSIBLE_BPM}-${MAX_PLAUSIBLE_BPM}: a misread tempo.`),
        fix: "reanalyze",
      };
    }
  }

  if (!planOutcome.ok) {
    if (planOutcome.reason === "tempo-gap") {
      const gapPct = (Math.abs(report.trackB_bpmMatched / report.trackA_bpm - 1) * 100).toFixed(1);
      const limit = (SONG_SYNC_MAX_RATE_DELTA * 100).toFixed(0);
      return {
        stage: stage(
          "A",
          kind === "hardest" ? "pass" : "warn",
          `Refused by design: the tempos are ${gapPct}% apart (limit ${limit}%), so the DJ uses an ordinary transition.`
        ),
        fix: null,
      };
    }
    return {
      stage: stage(
        "A",
        "fail",
        `Refused, tempo not trusted: A ${f1(report.trackA_bpm)} BPM at confidence ${f2(a.bpmConfidence)}, B ${f1(report.trackB_bpm)} BPM at ${f2(b.bpmConfidence)} (both need 0.35).`
      ),
      fix: "reanalyze",
    };
  }

  const plan = planOutcome.plan;
  if (plan.morphBars < 2 || plan.morphBars > 16) {
    return { stage: stage("A", "fail", `Plan morphs over ${plan.morphBars} bars; expected 2 to 16.`), fix: null };
  }
  const how =
    plan.direction === "hold"
      ? "hold the tempo"
      : `${plan.direction === "faster" ? "speed up" : "slow down"} ${((plan.rateTarget - 1) * 100).toFixed(1)}%`;
  const pitch = plan.pitchTargetSemitones === 0 ? "no pitch move" : `pitch ${plan.pitchTargetSemitones > 0 ? "+" : ""}${plan.pitchTargetSemitones}`;
  return {
    stage: stage("A", "pass", `A ${f1(plan.bpmFrom)} to B ${f1(plan.bpmTo)} BPM: ${how} over ${plan.morphBars} bars, ${pitch}.`),
    fix: null,
  };
}

/**
 * The plan the player actually ran, read back from the status it announced when the morph began. The AI DJ may
 * override the planner's bar count or pitch move after the preflight, so the morph is judged against what the player
 * said it would do, which is also what it did.
 */
export function planFromStatus(
  status: Pick<SongSyncStatus, "morphBars" | "bpmFrom" | "bpmTo" | "keyFrom" | "keyTo" | "pitchTarget">
): SongSyncPlan {
  const rateTarget = status.bpmFrom > 0 ? status.bpmTo / status.bpmFrom : 1;
  return {
    morphBars: status.morphBars,
    bpmFrom: status.bpmFrom,
    bpmTo: status.bpmTo,
    rateTarget,
    direction: Math.abs(status.bpmTo - status.bpmFrom) < 1e-6 ? "hold" : rateTarget > 1 ? "faster" : "slower",
    pitchTargetSemitones: status.pitchTarget,
    keyFrom: status.keyFrom,
    keyTo: status.keyTo,
    bpmB: status.bpmTo,
  };
}

// ---------------------------------------------------------------------------
// Stage B: the tempo morph and the downbeat grid
// ---------------------------------------------------------------------------

export interface GridInfo {
  hasMap: boolean;
  downbeats: number;
  downbeatConfidence: number;
  tempoConfidence: number;
  /** The song map's own verdict (isPhraseGridTrustworthy): enough confident bar lines to count bars on. */
  trustworthy: boolean;
}

export function gridInfo(map: SongMap | null | undefined): GridInfo {
  if (!map) return { hasMap: false, downbeats: 0, downbeatConfidence: 0, tempoConfidence: 0, trustworthy: false };
  return {
    hasMap: true,
    downbeats: map.downbeats.length,
    downbeatConfidence: map.downbeatConfidence,
    tempoConfidence: map.tempoConfidence,
    trustworthy: isPhraseGridTrustworthy(map),
  };
}

/**
 * The DOWNBEAT diagnostic: the morph starts on the playing track's bar line and the incoming track enters on its own,
 * so an untrustworthy bar grid means "bar 1" may not be the true downbeat, and a lock can be a lock of the wrong beat.
 */
export function describeDownbeatGrid(a: GridInfo, b: GridInfo): { ok: boolean; text: string } {
  const one = (name: string, g: GridInfo) =>
    !g.hasMap
      ? `${name}: no song map`
      : `${name}: ${g.downbeats} bar lines, downbeat confidence ${f2(g.downbeatConfidence)}${g.trustworthy ? "" : " (weak)"}`;
  return { ok: a.trustworthy && b.trustworthy, text: `${one("A", a)}; ${one("B", b)}` };
}

export function evaluateBpmMorph(samples: SyncSample[], plan: SongSyncPlan, grid: { a: GridInfo; b: GridInfo }): StageResult {
  const diag = describeDownbeatGrid(grid.a, grid.b);
  const morphing = samples.filter((s) => s.phase === "morphing");
  const arrived = samples.filter((s) => ARRIVED_PHASES.includes(s.phase));
  if (morphing.length === 0 && arrived.length === 0) {
    return stage("B", "fail", "The morph never started: no bar of it was observed.");
  }
  const maxBar = Math.max(0, ...samples.map((s) => s.bar));
  if (arrived.length === 0 || maxBar < plan.morphBars) {
    return stage("B", "fail", `The morph stopped at bar ${maxBar} of ${plan.morphBars}.`);
  }

  // Each reading sits between the planned tempo at its bar and at the next one.
  const ordered = [...morphing, ...arrived];
  const step = Math.abs(plan.bpmTo - plan.bpmFrom) / plan.morphBars;
  for (const s of morphing) {
    const lo = songSyncStateAt(plan, s.bar).bpm;
    const hi = songSyncStateAt(plan, s.bar + 1).bpm;
    const min = Math.min(lo, hi) - BPM_WOBBLE - 0.01 * plan.bpmFrom;
    const max = Math.max(lo, hi) + BPM_WOBBLE + 0.01 * plan.bpmFrom;
    if (s.bpmNow < min || s.bpmNow > max) {
      return stage(
        "B",
        "fail",
        `At bar ${s.bar} the tempo read ${f2(s.bpmNow)} BPM, off the planned ${f2(Math.min(lo, hi))} to ${f2(Math.max(lo, hi))} (step ${f2(step)} BPM per bar).`
      );
    }
  }
  const sign = plan.direction === "faster" ? 1 : plan.direction === "slower" ? -1 : 0;
  if (sign !== 0) {
    for (let i = 1; i < ordered.length; i++) {
      if ((ordered[i].bpmNow - ordered[i - 1].bpmNow) * sign < -BPM_WOBBLE) {
        return stage("B", "fail", `The tempo moved the wrong way (${f2(ordered[i - 1].bpmNow)} then ${f2(ordered[i].bpmNow)} BPM) while ${plan.direction === "faster" ? "speeding up" : "slowing down"}.`);
      }
    }
  }
  const last = arrived[arrived.length - 1];
  const miss = Math.abs(last.bpmNow - plan.bpmTo) / plan.bpmTo;
  if (miss > BPM_ARRIVAL_TOLERANCE) {
    return stage("B", "fail", `The tempo arrived at ${f2(last.bpmNow)} BPM, not the target ${f2(plan.bpmTo)} (${(miss * 100).toFixed(1)}% off).`);
  }
  const arrival = `Tempo ${f2(plan.bpmFrom)} to ${f2(last.bpmNow)} BPM across ${plan.morphBars} bars (target ${f2(plan.bpmTo)}).`;
  return stage("B", diag.ok ? "pass" : "warn", `${arrival} Downbeat grid: ${diag.text}.${diag.ok ? "" : " Bar 1 may not be the true downbeat."}`);
}

// ---------------------------------------------------------------------------
// Stage C: the pitch morph
// ---------------------------------------------------------------------------

export function evaluatePitchMorph(samples: SyncSample[], plan: SongSyncPlan): StageResult {
  const target = plan.pitchTargetSemitones;
  if (target === 0) return stage("C", "skip", "No pitch move planned: the keys agree, clash too little, or are unknown.");
  const arrived = samples.filter((s) => ARRIVED_PHASES.includes(s.phase));
  if (arrived.length === 0) return stage("C", "fail", "The morph never finished, so the pitch never arrived.");
  const last = arrived[arrived.length - 1];
  if (Math.abs(last.pitchNow - target) > PITCH_TOLERANCE_SEMITONES) {
    return stage("C", "fail", `Pitch arrived at ${f2(last.pitchNow)} semitones, not the target ${target > 0 ? "+" : ""}${target}.`);
  }
  const sign = Math.sign(target);
  const ordered = samples.filter((s) => s.phase === "morphing" || ARRIVED_PHASES.includes(s.phase));
  for (let i = 1; i < ordered.length; i++) {
    if ((ordered[i].pitchNow - ordered[i - 1].pitchNow) * sign < -0.05) {
      return stage("C", "fail", `Pitch moved the wrong way (${f2(ordered[i - 1].pitchNow)} then ${f2(ordered[i].pitchNow)} semitones).`);
    }
  }
  return stage("C", "pass", `Pitch walked 0 to ${f2(last.pitchNow)} semitones (target ${target > 0 ? "+" : ""}${target}) with the tempo.`);
}

// ---------------------------------------------------------------------------
// Stage D: the phase lock
// ---------------------------------------------------------------------------

export function evaluatePhaseLock(samples: SyncSample[]): StageResult {
  const measured = samples.filter((s) => s.phaseErrorMs != null && ARRIVED_PHASES.includes(s.phase));
  if (measured.length === 0) return stage("D", "fail", "The two tracks' phase was never measured.");
  const first = measured[0].phaseErrorMs as number;
  const last = measured[measured.length - 1].phaseErrorMs as number;
  const locked = measured.filter((s) => AUDIBLE_PHASES.includes(s.phase));
  const worst = Math.max(...(locked.length > 0 ? locked : measured).map((s) => Math.abs(s.phaseErrorMs as number)));
  const text = `First measured ${Math.round(first)} ms off, locked at ${Math.round(last)} ms (worst while locked ${Math.round(worst)} ms; limit ${PHASE_LOCK_MAX_MS}).`;
  const value = Math.abs(last);
  if (value > PHASE_LOCK_MAX_MS) return stage("D", "fail", text, value);
  if (worst > PHASE_LOCK_MAX_MS) return stage("D", "warn", text, value);
  return stage("D", "pass", text, value);
}

// ---------------------------------------------------------------------------
// Stage E: the crossfade
// ---------------------------------------------------------------------------

export function evaluateCrossfade(events: PlaybackEvent[], samples: SyncSample[], handedOver: boolean): StageResult {
  const reachedCrossfade = samples.some((s) => s.phase === "crossfading" || s.phase === "done");
  if (!reachedCrossfade) return stage("E", "fail", "The crossfade never started.");
  const audible = events.filter((e) => e.phase != null && AUDIBLE_PHASES.includes(e.phase));
  const early = events.length - audible.length;
  if (audible.length > 0) {
    const kinds = [...new Set(audible.map((e) => e.type))].join(", ");
    return stage("E", "fail", `${audible.length} playback event${audible.length === 1 ? "" : "s"} while both tracks were audible (${kinds}).`);
  }
  if (!handedOver) return stage("E", "fail", "The crossfade finished but the next track never took over.");
  const quiet = early > 0 ? ` (${early} buffering/seek event${early === 1 ? "" : "s"} earlier, during the silent pre-roll, which is expected)` : "";
  return stage("E", "pass", `No buffering or unexpected seeks while locked or crossfading, and the next track took over${quiet}.`);
}

// ---------------------------------------------------------------------------
// A pair, and the run
// ---------------------------------------------------------------------------

export interface PairResult {
  index: number;
  kind: PairKind;
  fromId: string;
  toId: string;
  fromTitle: string;
  toTitle: string;
  bpmFrom: number | null;
  bpmTo: number | null;
  outcome: PairOutcome;
  stages: StageResult[];
  status: PairStatus;
  fix: FixKind | null;
  durationSec: number;
  notes: string[];
  /** Set once an automatic fix re-ran this pair: how it stood before. */
  before?: { status: PairStatus; outcome: PairOutcome; stages: StageResult[] };
}

export function pairStatus(stages: StageResult[]): PairStatus {
  if (stages.some((s) => s.status === "fail")) return "fail";
  if (stages.some((s) => s.status === "warn")) return "warn";
  return "pass";
}

/** B to E for a pair that never got to morph: the stages could not run, and the reason is the first stage's. */
export function skippedStages(from: StageId, why: string): StageResult[] {
  const ids: StageId[] = ["B", "C", "D", "E"];
  return ids.filter((id) => id >= from).map((id) => stage(id, "skip", why));
}

export interface SyncTestSummary {
  total: number;
  passed: number;
  warned: number;
  failed: number;
  morphed: number;
  refused: number;
  perStage: Record<StageId, Record<StageStatus, number>>;
  /** The largest |phase error| at the lock across all pairs, ms; null when none was measured. */
  worstLockMs: number | null;
  fixable: number;
  verdict: "pass" | "warn" | "fail";
}

export function summarize(pairs: PairResult[]): SyncTestSummary {
  const ids: StageId[] = ["A", "B", "C", "D", "E"];
  const perStage = Object.fromEntries(ids.map((id) => [id, { pass: 0, warn: 0, fail: 0, skip: 0 }])) as SyncTestSummary["perStage"];
  let worstLockMs: number | null = null;
  for (const p of pairs) {
    for (const s of p.stages) perStage[s.id][s.status]++;
    const lock = p.stages.find((s) => s.id === "D")?.value;
    if (lock != null) worstLockMs = Math.max(worstLockMs ?? 0, Math.round(lock * 10) / 10);
  }
  const failed = pairs.filter((p) => p.status === "fail").length;
  const warned = pairs.filter((p) => p.status === "warn").length;
  return {
    total: pairs.length,
    passed: pairs.filter((p) => p.status === "pass").length,
    warned,
    failed,
    morphed: pairs.filter((p) => p.outcome === "morphed").length,
    refused: pairs.filter((p) => p.outcome === "refused").length,
    perStage,
    worstLockMs,
    fixable: pairs.filter((p) => p.status === "fail" && p.fix != null).length,
    verdict: failed > 0 ? "fail" : warned > 0 ? "warn" : "pass",
  };
}

// ---------------------------------------------------------------------------
// The hardest jump
// ---------------------------------------------------------------------------

export interface TempoEntry {
  id: string;
  bpm: number;
  bpmConfidence: number;
}

/** BPM apart after folding B to the octave nearest A's: the same measure the planner uses. */
export function foldedBpmGap(bpmA: number, bpmB: number): number {
  if (!(bpmA > 0) || !(bpmB > 0)) return 0;
  return Math.abs(bpmA - bpmA / bestTempoRatio(bpmA, bpmB));
}

/**
 * The ordered pair of distinct tracks with the biggest tempo jump, among those not already tested (`tested` holds
 * "fromId>toId" keys) and whose tempos are trusted (a jump measured against a guess means nothing). Null when nothing
 * qualifies. Ties go to the earlier pair, so the choice is stable.
 */
export function pickHardestPair(
  entries: TempoEntry[],
  tested: ReadonlySet<string>,
  minConfidence = 0.35
): { from: TempoEntry; to: TempoEntry; gapBpm: number } | null {
  let best: { from: TempoEntry; to: TempoEntry; gapBpm: number } | null = null;
  for (const from of entries) {
    for (const to of entries) {
      if (from.id === to.id || tested.has(`${from.id}>${to.id}`)) continue;
      if (from.bpmConfidence < minConfidence || to.bpmConfidence < minConfidence) continue;
      // Rounded to 0.01 BPM so floating-point noise between a>b and b>a cannot decide a tie.
      const gapBpm = Math.round(foldedBpmGap(from.bpm, to.bpm) * 100) / 100;
      if (!best || gapBpm > best.gapBpm) best = { from, to, gapBpm };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fixes
// ---------------------------------------------------------------------------

export interface FixPlan {
  /** Track ids whose tempo should be re-read from the audio. */
  reanalyze: string[];
  /** Indexes of the pairs to run again (after any re-analysis). */
  rerun: number[];
  /** Failures nothing here can fix automatically, in words. */
  manual: string[];
}

export function planFixes(pairs: PairResult[]): FixPlan {
  const reanalyze = new Set<string>();
  const rerun: number[] = [];
  const manual: string[] = [];
  for (const p of pairs) {
    if (p.status !== "fail") continue;
    const name = `${p.fromTitle} to ${p.toTitle}`;
    if (p.fix === "reanalyze") {
      reanalyze.add(p.fromId);
      reanalyze.add(p.toId);
      rerun.push(p.index);
    } else if (p.fix === "retry") {
      rerun.push(p.index);
    } else {
      const failing = p.stages.filter((s) => s.status === "fail");
      manual.push(`${name}: ${failing.map((s) => `${s.id} (${s.detail})`).join("; ")}. No automatic fix: it needs an engine change.`);
    }
  }
  return { reanalyze: [...reanalyze], rerun, manual };
}

/** What a failed pair needs, given where it failed: a tempo problem is a re-read, a stall or a hang is a retry. */
export function fixFor(outcome: PairOutcome, stages: StageResult[], reportFix: FixKind | null): FixKind | null {
  if (reportFix) return reportFix;
  if (outcome === "timeout" || outcome === "error") return "retry";
  const e = stages.find((s) => s.id === "E");
  return e?.status === "fail" ? "retry" : null;
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

export interface RunLog {
  startedAt: number;
  finishedAt: number | null;
  playlistName: string;
  pairs: PairResult[];
  fixLog: string[];
  userAgent: string;
}

const MARK: Record<StageStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };

export function exportFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `djclaude_sync_test_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.txt`;
}

export function formatLog(run: RunLog): string {
  const s = summarize(run.pairs);
  const lines: string[] = [];
  lines.push("DJ Claude sync test");
  lines.push(`Playlist: ${run.playlistName}`);
  lines.push(`Started:  ${new Date(run.startedAt).toISOString()}`);
  if (run.finishedAt) lines.push(`Finished: ${new Date(run.finishedAt).toISOString()} (${Math.round((run.finishedAt - run.startedAt) / 1000)} s)`);
  lines.push(`Browser:  ${run.userAgent}`);
  lines.push("");
  lines.push(
    `SUMMARY: ${s.verdict.toUpperCase()}. ${s.passed}/${s.total} pairs passed, ${s.warned} with warnings, ${s.failed} failed. ${s.morphed} morphed, ${s.refused} refused.`
  );
  if (s.worstLockMs != null) lines.push(`Worst phase lock: ${s.worstLockMs} ms (limit ${PHASE_LOCK_MAX_MS}).`);
  for (const id of ["A", "B", "C", "D", "E"] as StageId[]) {
    const t = s.perStage[id];
    lines.push(`  Stage ${id} ${STAGE_LABELS[id]}: ${t.pass} pass, ${t.warn} warn, ${t.fail} fail, ${t.skip} skipped`);
  }
  lines.push("");
  for (const p of run.pairs) {
    lines.push(`PAIR ${p.index + 1}${p.kind === "hardest" ? " (hardest tempo jump)" : ""}: ${p.fromTitle} -> ${p.toTitle}`);
    lines.push(`  Result: ${p.status.toUpperCase()} (${p.outcome}) in ${Math.round(p.durationSec)} s${p.bpmFrom != null && p.bpmTo != null ? `, ${f1(p.bpmFrom)} -> ${f1(p.bpmTo)} BPM` : ""}`);
    for (const st of p.stages) lines.push(`  [${MARK[st.status]}] ${st.id} ${st.label}: ${st.detail}`);
    for (const n of p.notes) lines.push(`  note: ${n}`);
    if (p.before) lines.push(`  before the automatic fix: ${p.before.status.toUpperCase()} (${p.before.outcome})`);
    lines.push("");
  }
  if (run.fixLog.length > 0) {
    lines.push("AUTOMATIC FIXES");
    for (const l of run.fixLog) lines.push(`  ${l}`);
    lines.push("");
  }
  return lines.join("\n");
}
