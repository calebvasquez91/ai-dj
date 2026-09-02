"use client";

// YouTube-backed equivalent of DualDeckStage.tsx — two hidden IFrame Player
// instances instead of two <audio> elements. There's no raw audio buffer
// access through the official IFrame Player API, so this deliberately does
// NOT attempt anything DualDeckStage does with Web Audio (EQ, real
// BPM/key-matched blends, mashups, tempo ramps): transport control plus a
// basic volume crossfade is the ceiling here, not a first pass to improve
// later. Always mounted alongside DualDeckStage; each stage's effects are
// gated on `currentTrack.source` so exactly one of them owns playback at a
// time, and DualDeckStage's own background-analysis lookahead keeps running
// for upcoming local tracks even while a YouTube track is current.
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { equalPowerGains } from "@/lib/mix-engine";
import type { YouTubeTrack } from "@/types/music";

type DeckId = "A" | "B";

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  cueVideoById: (videoId: string) => void;
  loadVideoById: (videoId: string) => void;
  destroy: () => void;
}

interface YTPlayerEvent {
  target: YTPlayer;
  data?: number;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    config: {
      playerVars?: Record<string, number>;
      events?: {
        onReady?: (e: YTPlayerEvent) => void;
        onStateChange?: (e: YTPlayerEvent) => void;
        onError?: (e: YTPlayerEvent) => void;
      };
    }
  ) => YTPlayer;
  PlayerState: { ENDED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let iframeApiPromise: Promise<YTNamespace> | null = null;

function loadIframeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("Not in a browser."));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (iframeApiPromise) return iframeApiPromise;

  iframeApiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return iframeApiPromise;
}

/** How long a YouTube -> YouTube crossfade (or a fade-out into/out of a different-source track) takes. No beat-grid data exists for YouTube tracks, so unlike DualDeckStage this is always a fixed window, not sized from BPM. */
const YT_CROSSFADE_SEC = 6;
/** Shorter fixed window for the manual "Mix Now" button. */
const YT_MIX_NOW_SEC = 3;
const TICK_MS = 100;

interface ActiveFade {
  fromDeckId: DeckId;
  /** null = simple fade-to-silence (no next track, or the next track is a different source) — the queue still advances once it completes. */
  toDeckId: DeckId | null;
  startTime: number; // performance.now()
  durationMs: number;
}

