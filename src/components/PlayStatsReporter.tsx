"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { createPlayAccumulator, type NowPlaying } from "@/lib/playReporter";

/** What has built up is sent once it reaches this many seconds, when playback pauses, and when the tab is hidden or the page closes. */
const SEND_AT_SECONDS = 30;

/**
 * Reports how long music is played, for the admin's listening statistics. Renders nothing and runs no timer: it reacts to the player's
 * own updates (the position moving while a song plays), so it costs nothing while nothing plays. Time is counted from how far the
 * playback position moved (see lib/playReporter.ts) and sent to /api/stats/play. A failed send is dropped: statistics must never get
 * in the way of the music.
 */
export function PlayStatsReporter() {
  useEffect(() => {
    const acc = createPlayAccumulator();

    function nowPlaying(): NowPlaying | null {
      const s = useStore.getState();
      const track = s.currentTrack;
      // Only a stored file has something to attribute (YouTube imports are gone).
      if (!s.isPlaying || !track || track.source !== "local") return null;
      return { trackId: track.id, playlistId: s.activePlaylistId, positionSec: s.currentTimeSec };
    }

    function send(leaving: boolean) {
      acc.observe(Date.now(), nowPlaying());
      const segments = acc.drain();
      if (segments.length === 0) return;
      const body = JSON.stringify({ segments });
      if (leaving && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/stats/play", new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch("/api/stats/play", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    }

    const unsubscribe = useStore.subscribe((state, prev) => {
      const changed =
        state.currentTimeSec !== prev.currentTimeSec ||
        state.isPlaying !== prev.isPlaying ||
        state.currentTrack?.id !== prev.currentTrack?.id ||
        state.activePlaylistId !== prev.activePlaylistId;
      if (!changed) return;
      acc.observe(Date.now(), nowPlaying());
      if (acc.pendingSeconds() >= SEND_AT_SECONDS || (prev.isPlaying && !state.isPlaying)) send(false);
    });
    const onHide = () => {
      if (document.visibilityState === "hidden") send(true);
    };
    const onLeave = () => send(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
      send(true);
    };
  }, []);

  return null;
}
