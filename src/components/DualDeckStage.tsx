"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  AUTO_DJ_OFF_FADE_SEC,
  computeCrossfadeWindowSec,
  equalPowerGains,
} from "@/lib/mixEngine";
import type { Track } from "@/types/music";

type DeckId = "A" | "B";

interface ActiveTransition {
  fromDeckId: DeckId;
  toDeckId: DeckId;
  startTime: number;
  durationMs: number;
  tickIntervalId: ReturnType<typeof setInterval> | null;
}

const TICK_INTERVAL_MS = 100;

export function DualDeckStage() {
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const loadedTrackId = useRef<Record<DeckId, string | null>>({ A: null, B: null });
  const transitionRef = useRef<ActiveTransition | null>(null);
  const activeDeckRef = useRef<DeckId>("A");

  const [activeDeck, setActiveDeck] = useState<DeckId>("A");

  const currentTrack = useStore((s) => s.currentTrack);
  const isPlaying = useStore((s) => s.isPlaying);
  const volume = useStore((s) => s.volume);
  const seekRequest = useStore((s) => s.seekRequest);
  const clearSeekRequest = useStore((s) => s.clearSeekRequest);

  const deckEl = useCallback(
    (id: DeckId): HTMLAudioElement | null =>
      id === "A" ? audioARef.current : audioBRef.current,
    []
  );

  useEffect(() => {
    activeDeckRef.current = activeDeck;
  }, [activeDeck]);

  const cancelTransition = useCallback(() => {
    const t = transitionRef.current;
    if (!t) return;
    if (t.tickIntervalId != null) clearInterval(t.tickIntervalId);
    const toEl = deckEl(t.toDeckId);
    if (toEl) {
      toEl.pause();
      toEl.volume = 0;
    }
    loadedTrackId.current[t.toDeckId] = null;
    transitionRef.current = null;
    useStore.getState().setIsTransitioning(false);
    const fromEl = deckEl(t.fromDeckId);
    if (fromEl) fromEl.volume = useStore.getState().volume;
  }, [deckEl]);

  // Unlike YouTube's iframe player, <audio> elements are plain React-managed
  // DOM nodes, so no detached-mount workaround is needed here.
  useEffect(() => {
    function handleEnded(deckId: DeckId) {
      if (transitionRef.current) return;
      if (deckId !== activeDeckRef.current) return;
      useStore.getState().next();
    }

    function startTransition(nextTrack: Track, windowSec: number) {
      if (transitionRef.current) return;
      const fromDeckId = activeDeckRef.current;
      const toDeckId: DeckId = fromDeckId === "A" ? "B" : "A";
      const fromEl = deckEl(fromDeckId);
      const toEl = deckEl(toDeckId);
      if (!fromEl || !toEl) return;

      loadedTrackId.current[toDeckId] = nextTrack.id;
      toEl.src = nextTrack.sourceUrl;
      toEl.currentTime = 0;
      toEl.volume = 0;
      toEl.play().catch(() => {});

      const transition: ActiveTransition = {
        fromDeckId,
        toDeckId,
        startTime: performance.now(),
        durationMs: Math.max(1, windowSec) * 1000,
        tickIntervalId: null,
      };
      transitionRef.current = transition;
      useStore.getState().setIsTransitioning(true);

      // Driven by setInterval rather than requestAnimationFrame: rAF is
      // throttled to a stop in backgrounded tabs, which would leave a
      // crossfade started right before the user tabs away stuck forever.
      const tick = () => {
        const t = transitionRef.current;
        if (!t) return;
        const elapsed = performance.now() - t.startTime;
        const progress = Math.min(1, elapsed / t.durationMs);
        const { outGain, inGain } = equalPowerGains(progress);
        const masterVolume = useStore.getState().volume;
        const fEl = deckEl(t.fromDeckId);
        const tEl = deckEl(t.toDeckId);
        if (fEl) fEl.volume = outGain * masterVolume;
        if (tEl) tEl.volume = inGain * masterVolume;
        if (progress >= 1) {
          if (t.tickIntervalId != null) clearInterval(t.tickIntervalId);
          completeTransition(t);
        }
      };
      transition.tickIntervalId = setInterval(tick, TICK_INTERVAL_MS);
      tick();
    }

    function completeTransition(t: ActiveTransition) {
      const fromEl = deckEl(t.fromDeckId);
      if (fromEl) {
        fromEl.pause();
        fromEl.volume = 0;
      }
      loadedTrackId.current[t.fromDeckId] = null;
      transitionRef.current = null;
      activeDeckRef.current = t.toDeckId;
      setActiveDeck(t.toDeckId);
      useStore.getState().setIsTransitioning(false);
      useStore.getState().next();
    }

    function tryAutoTransition() {
      if (transitionRef.current) return;
      const state = useStore.getState();
      const track = state.currentTrack;
      const nextTrack = state.queue[0];
      if (!track || !nextTrack) return;
      const activeEl = deckEl(activeDeckRef.current);
      if (!activeEl) return;
      const duration = activeEl.duration;
      if (!duration || !Number.isFinite(duration)) return;
      const currentTime = activeEl.currentTime;
      const windowSec = state.autoDjEnabled
        ? computeCrossfadeWindowSec(track, nextTrack, state.crossfadeOverrideSec)
        : AUTO_DJ_OFF_FADE_SEC;
      const clampedWindow = Math.min(windowSec, duration / 2);
      if (duration - currentTime <= clampedWindow) {
        startTransition(nextTrack, clampedWindow);
      }
    }

    const interval = setInterval(() => {
      const activeEl = deckEl(activeDeckRef.current);
      if (activeEl) {
        useStore.getState().setCurrentTime(activeEl.currentTime);
      }
      tryAutoTransition();
    }, 500);

    const unsubscribe = useStore.subscribe((state, prevState) => {
      if (state.mixNowRequestId === prevState.mixNowRequestId) return;
      if (transitionRef.current) return;
      const track = state.currentTrack;
      const nextTrack = state.queue[0];
      if (!track || !nextTrack) return;
      const windowSec = computeCrossfadeWindowSec(
        track,
        nextTrack,
        state.crossfadeOverrideSec
      );
      startTransition(nextTrack, windowSec);
    });

    const elA = audioARef.current;
    const elB = audioBRef.current;
    const onEndedA = () => handleEnded("A");
    const onEndedB = () => handleEnded("B");
    elA?.addEventListener("ended", onEndedA);
    elB?.addEventListener("ended", onEndedB);

    return () => {
      clearInterval(interval);
      unsubscribe();
      if (transitionRef.current?.tickIntervalId != null) {
        clearInterval(transitionRef.current.tickIntervalId);
      }
      transitionRef.current = null;
      elA?.removeEventListener("ended", onEndedA);
      elB?.removeEventListener("ended", onEndedB);
    };
  }, [deckEl]);

  // External track changes (library/queue click, next/previous, playlist
  // play) land here. Transitions we drive ourselves already have the new
  // deck's loadedTrackId pre-set to match, so this effect is a no-op for
  // those and only does real work for genuinely new external picks.
  useEffect(() => {
    if (!currentTrack) return;
    if (loadedTrackId.current[activeDeck] === currentTrack.id) return;

    cancelTransition();

    const idleId: DeckId = activeDeck === "A" ? "B" : "A";
    const idleEl = deckEl(idleId);
    if (idleEl) {
      idleEl.pause();
      idleEl.volume = 0;
      idleEl.removeAttribute("src");
      idleEl.load();
    }
    loadedTrackId.current[idleId] = null;

    loadedTrackId.current[activeDeck] = currentTrack.id;
    const activeEl = deckEl(activeDeck);
    if (!activeEl) return;
    activeEl.volume = useStore.getState().volume;
    activeEl.src = currentTrack.sourceUrl;
    if (useStore.getState().isPlaying) {
      activeEl.play().catch(() => {});
    }
  }, [currentTrack, activeDeck, cancelTransition, deckEl]);

  useEffect(() => {
    const activeEl = deckEl(activeDeck);
    if (!activeEl || !currentTrack) return;
    if (isPlaying) {
      activeEl.play().catch(() => {});
    } else {
      activeEl.pause();
    }
  }, [isPlaying, activeDeck, currentTrack, deckEl]);

  useEffect(() => {
    if (transitionRef.current) return;
    const activeEl = deckEl(activeDeck);
    if (activeEl) activeEl.volume = volume;
  }, [volume, activeDeck, deckEl]);

  useEffect(() => {
    if (seekRequest == null) return;
    cancelTransition();
    const activeEl = deckEl(activeDeck);
    if (activeEl) activeEl.currentTime = seekRequest;
    clearSeekRequest();
  }, [seekRequest, activeDeck, clearSeekRequest, cancelTransition, deckEl]);

  return (
    <>
      <audio ref={audioARef} preload="auto" className="hidden" />
      <audio ref={audioBRef} preload="auto" className="hidden" />
    </>
  );
}
