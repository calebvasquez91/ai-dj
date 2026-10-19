/**
 * Runs the sync test suite against the real player. For each pair it plays [A, B] from the top, waits for both tracks'
 * analysis, presses the real SYNC (the same request the DJ board's button makes), and watches the morph through what
 * the board itself shows (store.songSync) plus stall events from the audio elements, then hands the observations to
 * the pure judges in lib/syncTest.ts. Nothing here changes the player's behaviour; it only drives it and watches.
 *
 * Browser-only (it reads the DOM's <audio> elements). While it runs it takes over playback and turns the "Auto" switch
 * off in memory (not saved), so no unrelated automatic morph fires mid-test; both are put back at the end.
 *
 * Not done, on purpose: the spec's "run stem separation if missing". Stems are a paused, paid feature in this app
 * (STEM_FEATURES_ENABLED), and Song Sync does not use them.
 */

import { analyzeTrackFromUrl, fallbackAnalysis } from "@/lib/audio-analysis";
import { tempoChanged } from "@/lib/analysisJobs";
import { useStore } from "@/lib/store";
import { buildSyncReport } from "@/lib/syncEngine";
import { planSongSync, type SongSyncPhase, type SongSyncStatus } from "@/lib/songSync";
import {
  SYNC_TEST_PLAYLIST_NAME,
  evaluateBpmMorph,
  evaluateCrossfade,
  evaluatePhaseLock,
  evaluatePitchMorph,
  evaluateReport,
  exportFileName,
  fixFor,
  formatLog,
  gridInfo,
  pairStatus,
  pickHardestPair,
  planFixes,
  planFromStatus,
  skippedStages,
  type PairKind,
  type PairOutcome,
  type PairResult,
  type PlaybackEvent,
  type StageResult,
  type SyncSample,
} from "@/lib/syncTest";
import { useSyncTestStore } from "@/lib/syncTestStore";
import { withTimeout } from "@/lib/withTimeout";
import type { LocalTrack } from "@/types/music";

const POLL_MS = 250;
/** A must have played this long before SYNC is pressed, so the player has a real position to plan from. */
const MIN_PLAY_SEC = 3;
/** Both tracks' analysis (with a song map) and A's playback must be ready within this. */
const READY_TIMEOUT_MS = 120_000;
/** From pressing SYNC: no morph and no refusal by now means the request was lost. */
const START_TIMEOUT_MS = 30_000;
/** The whole morph and crossfade. */
const MORPH_TIMEOUT_MS = 200_000;
/** After the next track takes over, keep watching this long so a late stall is still seen. */
const SETTLE_MS = 1500;
const REANALYSIS_TIMEOUT_MS = 90_000;

let activeRun = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const ui = () => useSyncTestStore.getState();
const cancelled = (run: number) => run !== activeRun || ui().cancelRequested;

async function waitFor<T>(read: () => T | null | false | undefined, timeoutMs: number, run: number): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (cancelled(run)) return null;
    const value = read();
    if (value) return value;
    await sleep(POLL_MS);
  }
  return null;
}

function localTracks(): LocalTrack[] {
  const playlist = useStore.getState().playlists.find((p) => p.name === SYNC_TEST_PLAYLIST_NAME);
  if (!playlist) throw new Error(`There is no playlist called "${SYNC_TEST_PLAYLIST_NAME}". Create it first; the suite only reads it.`);
  const tracks = playlist.tracks.filter((t): t is LocalTrack => t.source === "local");
  if (tracks.length < 2) throw new Error(`"${SYNC_TEST_PLAYLIST_NAME}" needs at least two uploaded tracks to test a transition.`);
  return tracks;
}

interface Observation {
  outcome: "morphed" | "refused" | "timeout" | "cancelled";
  samples: SyncSample[];
  events: PlaybackEvent[];
  firstMorphing: SongSyncStatus | null;
  refusal: string | null;
  handedOver: boolean;
}

