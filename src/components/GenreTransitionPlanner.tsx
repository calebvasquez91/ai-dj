"use client";

import { useEffect, useRef } from "react";
import { detectAbruptEnding } from "@/lib/echoOut";
import { ECHO_OUT_ENABLED, GENRE_TRANSITIONS_ENABLED, VOCAL_SPLIT_ENABLED } from "@/lib/featureFlags";
import type { PairGenrePlan } from "@/lib/genrePlanApply";
import { buildMixabilityReport } from "@/lib/mixability";
import { planVocalSwap, vocalDensity } from "@/lib/vocalSwap";
import { useGenreTransitions } from "@/lib/genreTransitionStore";
import { useStore } from "@/lib/store";
import { buildSyncReport } from "@/lib/syncEngine";
import { PLAN_LEAD_SEC, decideTransition, type AskDj } from "@/lib/transitionChoice";
import { describeGenrePlan, rankTransitions } from "@/lib/transitionPlanner";

/** Asks the server's Haiku route to choose between two close plans. Any problem is null: the DJ keeps its local winner. */
/** Tells the server which kind of transition was chosen, for the admin's counts (genres and style only, never a title). Fire and forget: a failure costs only a log line. */
function logDecision(entry: PairGenrePlan): void {
  void fetch("/api/dj/transition-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromGenre: entry.plan.genrePair.a, toGenre: entry.plan.genrePair.b, style: entry.plan.style, decidedBy: entry.decidedBy, vetoes: entry.vetoes, mixability: entry.mixability }),
  }).catch(() => {});
}

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
  const switchedOn = useGenreTransitions((s) => s.settings.enabled && s.loaded);
  const enabled = GENRE_TRANSITIONS_ENABLED && switchedOn;

  // This device's saved switch and overrides, and the admin's shared edits.
  useEffect(() => {
    useGenreTransitions.getState().load();
    void useGenreTransitions.getState().loadShared();
  }, []);

  // Switched off here: any plan already made is dropped, so the engine and the pills go back to exactly what they were.
  useEffect(() => {
    if (!enabled && useStore.getState().genrePlan) useStore.getState().setGenrePlan(null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !withinLead || !currentTrack || !nextTrack) return;
    if (!currentAnalysis || currentAnalysis.fallback || !nextAnalysis || nextAnalysis.fallback) return;
    const pair = `${currentTrack.id}>${nextTrack.id}`;
    if (plannedPair.current === pair) return;
    plannedPair.current = pair;

    void (async () => {
      const current = { track: currentTrack, analysis: currentAnalysis };
      const next = { track: nextTrack, analysis: nextAnalysis };
      // Read-only: the same report the sync pipeline builds, used here only for the tempo and key facts.
      const syncReport = buildSyncReport({ current, next });
      const mixOutSec = syncReport.mixOutMs / 1000;
      const mixInSec = syncReport.mixInMs / 1000;
      const windowSec = Math.max(1, syncReport.crossfadeDurationMs / 1000);
      // Vocal activity (the voice maps built from the isolated vocal stems), when the stems are there. Unknown stays null: it never vetoes anything.
      const voiceMaps = useStore.getState().trackVoiceMaps;
      const outVoice = voiceMaps[currentTrack.id] ?? null;
      const inVoice = voiceMaps[nextTrack.id] ?? null;
      const mixability = buildMixabilityReport({
        a: currentAnalysis,
        b: nextAnalysis,
        durationA: currentTrack.durationSec,
        durationB: nextTrack.durationSec,
        mixOutSec,
        mixInSec,
        vocalDensityAtMixOut: vocalDensity(outVoice, mixOutSec, mixOutSec + windowSec),
        vocalDensityAtMixIn: vocalDensity(inVoice, mixInSec, mixInSec + windowSec),
      });
      // A vocal swap is only offered when both vocals have a gap to hand over in: never two lead vocals at once.
      const vocalSwap = VOCAL_SPLIT_ENABLED && outVoice && inVoice ? planVocalSwap({ outgoing: outVoice, incoming: inVoice, windowStartSec: mixOutSec, windowEndSec: mixOutSec + windowSec, incomingEntrySec: mixInSec }) : null;
      const abruptEnding = ECHO_OUT_ENABLED && detectAbruptEnding(currentAnalysis, currentTrack.durationSec).abrupt;
      const ranked = rankTransitions(currentTrack, nextTrack, syncReport, { djMode: useStore.getState().djMode }, { abruptEnding, rules: useGenreTransitions.getState().effectiveRules(), vocalSwapFeasible: VOCAL_SPLIT_ENABLED && outVoice && inVoice ? vocalSwap != null : undefined });
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
        vocalSwap: decision.plan.style === "vocal-swap" ? vocalSwap : null,
        decidedBy: decision.decidedBy,
        reason: decision.reason,
        readout: describeGenrePlan({ ...decision.plan, reason: decision.reason.replace(/\.$/, "") }),
      };
      latest.setGenrePlan(entry);
      logDecision(entry);
    })();
  }, [enabled, withinLead, currentTrack, nextTrack, currentAnalysis, nextAnalysis]);

  return null;
}
