"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { AUTO_DJ_OFF_FADE_SEC, equalPowerCurves, planSimpleFade, planTransition, type TransitionPlan } from "@/lib/mix-engine";
import { analyzeTrackFromUrl, fallbackAnalysis, type TrackAnalysis } from "@/lib/audio-analysis";
import type { Track } from "@/types/music";

type DeckId = "A" | "B";

interface ActiveTransition {
  fromDeckId: DeckId;
  toDeckId: DeckId;
  startTime: number;
  durationMs: number;
  tempoSync: boolean;
  tempoRatioStart: number;
  tickIntervalId: ReturnType<typeof setInterval> | null;
}

interface DeckNodes {
  source: MediaElementAudioSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  delaySend: GainNode;
  delay: DelayNode;
  delayFeedback: GainNode;
}

const TICK_INTERVAL_MS = 100;
const ECHO_DELAY_SEC = 0.22;
const ECHO_FEEDBACK = 0.35;
const ECHO_WET_LEVEL = 0.6;

export function DualDeckStage() {
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const deckNodesRef = useRef<Record<DeckId, DeckNodes | null>>({ A: null, B: null });
  const loadedTrackId = useRef<Record<DeckId, string | null>>({ A: null, B: null });
  const transitionRef = useRef<ActiveTransition | null>(null);
  const activeDeckRef = useRef<DeckId>("A");
  const analyzingRef = useRef<Set<string>>(new Set());

  const [activeDeck, setActiveDeck] = useState<DeckId>("A");

  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const isPlaying = useStore((s) => s.isPlaying);
  const volume = useStore((s) => s.volume);
  const seekRequest = useStore((s) => s.seekRequest);
  const clearSeekRequest = useStore((s) => s.clearSeekRequest);

  const deckEl = useCallback(
    (id: DeckId): HTMLAudioElement | null => (id === "A" ? audioARef.current : audioBRef.current),
    []
  );

  useEffect(() => {
    activeDeckRef.current = activeDeck;
  }, [activeDeck]);

  const resetDeckNodes = useCallback((id: DeckId, gainValue: number) => {
    const ctx = audioCtxRef.current;
    const nodes = deckNodesRef.current[id];
    if (!ctx || !nodes) return;
    const now = ctx.currentTime;
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.gain.gain.setValueAtTime(gainValue, now);
    nodes.filter.type = "allpass";
    nodes.delaySend.gain.cancelScheduledValues(now);
    nodes.delaySend.gain.setValueAtTime(0, now);
  }, []);

  const cancelTransition = useCallback(() => {
    const t = transitionRef.current;
    if (!t) return;
    if (t.tickIntervalId != null) clearInterval(t.tickIntervalId);
    const toEl = deckEl(t.toDeckId);
    if (toEl) {
      toEl.pause();
      toEl.playbackRate = 1;
    }
    resetDeckNodes(t.toDeckId, 0);
    resetDeckNodes(t.fromDeckId, 1);
    loadedTrackId.current[t.toDeckId] = null;
    transitionRef.current = null;
    useStore.getState().setIsTransitioning(false);
  }, [deckEl, resetDeckNodes]);

  // Background analysis: as soon as a track is reachable (now playing or
  // queued), estimate its BPM/beat-grid/energy-onset/key so a mix engine
  // decision is ready before Mix Now or an auto-transition needs it.
  useEffect(() => {
    const tracks = currentTrack ? [currentTrack, ...queue] : queue;
    for (const track of tracks) {
      const state = useStore.getState();
      if (state.trackAnalysis[track.id] || analyzingRef.current.has(track.id)) continue;
      analyzingRef.current.add(track.id);
      state.startAnalyzing(track.id);
      analyzeTrackFromUrl(track.sourceUrl)
        .then((analysis) => useStore.getState().setTrackAnalysis(track.id, analysis))
        .catch(() => useStore.getState().setTrackAnalysis(track.id, fallbackAnalysis()))
        .finally(() => {
          analyzingRef.current.delete(track.id);
          useStore.getState().stopAnalyzing(track.id);
        });
    }
  }, [currentTrack, queue]);

  // Build the Web Audio graph once. Each deck: <audio> -> MediaElementSource
  // -> BiquadFilter (neutral "allpass" unless a transition needs EQ/filter
  // automation) -> Gain (crossfade progress only) -> master Gain (live
  // volume) -> destination, plus a small always-present delay/feedback
  // send used only for "echo out" transitions.
  useEffect(() => {
    const elA = audioARef.current;
    const elB = audioBRef.current;
    if (!elA || !elB) return;

    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();
    audioCtxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = useStore.getState().volume;
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    function buildDeckNodes(el: HTMLAudioElement, initialGain: number): DeckNodes {
      const source = ctx.createMediaElementSource(el);
      const filter = ctx.createBiquadFilter();
      filter.type = "allpass";
      const gain = ctx.createGain();
      gain.gain.value = initialGain;
      const delaySend = ctx.createGain();
      delaySend.gain.value = 0;
      const delay = ctx.createDelay(1);
      delay.delayTime.value = ECHO_DELAY_SEC;
      const delayFeedback = ctx.createGain();
      delayFeedback.gain.value = ECHO_FEEDBACK;

      source.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      filter.connect(delaySend);
      delaySend.connect(delay);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);
      delay.connect(masterGain);

      return { source, filter, gain, delaySend, delay, delayFeedback };
    }

    deckNodesRef.current.A = buildDeckNodes(elA, 1);
    deckNodesRef.current.B = buildDeckNodes(elB, 0);

    return () => {
      ctx.close().catch(() => {});
      audioCtxRef.current = null;
      deckNodesRef.current = { A: null, B: null };
      masterGainRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Core transition machinery + auto-DJ lookahead + Mix Now subscription.
  useEffect(() => {
    function handleEnded(deckId: DeckId) {
      if (transitionRef.current) return;
      if (deckId !== activeDeckRef.current) return;
      useStore.getState().next();
    }

    function applyFilterAutomation(plan: TransitionPlan, fromDeckId: DeckId, toDeckId: DeckId) {
      const ctx = audioCtxRef.current;
      const fromNodes = deckNodesRef.current[fromDeckId];
      const toNodes = deckNodesRef.current[toDeckId];
      if (!ctx || !fromNodes || !toNodes) return;
      const now = ctx.currentTime;

      if (plan.filterAutomation === "highpass-sweep") {
        fromNodes.filter.type = "highpass";
        fromNodes.filter.frequency.cancelScheduledValues(now);
        fromNodes.filter.frequency.setValueAtTime(20, now);
        fromNodes.filter.frequency.linearRampToValueAtTime(300, now + plan.windowSec * 0.5);
      } else if (plan.filterAutomation === "lowpass-sweep") {
        toNodes.filter.type = "lowpass";
        toNodes.filter.frequency.cancelScheduledValues(now);
        toNodes.filter.frequency.setValueAtTime(200, now);
        toNodes.filter.frequency.linearRampToValueAtTime(20000, now + plan.windowSec);
      } else if (plan.filterAutomation === "echo-tail") {
        fromNodes.delaySend.gain.cancelScheduledValues(now);
        fromNodes.delaySend.gain.setValueAtTime(0, now + plan.windowSec * 0.6);
        fromNodes.delaySend.gain.linearRampToValueAtTime(
          ECHO_WET_LEVEL,
          now + plan.windowSec
        );
      }
    }

    function startTransition(nextTrack: Track, plan: TransitionPlan) {
      if (transitionRef.current) return;
      const ctx = audioCtxRef.current;
      const fromDeckId = activeDeckRef.current;
      const toDeckId: DeckId = fromDeckId === "A" ? "B" : "A";
      const fromEl = deckEl(fromDeckId);
      const toEl = deckEl(toDeckId);
      const fromNodes = deckNodesRef.current[fromDeckId];
      const toNodes = deckNodesRef.current[toDeckId];
      if (!ctx || !fromEl || !toEl || !fromNodes || !toNodes) return;

      loadedTrackId.current[toDeckId] = nextTrack.id;
      toEl.src = nextTrack.sourceUrl;
      toEl.currentTime = plan.incomingEntryOffsetSec;
      toEl.playbackRate = plan.tempoSync ? plan.tempoRatioStart : 1;
      toNodes.gain.gain.setValueAtTime(0, ctx.currentTime);
      toEl.play().catch(() => {});

      const now = ctx.currentTime;
      const { outCurve, inCurve } = equalPowerCurves();
      fromNodes.gain.gain.cancelScheduledValues(now);
      toNodes.gain.gain.cancelScheduledValues(now);
      fromNodes.gain.gain.setValueCurveAtTime(outCurve, now, plan.windowSec);
      toNodes.gain.gain.setValueCurveAtTime(inCurve, now, plan.windowSec);
      applyFilterAutomation(plan, fromDeckId, toDeckId);

      const transition: ActiveTransition = {
        fromDeckId,
        toDeckId,
        startTime: performance.now(),
        durationMs: Math.max(1, plan.windowSec) * 1000,
        tempoSync: plan.tempoSync,
        tempoRatioStart: plan.tempoRatioStart,
        tickIntervalId: null,
      };
      transitionRef.current = transition;
      useStore.getState().setIsTransitioning(true);

      // Gain/filter automation is native (AudioParam-scheduled) and keeps
      // running even if this JS timer is delayed. The timer's only audio
      // duty is the incoming deck's tempo-sync playbackRate ramp, since
      // HTMLMediaElement.playbackRate isn't an automatable AudioParam.
      const tick = () => {
        const t = transitionRef.current;
        if (!t) return;
        const elapsed = performance.now() - t.startTime;
        const progress = Math.min(1, elapsed / t.durationMs);
        if (t.tempoSync) {
          const toDeckEl = deckEl(t.toDeckId);
          if (toDeckEl) {
            toDeckEl.playbackRate = t.tempoRatioStart + (1 - t.tempoRatioStart) * progress;
          }
        }
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
        fromEl.playbackRate = 1;
      }
      const toEl = deckEl(t.toDeckId);
      if (toEl) toEl.playbackRate = 1;
      resetDeckNodes(t.fromDeckId, 1);
      loadedTrackId.current[t.fromDeckId] = null;
      transitionRef.current = null;
      activeDeckRef.current = t.toDeckId;
      setActiveDeck(t.toDeckId);
      useStore.getState().setIsTransitioning(false);
      useStore.getState().next();
    }

    function getAnalysis(trackId: string): TrackAnalysis {
      return useStore.getState().trackAnalysis[trackId] ?? fallbackAnalysis();
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

      if (!state.autoDjEnabled) {
        const plan = planSimpleFade(AUTO_DJ_OFF_FADE_SEC);
        const clampedWindow = Math.min(plan.windowSec, duration / 2);
        if (duration - currentTime <= clampedWindow) {
          startTransition(nextTrack, { ...plan, windowSec: clampedWindow });
        }
        return;
      }

      const plan = planTransition({
        current: { track, analysis: getAnalysis(track.id) },
        next: { track: nextTrack, analysis: getAnalysis(nextTrack.id) },
        genreHint: state.styleGenreHint,
        overrideSec: state.crossfadeOverrideSec,
      });
      const clampedWindow = Math.min(
        plan.windowSec,
        duration / 2,
        Math.max(1, nextTrack.durationSec - plan.incomingEntryOffsetSec)
      );
      if (duration - currentTime <= clampedWindow) {
        startTransition(nextTrack, { ...plan, windowSec: clampedWindow });
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
      const plan = planTransition({
        current: { track, analysis: getAnalysis(track.id) },
        next: { track: nextTrack, analysis: getAnalysis(nextTrack.id) },
        genreHint: state.styleGenreHint,
        overrideSec: state.crossfadeOverrideSec,
      });
      startTransition(nextTrack, plan);
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
  }, [deckEl, resetDeckNodes]);

  // External track changes (library/queue click, next/previous, playlist
  // play) land here. Transitions we drive ourselves already have the new
  // deck's loadedTrackId pre-set to match, so this effect is a no-op for
  // those and only does real work for genuinely new external picks —
  // which always start at the literal beginning, preserving "play this
  // track from the top" semantics for a direct click (only mix
  // transitions use the analyzed entry point).
  useEffect(() => {
    if (!currentTrack) return;
    if (loadedTrackId.current[activeDeck] === currentTrack.id) return;

    cancelTransition();

    const idleId: DeckId = activeDeck === "A" ? "B" : "A";
    const idleEl = deckEl(idleId);
    if (idleEl) {
      idleEl.pause();
      idleEl.removeAttribute("src");
      idleEl.load();
    }
    resetDeckNodes(idleId, 0);
    loadedTrackId.current[idleId] = null;

    loadedTrackId.current[activeDeck] = currentTrack.id;
    const activeEl = deckEl(activeDeck);
    if (!activeEl) return;
    resetDeckNodes(activeDeck, 1);
    activeEl.playbackRate = 1;
    activeEl.src = currentTrack.sourceUrl;
    if (useStore.getState().isPlaying) {
      audioCtxRef.current?.resume().catch(() => {});
      activeEl.play().catch(() => {});
    }
  }, [currentTrack, activeDeck, cancelTransition, deckEl, resetDeckNodes]);

  useEffect(() => {
    const activeEl = deckEl(activeDeck);
    if (!activeEl || !currentTrack) return;
    if (isPlaying) {
      audioCtxRef.current?.resume().catch(() => {});
      activeEl.play().catch(() => {});
    } else {
      activeEl.pause();
    }
  }, [isPlaying, activeDeck, currentTrack, deckEl]);

  useEffect(() => {
    masterGainRef.current?.gain.setValueAtTime(volume, audioCtxRef.current?.currentTime ?? 0);
  }, [volume]);

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