/** Watches one morph from the moment SYNC was pressed until the next track has taken over. */
async function observeMorph(b: LocalTrack, run: number): Promise<Observation> {
  const t0 = Date.now();
  const samples: SyncSample[] = [];
  const events: PlaybackEvent[] = [];
  let lastPhase: SongSyncPhase | null = null;
  let firstMorphing: SongSyncStatus | null = null;
  let started = false;
  let cancelledMorph = 0;

  const elements = [...document.querySelectorAll("audio")];
  const handlers = (["waiting", "stalled", "seeking", "error"] as const).map((type) => {
    const handler = () => events.push({ tMs: Date.now() - t0, type, phase: lastPhase });
    for (const el of elements) el.addEventListener(type, handler);
    return { type, handler };
  });
  const detach = () => {
    for (const { type, handler } of handlers) for (const el of elements) el.removeEventListener(type, handler);
  };

  let outcome: Observation["outcome"] = "timeout";
  let refusal: string | null = null;
  let handedOver = false;
  try {
    while (Date.now() - t0 < MORPH_TIMEOUT_MS) {
      if (cancelled(run)) {
        outcome = "cancelled";
        break;
      }
      const s = useStore.getState();
      const status = s.songSync;
      if (status) {
        started = true;
        cancelledMorph = 0;
        lastPhase = status.phase;
        if (!firstMorphing && status.phase === "morphing") firstMorphing = status;
        const prev = samples[samples.length - 1];
        const sample: SyncSample = {
          tMs: Date.now() - t0,
          phase: status.phase,
          bar: status.bar,
          bpmNow: status.bpmNow,
          pitchNow: status.pitchNow,
          phaseErrorMs: status.phaseErrorMs,
        };
        if (
          !prev ||
          prev.phase !== sample.phase ||
          prev.bar !== sample.bar ||
          prev.bpmNow !== sample.bpmNow ||
          prev.pitchNow !== sample.pitchNow ||
          prev.phaseErrorMs !== sample.phaseErrorMs
        ) {
          samples.push(sample);
        }
      }

      // The player says why in store.syncError when it gives up, whether before the morph showed any status or after
      // it had shown "analyzing" and then stood down (the status clears first, so only the message tells the two apart).
      if (s.syncError && (!started || !status)) {
        outcome = "refused";
        refusal = s.syncError;
        break;
      }
      if (started && s.currentTrack?.id === b.id && (!status || status.phase === "done")) {
        await sleep(SETTLE_MS);
        outcome = "morphed";
        handedOver = useStore.getState().currentTrack?.id === b.id;
        break;
      }
      if (started && !status && s.currentTrack?.id !== b.id && ++cancelledMorph >= 8) {
        outcome = "refused";
        refusal = "The player stood the morph down before it finished.";
        break;
      }
      if (!started && Date.now() - t0 > START_TIMEOUT_MS) break;
      await sleep(POLL_MS);
    }
  } finally {
    detach();
  }
  return { outcome, samples, events, firstMorphing, refusal, handedOver };
}

