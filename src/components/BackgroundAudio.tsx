"use client";

import { useEffect, useMemo, useRef } from "react";
import { useStore } from "@/lib/store";
import { mediaPositionState, silentWavDataUri } from "@/lib/backgroundAudio";

/** The Media Session API and the iOS audio session are not in every TypeScript DOM lib; typed here for what is used. */
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * Keeps the music alive when the screen locks or the app is backgrounded, and gives the OS something to show:
 *
 * 1. The iOS audio session is set to "playback" (Safari 16.4+), the category music apps use, so Web Audio keeps running
 *    with the screen locked and the silent switch on.
 * 2. A hidden, silent, looping <audio> element plays whenever music does. The mix runs through Web Audio, and during a
 *    Song Sync morph the playing track is handed from its <audio> element to the stretcher, so for several bars no media
 *    element was playing at all — which is when a locked phone stopped counting the page as playing audio and muted it
 *    while the app's own clock carried on. The keep-alive element is always there to be that media.
 * 3. The Media Session API tells the OS what is playing: title, artist, artwork, position, and play / pause / next /
 *    previous / seek buttons for the lock screen, notification shade, headphones and car.
 *
 * Renders only the hidden element; the rest is effects.
 */
export function BackgroundAudio() {
  const currentTrack = useStore((s) => s.currentTrack);
  const isPlaying = useStore((s) => s.isPlaying);
  const currentTimeSec = useStore((s) => s.currentTimeSec);
  const keepAliveRef = useRef<HTMLAudioElement>(null);
  const silence = useMemo(() => silentWavDataUri(), []);
  const wantSound = isPlaying && currentTrack != null;

  // (1) The audio session category.
  useEffect(() => {
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (!session) return;
    try {
      session.type = "playback";
    } catch {
      // an older WebKit with a partial implementation — the keep-alive element below still covers it
    }
  }, []);

  // (2) The keep-alive element follows play/pause, and is started again by the next touch if the browser refused it.
  useEffect(() => {
    const el = keepAliveRef.current;
    if (!el) return;
    function start() {
      if (el && el.paused) el.play().catch(() => {});
    }
    if (!wantSound) {
      el.pause();
      return;
    }
    start();
    const retry = () => {
      if (document.visibilityState === "visible") start();
    };
    window.addEventListener("pointerdown", retry, true);
    window.addEventListener("keydown", retry, true);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("pointerdown", retry, true);
      window.removeEventListener("keydown", retry, true);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [wantSound]);

  // (3a) What is playing.
  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: "AI DJ",
      artwork: currentTrack.thumbnailUrl
        ? [{ src: currentTrack.thumbnailUrl }]
        : [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
  }, [currentTrack]);

  // (3b) Whether it is playing, and how far in.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = !currentTrack ? "none" : isPlaying ? "playing" : "paused";
  }, [currentTrack, isPlaying]);

  const positionSecond = Math.floor(currentTimeSec);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;
    const state = mediaPositionState(currentTrack.durationSec, positionSecond);
    if (!state) return;
    try {
      navigator.mediaSession.setPositionState(state);
    } catch {
      // a browser that rejects it keeps showing no progress bar; nothing else depends on it
    }
  }, [currentTrack, positionSecond]);

  // (3c) The buttons. Handlers read the store when pressed, so they never go stale and are registered once.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => useStore.setState((s) => (s.currentTrack ? { isPlaying: true } : s))],
      ["pause", () => useStore.setState({ isPlaying: false })],
      ["stop", () => useStore.setState({ isPlaying: false })],
      ["nexttrack", () => useStore.getState().next()],
      ["previoustrack", () => useStore.getState().previous()],
      ["seekto", (details) => {
        if (details.seekTime != null) useStore.getState().requestSeek(details.seekTime);
      }],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // an action this browser doesn't support is simply not offered
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // nothing to undo
        }
      }
    };
  }, []);

  return <audio ref={keepAliveRef} src={silence} loop playsInline preload="auto" aria-hidden="true" tabIndex={-1} className="hidden" data-keepalive="true" />;
}
