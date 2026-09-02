"use client";

// Spotify-backed equivalent of DualDeckStage.tsx / YouTubeDeckStage.tsx —
// but structurally simpler than the YouTube stage, because the Spotify Web
// Playback SDK only allows ONE local player/device per page (a second
// instance errors with "Instance not active", and there's no supported
// crossfade path — confirmed via Spotify's own engineering blog and
// community threads). So unlike YouTube's two-deck overlapping crossfade,
// every transition here — Spotify-to-Spotify included — is a single-deck
// fade-to-silence, track swap via the Web API, then fade back in. Requires
// the connecting account to have Spotify Premium; the SDK plays nothing at
// all for a free account.
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { equalPowerGains } from "@/lib/mix-engine";
import { getValidSpotifyToken } from "@/lib/spotifyAuth";
import type { SpotifyTrack } from "@/types/music";

interface SpotifyPlayerState {
  paused: boolean;
  position: number; // ms
  duration: number; // ms
}

interface SpotifyPlayer {
  connect: () => Promise<boolean>;
  addListener: (event: string, cb: (data: unknown) => void) => void;
  getCurrentState: () => Promise<SpotifyPlayerState | null>;
  setVolume: (volume: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
}

interface SpotifyNamespace {
  Player: new (config: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyPlayer;
}

declare global {
  interface Window {
    Spotify?: SpotifyNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkPromise: Promise<SpotifyNamespace> | null = null;

function loadSpotifySdk(): Promise<SpotifyNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("Not in a browser."));
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve) => {
    const previous = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      previous?.();
      resolve(window.Spotify!);
    };
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** No overlap is possible (see file header), so a transition is always fade-out, swap, fade-in — these two windows replace what would otherwise be one crossfade window on an engine that supports overlap. */
const FADE_OUT_SEC = 3;
const FADE_IN_SEC = 1.5;
const MIX_NOW_FADE_OUT_SEC = 1.5;
const TICK_MS = 200;

interface ActiveFade {
  phase: "out" | "in";
  startTime: number; // performance.now()
  durationMs: number;
  nextTrackId: string | null; // null = nothing queued, just fading to silence
}

export function SpotifyDeckStage() {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const pendingLoadRef = useRef<{ trackId: string; play: boolean } | null>(null);
  const loadedTrackId = useRef<string | null>(null);
  const fadeRef = useRef<ActiveFade | null>(null);
  const [sdkReady, setSdkReady] = useState(false);

  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const isPlaying = useStore((s) => s.isPlaying);
  const volume = useStore((s) => s.volume);
  const seekRequest = useStore((s) => s.seekRequest);
  const clearSeekRequest = useStore((s) => s.clearSeekRequest);

  const anySpotifyReachable =
    currentTrack?.source === "spotify" || queue.some((t) => t.source === "spotify");

  // Only pull in the SDK once a Spotify track is actually reachable.
  useEffect(() => {
    if (!anySpotifyReachable || sdkReady) return;
    let cancelled = false;
    loadSpotifySdk().then(() => {
      if (!cancelled) setSdkReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [anySpotifyReachable, sdkReady]);

  const putPlay = useCallback(async (trackId: string, positionMs = 0) => {
    const deviceId = deviceIdRef.current;
    const token = await getValidSpotifyToken();
    if (!deviceId || !token) return;
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [`spotify:track:${trackId}`], position_ms: positionMs }),
    });
  }, []);

  const loadAndPlay = useCallback(
    async (trackId: string, play: boolean) => {
      if (!readyRef.current) {
        pendingLoadRef.current = { trackId, play };
        return;
      }
      loadedTrackId.current = trackId;
      await putPlay(trackId);
      if (!play) await playerRef.current?.pause().catch(() => {});
    },
    [putPlay]
  );

  // Create the single player instance once the SDK script is loaded.
  useEffect(() => {
    if (!sdkReady || playerRef.current) return;
    const Spotify = window.Spotify;
    if (!Spotify) return;

    const player = new Spotify.Player({
      name: "AI DJ",
      getOAuthToken: (cb) => {
        void getValidSpotifyToken().then((token) => cb(token ?? ""));
      },
      volume: useStore.getState().volume,
    });
    player.addListener("ready", (data) => {
      const { device_id } = data as { device_id: string };
      deviceIdRef.current = device_id;
      readyRef.current = true;
      const pending = pendingLoadRef.current;
      if (pending) {
        pendingLoadRef.current = null;
        void loadAndPlay(pending.trackId, pending.play);
      }
    });
    player.addListener("not_ready", () => {
      readyRef.current = false;
    });
    void player.connect();
    playerRef.current = player;
  }, [sdkReady, loadAndPlay]);

