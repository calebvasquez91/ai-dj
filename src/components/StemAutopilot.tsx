"use client";

import { useEffect, useRef, useState } from "react";
import { useStore, type StemPick } from "@/lib/store";
import { reachableTracks } from "@/lib/lookahead";
import { judgeStemCandidate } from "@/lib/stemPlanner";
import { planStemAutopilot, stemStateFromJob, type StemJobState } from "@/lib/stemAutopilot";
import { isVocalMashupPair, vocalMashupBeatsTheCap } from "@/lib/vocalMashup";
import { voiceCutoffSec } from "@/lib/voiceMap";
import type { StemSupport } from "@/lib/stemSupport";
import type { StemCounts } from "@/lib/stemStatus";

/** How many upcoming tracks the engineer looks at. Separation takes minutes per track, so it has to start well ahead. */
const STEM_LOOKAHEAD = 12;
/** How often a running job is checked. The GET advances it server-side; on https deployments Replicate also calls the webhook, so this is the fallback (and the only path in local dev). */
const POLL_MS = 20_000;
/** After the server says it is busy, wait this long before asking again. */
const BUSY_RETRY_MS = 45_000;
const MAX_PICKS_SHOWN = 6;

interface JobJson {
  status?: string;
  vocalsUrl?: string | null;
}

/**
 * The stem autopilot: the audio engineer (lib/stemPlanner.ts) judges the upcoming tracks, and — when switched on —
 * this starts a separation for the nearest worthwhile one that has none, one at a time, within the spending budget
 * the server enforces (STEM_AUTO_BUDGET_USD). Finished stems are handed to the DJ through the store's
 * stemAvailability, so the next transition decision sees them. Renders nothing; the Stems panel shows its status.
 */