/** One pair, end to end. Plays [A, B] from the top so every pair is independent of the one before. */
async function runPair(a: LocalTrack, b: LocalTrack, kind: PairKind, index: number, run: number): Promise<PairResult> {
  const started = Date.now();
  const notes: string[] = [];
  const identity = { index, kind, fromId: a.id, toId: b.id, fromTitle: a.title, toTitle: b.title };
  const done = (
    outcome: PairOutcome,
    stages: StageResult[],
    bpm: { from: number | null; to: number | null },
    reportFix: PairResult["fix"]
  ): PairResult => {
    const status = pairStatus(stages);
    return {
      ...identity,
      bpmFrom: bpm.from,
      bpmTo: bpm.to,
      outcome,
      stages,
      status,
      fix: status === "fail" ? fixFor(outcome, stages, reportFix) : null,
      durationSec: (Date.now() - started) / 1000,
      notes,
    };
  };

  const store = useStore.getState();
  store.clearSyncError();
  store.playTrackList([a, b], 0);

  const ready = await waitFor(
    () => {
      const s = useStore.getState();
      const aa = s.trackAnalysis[a.id];
      const bb = s.trackAnalysis[b.id];
      return (
        s.currentTrack?.id === a.id &&
        s.isPlaying &&
        s.currentTimeSec >= MIN_PLAY_SEC &&
        !s.isTransitioning &&
        s.songSync === null &&
        aa?.songMap !== undefined &&
        bb?.songMap !== undefined
      );
    },
    READY_TIMEOUT_MS,
    run
  );
  if (!ready) {
    if (cancelled(run)) throw new Error("cancelled");
    const s = useStore.getState();
    const analysed = s.trackAnalysis[a.id]?.songMap !== undefined && s.trackAnalysis[b.id]?.songMap !== undefined;
    const why = analysed
      ? "the first track never started playing (the browser may be blocking audio until you interact with the page)"
      : "the tracks' analysis did not finish";
    notes.push(`Not ready within ${READY_TIMEOUT_MS / 1000} s: ${why}.`);
    const stages = [
      { id: "A", label: "SyncReport valid", status: "fail", detail: `Not ready: ${why}.` } as StageResult,
      ...skippedStages("B", "Not run: the pair was never ready."),
    ];
    return done("timeout", stages, { from: null, to: null }, analysed ? "retry" : "reanalyze");
  }

  const state = useStore.getState();
  const aAnalysis = state.trackAnalysis[a.id] ?? fallbackAnalysis();
  const bAnalysis = state.trackAnalysis[b.id] ?? fallbackAnalysis();
  const report = buildSyncReport({
    current: { track: a, analysis: aAnalysis },
    next: { track: b, analysis: bAnalysis },
    currentElapsedSec: state.currentTimeSec,
  });
  const planned = planSongSync(report);
  const evalA = evaluateReport(report, planned, aAnalysis, bAnalysis, kind);
  const bpm = { from: report.trackA_bpm, to: report.trackB_bpmMatched };

  useStore.getState().requestSongSync();
  const obs = await observeMorph(b, run);

  if (obs.outcome === "cancelled") throw new Error("cancelled");

  if (obs.outcome === "refused") {
    notes.push(`The player's answer to SYNC: ${obs.refusal}`);
    const stageA: StageResult = planned.ok
      ? {
          ...evalA.stage,
          status: "fail",
          detail: `The plan was valid, so the tempos were fine, but the player refused: "${obs.refusal}" It gave up for another reason (a decode of the playing track that ran over its 8 s limit is a known one), so the message is misleading.`,
        }
      : evalA.stage;
    return done("refused", [stageA, ...skippedStages("B", "Not run: no morph happened.")], bpm, planned.ok ? "retry" : evalA.fix);
  }
  if (obs.outcome === "timeout" || !obs.firstMorphing) {
    notes.push(`No morph was observed within ${obs.samples.length === 0 ? START_TIMEOUT_MS / 1000 : MORPH_TIMEOUT_MS / 1000} s of pressing SYNC.`);
    const stages = [evalA.stage, ...skippedStages("B", "Not run: the morph never started or never finished.")];
    stages[1] = { ...stages[1], status: "fail", detail: "No complete morph was observed." };
    return done("timeout", stages, bpm, "retry");
  }

  if (!planned.ok) notes.push("The preflight plan refused but the player morphed anyway; judged against what it announced.");
  const plan = planFromStatus(obs.firstMorphing);
  const stages: StageResult[] = [
    evalA.stage,
    evaluateBpmMorph(obs.samples, plan, { a: gridInfo(aAnalysis.songMap), b: gridInfo(bAnalysis.songMap) }),
    evaluatePitchMorph(obs.samples, plan),
    evaluatePhaseLock(obs.samples),
    evaluateCrossfade(obs.events, obs.samples, obs.handedOver),
  ];
  if (obs.events.length > 0) {
    const counts = new Map<string, number>();
    for (const e of obs.events) counts.set(`${e.type} in ${e.phase ?? "no phase"}`, (counts.get(`${e.type} in ${e.phase ?? "no phase"}`) ?? 0) + 1);
    notes.push(`${obs.events.length} playback events: ${[...counts].map(([k, n]) => `${k} x${n}`).join(", ")}`);
  }
  return done("morphed", stages, { from: plan.bpmFrom, to: plan.bpmTo }, evalA.fix);
}