export function YouTubeDeckStage() {
  const containerARef = useRef<HTMLDivElement>(null);
  const containerBRef = useRef<HTMLDivElement>(null);
  const playersRef = useRef<Record<DeckId, YTPlayer | null>>({ A: null, B: null });
  const playersReadyRef = useRef<Record<DeckId, boolean>>({ A: false, B: false });
  const pendingLoadRef = useRef<Record<DeckId, { videoId: string; play: boolean } | null>>({ A: null, B: null });
  const loadedVideoId = useRef<Record<DeckId, string | null>>({ A: null, B: null });
  const activeDeckRef = useRef<DeckId>("A");
  const fadeRef = useRef<ActiveFade | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [activeDeck, setActiveDeck] = useState<DeckId>("A");

  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const isPlaying = useStore((s) => s.isPlaying);
  const volume = useStore((s) => s.volume);
  const seekRequest = useStore((s) => s.seekRequest);
  const clearSeekRequest = useStore((s) => s.clearSeekRequest);

  const anyYouTubeReachable =
    currentTrack?.source === "youtube" || queue.some((t) => t.source === "youtube");

  useEffect(() => {
    activeDeckRef.current = activeDeck;
  }, [activeDeck]);

  const applyLoad = useCallback((id: DeckId, videoId: string, play: boolean) => {
    const player = playersRef.current[id];
    if (!player || !playersReadyRef.current[id]) {
      pendingLoadRef.current[id] = { videoId, play };
      return;
    }
    loadedVideoId.current[id] = videoId;
    if (play) player.loadVideoById(videoId);
    else player.cueVideoById(videoId);
  }, []);

  // Only pull in the (fairly heavy) IFrame API script and create the two
  // hidden players once a YouTube track is actually reachable — most
  // sessions never touch this component's real work at all.
  useEffect(() => {
    if (!anyYouTubeReachable || apiReady) return;
    let cancelled = false;
    loadIframeApi().then(() => {
      if (!cancelled) setApiReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [anyYouTubeReachable, apiReady]);

  useEffect(() => {
    if (!apiReady) return;
    const YT = window.YT;
    if (!YT || !containerARef.current || !containerBRef.current) return;

    (["A", "B"] as DeckId[]).forEach((id) => {
      if (playersRef.current[id]) return; // survives Strict Mode's double-invoke
      const container = id === "A" ? containerARef.current! : containerBRef.current!;
      playersRef.current[id] = new YT.Player(container, {
        playerVars: { controls: 0, disablekb: 1, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => {
            playersReadyRef.current[id] = true;
            const pending = pendingLoadRef.current[id];
            if (pending) {
              pendingLoadRef.current[id] = null;
              applyLoad(id, pending.videoId, pending.play);
            }
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED && id === activeDeckRef.current && !fadeRef.current) {
              useStore.getState().next();
            }
          },
        },
      });
    });
  }, [apiReady, applyLoad]);

  // Track-load: react to the current track becoming a YouTube track (or
  // changing to a different YouTube track) the same way DualDeckStage's own
  // external-track-change effect does for local files.
  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.source !== "youtube") {
      // Ownership belongs to DualDeckStage now — release both decks.
      (["A", "B"] as DeckId[]).forEach((id) => playersRef.current[id]?.pauseVideo());
      return;
    }
    if (fadeRef.current) return; // a crossfade already owns loading the idle deck
    if (loadedVideoId.current[activeDeck] === currentTrack.youtubeVideoId) return;

    const idleId: DeckId = activeDeck === "A" ? "B" : "A";
    playersRef.current[idleId]?.pauseVideo();
    loadedVideoId.current[idleId] = null;

    loadedVideoId.current[activeDeck] = currentTrack.youtubeVideoId;
    applyLoad(activeDeck, currentTrack.youtubeVideoId, useStore.getState().isPlaying);
    playersRef.current[activeDeck]?.setVolume(Math.round(useStore.getState().volume * 100));
  }, [currentTrack, activeDeck, applyLoad]);

  useEffect(() => {
    if (!currentTrack || currentTrack.source !== "youtube") return;
    const player = playersRef.current[activeDeck];
    if (!player) return;
    if (isPlaying) player.playVideo();
    else player.pauseVideo();
  }, [isPlaying, activeDeck, currentTrack]);

  useEffect(() => {
    if (!currentTrack || currentTrack.source !== "youtube" || fadeRef.current) return;
    playersRef.current[activeDeck]?.setVolume(Math.round(volume * 100));
  }, [volume, activeDeck, currentTrack]);

  useEffect(() => {
    if (seekRequest == null || currentTrack?.source !== "youtube") return;
    playersRef.current[activeDeck]?.seekTo(seekRequest, true);
    clearSeekRequest();
  }, [seekRequest, activeDeck, currentTrack, clearSeekRequest]);

  const startFade = useCallback(
    (toDeckId: DeckId | null, durationSec: number, nextTrack: YouTubeTrack | null) => {
      if (fadeRef.current) return;
      const fromDeckId = activeDeckRef.current;
      if (toDeckId && nextTrack) {
        loadedVideoId.current[toDeckId] = nextTrack.youtubeVideoId;
        applyLoad(toDeckId, nextTrack.youtubeVideoId, true);
        playersRef.current[toDeckId]?.setVolume(0);
      }
      fadeRef.current = { fromDeckId, toDeckId, startTime: performance.now(), durationMs: durationSec * 1000 };
    },
    [applyLoad]
  );

  // Core tick: position reporting + auto-transition lookahead + fade
  // progress, mirroring the shape of DualDeckStage's own 500ms/100ms loops
  // but on one interval since there's no beat-aligned automation to drive.
  useEffect(() => {
    const interval = setInterval(() => {
      const state = useStore.getState();
      if (state.currentTrack?.source !== "youtube") return;
      const activePlayer = playersRef.current[activeDeckRef.current];
      if (!activePlayer || !playersReadyRef.current[activeDeckRef.current]) return;

      const fade = fadeRef.current;
      if (fade) {
        const progress = Math.min(1, (performance.now() - fade.startTime) / fade.durationMs);
        const { outGain, inGain } = equalPowerGains(progress);
        const masterPct = state.volume * 100;
        playersRef.current[fade.fromDeckId]?.setVolume(Math.round(outGain * masterPct));
        if (fade.toDeckId) playersRef.current[fade.toDeckId]?.setVolume(Math.round(inGain * masterPct));
        if (progress >= 1) {
          playersRef.current[fade.fromDeckId]?.pauseVideo();
          fadeRef.current = null;
          if (fade.toDeckId) {
            activeDeckRef.current = fade.toDeckId;
            setActiveDeck(fade.toDeckId);
          }
          useStore.getState().next();
        }
        return;
      }

      const duration = activePlayer.getDuration();
      const currentTime = activePlayer.getCurrentTime();
      useStore.getState().setCurrentTime(currentTime);
      if (!duration || !Number.isFinite(duration)) return;

      const nextTrack = state.queue[0];
      const remaining = duration - currentTime;
      if (!nextTrack) {
        if (remaining <= YT_CROSSFADE_SEC) startFade(null, Math.max(0.5, remaining), null);
        return;
      }
      if (remaining <= YT_CROSSFADE_SEC) {
        startFade(
          nextTrack.source === "youtube" ? activeDeckRef.current === "A" ? "B" : "A" : null,
          Math.max(0.5, remaining),
          nextTrack.source === "youtube" ? nextTrack : null
        );
      }
    }, TICK_MS);

    const unsubscribe = useStore.subscribe((state, prevState) => {
      if (state.mixNowRequestId === prevState.mixNowRequestId) return;
      if (fadeRef.current) return;
      const track = state.currentTrack;
      const nextTrack = state.queue[0];
      if (!track || track.source !== "youtube" || !nextTrack) return;
      startFade(
        nextTrack.source === "youtube" ? (activeDeckRef.current === "A" ? "B" : "A") : null,
        nextTrack.source === "youtube" ? YT_MIX_NOW_SEC : Math.min(YT_MIX_NOW_SEC, 1.5),
        nextTrack.source === "youtube" ? nextTrack : null
      );
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [startFade]);

  return (
    <div className="hidden">
      <div ref={containerARef} />
      <div ref={containerBRef} />
    </div>
  );
}