  // Track-load: mirrors DualDeckStage's/YouTubeDeckStage's external
  // track-change effect, just for a single deck.
  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.source !== "spotify") {
      playerRef.current?.pause().catch(() => {});
      return;
    }
    if (fadeRef.current) return; // a fade already owns the swap
    if (loadedTrackId.current === currentTrack.spotifyTrackId) return;
    void loadAndPlay(currentTrack.spotifyTrackId, useStore.getState().isPlaying);
  }, [currentTrack, loadAndPlay]);

  useEffect(() => {
    if (!currentTrack || currentTrack.source !== "spotify") return;
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) void player.resume().catch(() => {});
    else void player.pause().catch(() => {});
  }, [isPlaying, currentTrack]);

  useEffect(() => {
    if (!currentTrack || currentTrack.source !== "spotify" || fadeRef.current) return;
    void playerRef.current?.setVolume(volume).catch(() => {});
  }, [volume, currentTrack]);

  useEffect(() => {
    if (seekRequest == null || currentTrack?.source !== "spotify") return;
    void playerRef.current?.seek(seekRequest * 1000).catch(() => {});
    clearSeekRequest();
  }, [seekRequest, currentTrack, clearSeekRequest]);

  const startFade = useCallback((nextTrackId: string | null, durationSec: number) => {
    if (fadeRef.current) return;
    fadeRef.current = {
      phase: "out",
      startTime: performance.now(),
      durationMs: Math.max(200, durationSec * 1000),
      nextTrackId,
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const state = useStore.getState();
      if (state.currentTrack?.source !== "spotify") return;
      const player = playerRef.current;
      if (!player || !readyRef.current) return;

      const fade = fadeRef.current;
      if (fade) {
        const progress = Math.min(1, (performance.now() - fade.startTime) / fade.durationMs);
        const gain = fade.phase === "out" ? equalPowerGains(progress).outGain : equalPowerGains(progress).inGain;
        void player.setVolume(gain * state.volume).catch(() => {});
        if (progress >= 1) {
          if (fade.phase === "out") {
            if (fade.nextTrackId) {
              loadedTrackId.current = fade.nextTrackId;
              void putPlay(fade.nextTrackId).then(() => {
                fadeRef.current = { phase: "in", startTime: performance.now(), durationMs: FADE_IN_SEC * 1000, nextTrackId: null };
              });
            } else {
              fadeRef.current = null;
            }
            useStore.getState().next();
          } else {
            fadeRef.current = null;
          }
        }
        return;
      }

      void player.getCurrentState().then((playbackState) => {
        if (!playbackState || fadeRef.current) return;
        const currentTime = playbackState.position / 1000;
        const duration = playbackState.duration / 1000;
        useStore.getState().setCurrentTime(currentTime);
        if (!duration) return;

        const nextTrack = state.queue[0];
        const remaining = duration - currentTime;
        if (!nextTrack) {
          if (remaining <= FADE_OUT_SEC) startFade(null, remaining);
          return;
        }
        if (remaining <= FADE_OUT_SEC) {
          startFade(nextTrack.source === "spotify" ? (nextTrack as SpotifyTrack).spotifyTrackId : null, remaining);
        }
      });
    }, TICK_MS);

    const unsubscribe = useStore.subscribe((state, prevState) => {
      if (state.mixNowRequestId === prevState.mixNowRequestId) return;
      if (fadeRef.current) return;
      const track = state.currentTrack;
      const nextTrack = state.queue[0];
      if (!track || track.source !== "spotify" || !nextTrack) return;
      startFade(nextTrack.source === "spotify" ? (nextTrack as SpotifyTrack).spotifyTrackId : null, MIX_NOW_FADE_OUT_SEC);
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [putPlay, startFade]);

  // No visible/audible DOM footprint of its own — the SDK plays audio via
  // its own internal (invisible) mechanism once connected, same spirit as
  // YouTubeDeckStage's hidden iframes.
  return null;
}