function currentPairResults(): PairResult[] {
  return ui().pairs;
}

function setPair(result: PairResult) {
  const pairs = [...currentPairResults()];
  const at = pairs.findIndex((p) => p.index === result.index);
  if (at >= 0) pairs[at] = result;
  else pairs.push(result);
  pairs.sort((x, y) => x.index - y.index);
  ui().patch({ pairs });
}

/** Puts the player back the way the test found it: the Auto switch as it was (set in memory only), and paused. */
function restore(savedAuto: boolean) {
  useStore.setState({ songSyncAuto: savedAuto });
  const s = useStore.getState();
  if (s.isPlaying) s.togglePlay();
}

export function cancelSyncTest() {
  if (ui().phase === "running" || ui().fixing) ui().patch({ cancelRequested: true, label: "Stopping after this step…" });
}

export async function startSyncTest(): Promise<void> {
  if (ui().phase === "running" || ui().fixing) return;
  const run = ++activeRun;
  ui().patch({
    phase: "running",
    label: "Starting…",
    stepsDone: 0,
    stepsTotal: 0,
    pairs: [],
    fixLog: [],
    fixing: false,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    cancelRequested: false,
  });
  const savedAuto = useStore.getState().songSyncAuto;
  useStore.setState({ songSyncAuto: false });
  try {
    const tracks = localTracks();
    const total = tracks.length; // n - 1 consecutive pairs, then the hardest jump
    ui().patch({ stepsTotal: total });
    const tested = new Set<string>();
    for (let i = 0; i < tracks.length - 1; i++) {
      if (cancelled(run)) throw new Error("cancelled");
      const a = tracks[i];
      const b = tracks[i + 1];
      ui().patch({ label: `Pair ${i + 1} of ${total}: ${a.title} → ${b.title}` });
      setPair(await runPair(a, b, "consecutive", i, run));
      tested.add(`${a.id}>${b.id}`);
      ui().patch({ stepsDone: i + 1 });
    }

    const analyses = useStore.getState().trackAnalysis;
    const hardest = pickHardestPair(
      tracks.map((t) => ({ id: t.id, bpm: analyses[t.id]?.bpm ?? 0, bpmConfidence: analyses[t.id]?.bpmConfidence ?? 0 })),
      tested
    );
    if (hardest) {
      const a = tracks.find((t) => t.id === hardest.from.id)!;
      const b = tracks.find((t) => t.id === hardest.to.id)!;
      ui().patch({ label: `Hardest jump (${hardest.gapBpm.toFixed(1)} BPM): ${a.title} → ${b.title}` });
      setPair(await runPair(a, b, "hardest", tracks.length - 1, run));
    }
    ui().patch({ stepsDone: total, phase: "done", label: "Done", finishedAt: Date.now() });
  } catch (e) {
    if (e instanceof Error && e.message === "cancelled") {
      ui().patch({ phase: ui().pairs.length > 0 ? "done" : "idle", label: "Stopped", finishedAt: Date.now(), cancelRequested: false });
    } else {
      ui().patch({ phase: "failed", label: "Failed", error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() });
    }
  } finally {
    restore(savedAuto);
  }
}

async function reanalyzeTrack(track: LocalTrack): Promise<string> {
  const store = useStore.getState();
  const saved = store.trackAnalysis[track.id];
  const before = saved ? `${saved.bpm.toFixed(1)} BPM at ${saved.bpmConfidence.toFixed(2)}` : "nothing saved";
  try {
    const fresh = await withTimeout(analyzeTrackFromUrl(track.sourceUrl), REANALYSIS_TIMEOUT_MS, "Re-analysis");
    const after = `${fresh.bpm.toFixed(1)} BPM at ${fresh.bpmConfidence.toFixed(2)}`;
    if (fresh.fallback) return `Re-read ${track.title}: it fell back to the neutral tempo again (${after}); kept what was saved (${before}).`;
    if (!saved || tempoChanged(saved, fresh) || fresh.bpmConfidence > saved.bpmConfidence) {
      store.setTrackAnalysis(track.id, fresh);
      return `Re-read ${track.title}: ${before} to ${after}, saved.`;
    }
    store.setTrackSongMap(track.id, fresh.songMap ?? null);
    return `Re-read ${track.title}: the same tempo (${after}); nothing to save.`;
  } catch (e) {
    return `Re-read ${track.title} failed: ${e instanceof Error ? e.message : String(e)}.`;
  }
}