export function StemAutopilot({ scope = "window" }: { scope?: "window" | "mashup-next" } = {}) {
  // "window" is the general autopilot (the paused Stems feature, its own on/off switch). "mashup-next" is the vocal
  // mashup's on-demand scope: only the NEXT track, only when it and the playing track form a mashable pair whose
  // outgoing voices end before the engine's active-play cap, and only while Mashups are switched on.
  const stemAutoEnabled = useStore((s) => s.stemAuto.enabled);
  const mashupEnabled = useStore((s) => s.mashupEnabled);
  const voiceMaps = useStore((s) => s.trackVoiceMaps);
  const enabled = scope === "mashup-next" ? mashupEnabled : stemAutoEnabled;
  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const trackAnalysis = useStore((s) => s.trackAnalysis);
  const fingerprints = useStore((s) => s.trackLyricalFingerprints);

  const statesRef = useRef<Record<string, StemJobState>>({});
  const startingRef = useRef<Set<string>>(new Set());
  const lookingRef = useRef<Set<string>>(new Set());
  const blockedRef = useRef<string | null>(null);
  const busyUntilRef = useRef(0);
  const summaryRef = useRef<{ spentUsd: number; budgetUsd: number; counts: StemCounts; support: StemSupport } | null>(null);
  const publishedRef = useRef("");
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  async function refreshSummary() {
    try {
      const res = await fetch("/api/stems/summary");
      if (!res.ok) return;
      const s = (await res.json()) as {
        spentUsd: number;
        budgetUsd: number;
        ready: number;
        inFlight: number;
        failed: number;
        support?: StemSupport;
      };
      summaryRef.current = {
        spentUsd: s.spentUsd,
        budgetUsd: s.budgetUsd,
        counts: { ready: s.ready, inFlight: s.inFlight, failed: s.failed },
        support: s.support ?? { available: true },
      };
      bump();
    } catch {
      // the numbers are informational
    }
  }

  function settle(id: string, job: JobJson | null) {
    const state = stemStateFromJob(job);
    statesRef.current[id] = state;
    if (state === "ready") useStore.getState().setStemAvailability(id, job?.vocalsUrl ?? null);
  }

  async function lookUp(id: string) {
    if (lookingRef.current.has(id)) return;
    lookingRef.current.add(id);
    try {
      const res = await fetch(`/api/tracks/${id}/stems`);
      if (res.ok) settle(id, (await res.json()) as JobJson | null);
      else statesRef.current[id] = "failed"; // don't hammer an endpoint that is erroring
    } catch {
      statesRef.current[id] = "failed";
    } finally {
      lookingRef.current.delete(id);
      bump();
    }
  }

  async function start(id: string) {
    if (startingRef.current.has(id)) return;
    startingRef.current.add(id);
    statesRef.current[id] = "processing";
    bump();
    try {
      const res = await fetch(`/api/tracks/${id}/stems?auto=1`, { method: "POST" });
      if (res.ok) {
        settle(id, (await res.json()) as JobJson);
      } else {
        statesRef.current[id] = "none";
        const body = (await res.json().catch(() => null)) as { error?: string; budgetUsd?: number } | null;
        if (res.status === 402) {
          blockedRef.current = `Automatic stems paused: the $${(body?.budgetUsd ?? 0).toFixed(2)} budget is used up. Raise STEM_AUTO_BUDGET_USD to continue.`;
        } else if (res.status === 429) {
          busyUntilRef.current = Date.now() + BUSY_RETRY_MS;
          setTimeout(bump, BUSY_RETRY_MS + 100);
        } else {
          blockedRef.current = `Automatic stems paused: ${body?.error ?? `the server answered ${res.status}`}`;
        }
      }
    } catch {
      statesRef.current[id] = "none";
      blockedRef.current = "Automatic stems paused: couldn't reach the server.";
    } finally {
      startingRef.current.delete(id);
      bump();
      void refreshSummary();
    }
  }

  // Switching it on (again) clears an earlier pause, so you can retry after fixing the cause.
  useEffect(() => {
    blockedRef.current = null;
    busyUntilRef.current = 0;
    // (The decision effect below re-runs on `enabled` by itself.) The summary is fetched a tick later, not inline —
    // also while switched off, so the panel can say how many stems are ready and whether this server can make any.
    const timer = setTimeout(() => void refreshSummary(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Decide: judge the upcoming tracks, publish the status, and (when on) look things up and start one job.
  useEffect(() => {
    let window = reachableTracks(currentTrack, queue, STEM_LOOKAHEAD);
    if (scope === "mashup-next") {
      const next = queue[0];
      const currentAnalysis = currentTrack ? trackAnalysis[currentTrack.id] : undefined;
      const nextAnalysis = next ? trackAnalysis[next.id] : undefined;
      const mashable =
        currentTrack != null &&
        next != null &&
        currentTrack.source === "local" &&
        next.source === "local" &&
        currentAnalysis != null &&
        !currentAnalysis.fallback &&
        nextAnalysis != null &&
        !nextAnalysis.fallback &&
        isVocalMashupPair({ track: currentTrack, analysis: currentAnalysis }, { track: next, analysis: nextAnalysis }) &&
        vocalMashupBeatsTheCap(voiceCutoffSec(voiceMaps[currentTrack.id], currentTrack.durationSec));
      window = mashable ? [next] : [];
    }
    const verdicts = window.map((track) => {
      const verdict = judgeStemCandidate({
        track,
        analysis: trackAnalysis[track.id],
        hasLyrics: (fingerprints[track.id]?.words?.size ?? 0) > 0,
      });
      // The mashup scope doesn't need the engineer's "suits stems" score, only that the track is separable at all.
      return scope === "mashup-next" ? { ...verdict, worthIt: verdict.score > 0 } : verdict;
    });
    const titleOf = new Map(window.map((t) => [t.id, t.title]));
    const picks: StemPick[] = verdicts
      .filter((v) => v.worthIt)
      .slice(0, MAX_PICKS_SHOWN)
      .map((v) => ({
        trackId: v.trackId,
        title: titleOf.get(v.trackId) ?? "",
        score: v.score,
        worthIt: v.worthIt,
        reasons: v.reasons,
        state: statesRef.current[v.trackId] ?? "unknown",
      }));

    const running = verdicts.filter((v) => statesRef.current[v.trackId] === "processing").length;
    const support = summaryRef.current?.support;
    const unavailable = support && !support.available ? support : null;
    const state = unavailable
      ? "unavailable"
      : !enabled
        ? "off"
        : blockedRef.current
          ? "paused"
          : running > 0 || startingRef.current.size > 0
            ? "working"
            : "idle";
    const status = {
      state,
      message: unavailable ? unavailable.message : enabled ? blockedRef.current : null,
      picks,
      spentUsd: summaryRef.current?.spentUsd ?? null,
      budgetUsd: summaryRef.current?.budgetUsd ?? null,
      counts: summaryRef.current?.counts ?? null,
    } as const;
    const key = JSON.stringify(status);
    if (key !== publishedRef.current) {
      publishedRef.current = key;
      useStore.getState().setStemAutopilotStatus({ ...status, picks: [...status.picks], counts: status.counts && { ...status.counts } });
    }

    if (!enabled || blockedRef.current) return;
    const plan = planStemAutopilot({
      verdicts,
      states: statesRef.current,
      inFlight: running + startingRef.current.size,
    });
    for (const id of plan.check) void lookUp(id);
    // Existing stems are still looked up when this server can't make new ones; only the paid start is skipped.
    if (plan.start && !unavailable && Date.now() >= busyUntilRef.current) void start(plan.start);
    // lookUp/start are stable closures over refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope, voiceMaps, currentTrack, queue, trackAnalysis, fingerprints, tick]);

  // Poll running jobs: the GET both reports and advances a job.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      for (const [id, state] of Object.entries(statesRef.current)) {
        if (state !== "processing" || startingRef.current.has(id)) continue;
        void (async () => {
          try {
            const res = await fetch(`/api/tracks/${id}/stems`);
            if (!res.ok) return;
            const before = statesRef.current[id];
            settle(id, (await res.json()) as JobJson | null);
            if (statesRef.current[id] !== before) {
              bump();
              void refreshSummary();
            }
          } catch {
            // try again next time
          }
        })();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return null;
}
