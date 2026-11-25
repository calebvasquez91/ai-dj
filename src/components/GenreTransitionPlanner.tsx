"use client";

import { useEffect, useRef } from "react";
import { detectAbruptEnding } from "@/lib/echoOut";
import { ECHO_OUT_ENABLED, GENRE_TRANSITIONS_ENABLED } from "@/lib/featureFlags";
import type { PairGenrePlan } from "@/lib/genrePlanApply";
import { buildMixabilityReport } from "@/lib/mixability";
import { useStore } from "@/lib/store";
import { buildSyncReport } from "@/lib/syncEngine";
import { PLAN_LEAD_SEC, decideTransition, type AskDj } from "@/lib/transitionChoice";
import { describeGenrePlan, rankTransitions } from "@/lib/transitionPlanner";

/** Asks the server's Haiku route to choose between two close plans. Any problem is null: the DJ keeps its local winner. */
const askServer: AskDj = async (request) => {
  try {
    const res = await fetch("/api/dj/transition-pick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    if (!res.ok) return null;
    const body = (await res.json()) as { answer?: { style: string; reason: string } | null };
    return body.answer ?? null;
  } catch {
    return null;
  }
};

/**
 * Makes the genre-aware plan for the upcoming pair, 60 to 90 seconds before the mix, so no decision waits for the end of the song: the Audio Engineer
 * reads the pair, the DJ picks among the plans it did not veto, and the result goes into the store (genrePlan), where planArgsFromState hands it to the
 * existing transition engine and the "Mixing into" pill and the DJ readout show it. Renders nothing, and does nothing at all while
 * GENRE_TRANSITIONS_ENABLED is off.
 */
export function GenreTransitionPlanner() {
  const currentTrack = useStore((s) => s.currentTrack);
  const nextTrack = useStore((s) => s.queue[0] ?? null);
  const currentAnalysis = useStore((s) => (s.currentTrack ? s.trackAnalysis[s.currentTrack.id] : undefined));
  const nextAnalysis = useStore((s) => (s.queue[0] ? s.trackAnalysis[s.queue[0].id] : undefined));
  const withinLead = useStore((s) => (s.currentTrack && s.currentTrack.durationSec > 0 ? s.currentTrack.durationSec - s.currentTimeSec <= PLAN_LEAD_SEC.max : false));
  const plannedPair = useRef<string | null>(null);

  useEffect(() => {
    if (!GENRE_TRANSITIONS_ENABLED || !withinLead || !currentTrack || !nextTrack) return;
    if (!currentAnalysis || currentAnalysis.fallback || !nextAnalysis || nextAnalysis.fallback) return;
    const pair = `${currentTrack.id}>${nextTrack.id}`;
    if (plannedPair.current === pair) return;
    plannedPair.current = pair;

    void (async () => {
      const current = { track: currentTrack, analysis: currentAnalysis };
      const next = { track: nextTrack, analysis: nextAnalysis };
      // Read-only: the same report the sync pipeline builds, used here only for the tempo and key facts.
      const syncReport = buildSyncReport({ current, next });
      const mixability = buildMixabilityReport({
        a: currentAnalysis,
        b: nextAnalysis,
        durationA: currentTrack.durationSec,
        durationB: nextTrack.durationSec,
        mixOutSec: syncReport.mixOutMs / 1000,
        mixInSec: syncReport.mixInMs / 1000,
      });
      const abruptEnding = ECHO_OUT_ENABLED && detectAbruptEnding(currentAnalysis, currentTrack.durationSec).abrupt;
      const ranked = rankTransitions(currentTrack, nextTrack, syncReport, { djMode: useStore.getState().djMode }, { abruptEnding });
      const decision = await decideTransition({ ranked, mixability, ask: askServer });

      // Stale guard: a skip, reorder or shuffle while the answer was in flight means this plan is for a pair that is no longer up next.
      const latest = useStore.getState();
      if (latest.currentTrack?.id !== currentTrack.id || latest.queue[0]?.id !== nextTrack.id) return;

      const entry: PairGenrePlan = {
        fromId: currentTrack.id,
        toId: nextTrack.id,
        plan: decision.plan,
        mixability: decision.mixability.mixability,
        vetoes: decision.vetoes,
        decidedBy: decision.decidedBy,
        reason: decision.reason,
        readout: describeGenrePlan({ ...decision.plan, reason: decision.reason.replace(/\.$/, "") }),
      };
      latest.setGenrePlan(entry);
    })();
  }, [withinLead, currentTrack, nextTrack, currentAnalysis, nextAnalysis]);

  return null;
}