/**
 * "Fix Issues Automatically": re-reads the tempo of the tracks behind a tempo failure, runs stalled or hung pairs
 * again, and re-tests exactly those pairs, keeping each pair's earlier result beside the new one. What it cannot fix
 * (a lock a few ms over the limit, a pitch that stops short) is listed as needing an engine change, not hidden.
 */
export async function fixIssuesAutomatically(): Promise<void> {
  if (ui().phase === "running" || ui().fixing) return;
  const plan = planFixes(ui().pairs);
  const run = ++activeRun;
  const log: string[] = [];
  ui().patch({ fixing: true, cancelRequested: false, error: null, label: "Fixing…" });
  const savedAuto = useStore.getState().songSyncAuto;
  useStore.setState({ songSyncAuto: false });
  try {
    if (plan.rerun.length === 0) {
      log.push("Nothing to fix automatically.");
    }
    const tracks = localTracks();
    for (const id of plan.reanalyze) {
      const track = tracks.find((t) => t.id === id);
      if (!track) continue;
      ui().patch({ label: `Re-reading the tempo of ${track.title}…` });
      log.push(await reanalyzeTrack(track));
      ui().patch({ fixLog: [...log] });
    }
    for (const index of plan.rerun) {
      const before = ui().pairs.find((p) => p.index === index);
      if (!before) continue;
      const a = tracks.find((t) => t.id === before.fromId);
      const b = tracks.find((t) => t.id === before.toId);
      if (!a || !b) continue;
      ui().patch({ label: `Re-testing ${a.title} → ${b.title}` });
      const result = await runPair(a, b, before.kind, index, run);
      const earlier = before.before ?? { status: before.status, outcome: before.outcome, stages: before.stages };
      setPair({ ...result, before: earlier });
      log.push(`Pair ${index + 1} (${a.title} to ${b.title}): ${earlier.status.toUpperCase()} before, ${result.status.toUpperCase()} after.`);
      ui().patch({ fixLog: [...log] });
    }
    log.push(...plan.manual);
    ui().patch({ fixLog: [...log], fixing: false, label: "Done", finishedAt: Date.now() });
  } catch (e) {
    if (!(e instanceof Error && e.message === "cancelled")) log.push(`The fix stopped: ${e instanceof Error ? e.message : String(e)}`);
    log.push(...plan.manual);
    ui().patch({ fixLog: [...log], fixing: false, label: "Stopped", cancelRequested: false });
  } finally {
    restore(savedAuto);
  }
}

/** The log as text plus its file name, for the Export button. */
export function buildExport(): { fileName: string; text: string } {
  const s = ui();
  return {
    fileName: exportFileName(),
    text: formatLog({
      startedAt: s.startedAt ?? Date.now(),
      finishedAt: s.finishedAt,
      playlistName: SYNC_TEST_PLAYLIST_NAME,
      pairs: s.pairs,
      fixLog: s.fixLog,
      userAgent: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    }),
  };
}

/**
 * Hands the log to the person: the share sheet on a touch device that can share files, a plain download otherwise
 * (a desktop share dialog for a text file would only be in the way). Resolves to how it was delivered.
 */
export async function exportLog(): Promise<"shared" | "downloaded"> {
  const { fileName, text } = buildExport();
  const file = new File([text], fileName, { type: "text/plain" });
  const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  if (touch && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "DJ Claude sync test" });
      return "shared";
    } catch {
      // Dismissed or refused: fall through to the download so the log is not lost.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
