"use client";

import { useEffect } from "react";
import { VOCAL_SPLIT_ENABLED } from "@/lib/featureFlags";
import { loadInstrumentalMode } from "@/lib/instrumentalMode";
import { useStore } from "@/lib/store";
import type { VoiceMap } from "@/lib/voiceMap";

/**
 * Loads which songs have a built instrumental and when each one's lead vocal is present, and this device's Instrumental mode setting. Renders nothing, and does
 * nothing at all while VOCAL_SPLIT_ENABLED is off. The vocal activity fills the voice maps the vocal swap is planned from (a song that already has one keeps it).
 */
export function InstrumentalLoader() {
  useEffect(() => {
    if (!VOCAL_SPLIT_ENABLED) return;
    useStore.getState().setInstrumentalMode(loadInstrumentalMode());
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stems/instrumentals");
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { instrumentals?: Record<string, string>; activity?: Record<string, VoiceMap> };
        const state = useStore.getState();
        state.setInstrumentalAvailability(body.instrumentals ?? {});
        for (const [trackId, map] of Object.entries(body.activity ?? {})) if (!state.trackVoiceMaps[trackId]) state.setTrackVoiceMap(trackId, map);
      } catch {
        // offline or signed out: no instrumentals, and every song plays as it always does
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
