"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { createPlayAccumulator, type NowPlaying } from "@/lib/playReporter";

const LOOK_EVERY_MS = 1000;
const SEND_EVERY_MS = 30_000;

/**
 * Reports how long music is played, for the admin's listening statistics. Renders nothing. Once a second it looks at what is
 * playing (and which playlist it was started from) and every 30 seconds, when the tab is hidden, and when the page closes it sends
 * what has built up to /api/stats/play. A failed send is dropped: statistics must never get in the way of the music.
 */
export function PlayStatsReporter() {
  useEffect(() => {
    const acc = createPlayAccumulator();

    function nowPlaying(): NowPlaying | null {
      const s = useStore.getState();
      const track = s.currentTrack;
      // YouTube imports are gone, and a song that is not a stored file has nothing to attribute.
      if (!s.isPlaying || !track || track.source !== "local") return null;
      return { trackId: track.id, playlistId: s.activePlaylistId };
    }

    function look() {
      acc.tick(Date.now(), nowPlaying());
    }

    function send(leaving: boolean) {
      look();
      const segments = acc.drain();
      if (segments.length === 0) return;
      const body = JSON.stringify({ segments });
      if (leaving && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/stats/play", new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch("/api/stats/play", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    }

    const lookTimer = window.setInterval(look, LOOK_EVERY_MS);
    const sendTimer = window.setInterval(() => send(false), SEND_EVERY_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") send(true);
    };
    const onLeave = () => send(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.clearInterval(lookTimer);
      window.clearInterval(sendTimer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
      send(true);
    };
  }, []);

  return null;
}
