"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  AUTO_DJ_OFF_FADE_SEC,
  MAX_ACTIVE_PLAY_SEC,
  brakeGainCurves,
  equalPowerCurves,
  planSimpleFade,
  planTransition,
  stutterGateCurves,
  type TransitionPlan,
} from "@/lib/mix-engine";
import { analyzeTrackFromUrl, fallbackAnalysis, type TrackAnalysis } from "@/lib/audio-analysis";
import type { Track } from "@/types/music";

type DeckId = "A" | "B";

/** One-shot synthesized layer (riser or tag-sample stab) that isn't part of the persistent per-deck graph. */
interface OverlayNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
}

interface ActiveTransition {
  fromDeckId: DeckId;
  toDeckId: DeckId;
  startTime: number;
  durationMs: number;
  tempoSync: boolean;
  tempoRatioStart: number;
  effect: TransitionPlan["effect"];
  category: TransitionPlan["category"];
  tickIntervalId: ReturnType<typeof setInterval> | null;
  overlayNodes: OverlayNodes | null;
}

/** Real brakes don't slow linearly to a full stop — they decelerate hard early and crawl at the end. An ease-out curve (not linear) captures that. */
const BRAKE_MIN_RATE = 0.15;

interface DeckNodes {
  source: MediaElementAudioSourceNode;
  /** Dedicated bass band for EQ Kill's stepped cuts — independent of `filter` so it never conflicts with the highpass/lowpass sweeps that node is reused for. */
  lowShelf: BiquadFilterNode;
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
  // Survives the graph-building effect's cleanup (see below) so React
  // Strict Mode's dev-only mount→cleanup→mount cycle never rebuilds the
  // audio graph on the same <audio> elements.
  const graphCacheRef = useRef<{
    ctx: AudioContext;
    masterGain: GainNode;
    decks: Record<DeckId, DeckNodes>;
  } | null>(null);
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
    nodes.lowShelf.gain.cancelScheduledValues(now);
    nodes.lowShelf.gain.setValueAtTime(0, now);
    nodes.delaySend.gain.cancelScheduledValues(now);
    nodes.delaySend.gain.setValueAtTime(0, now);
    // Reverb Wash repurposes this same delay network with different
    // timing/feedback than Echo Out uses — restore its defaults so a later
    // echo-out on this deck sounds right again.
    nodes.delay.delayTime.cancelScheduledValues(now);
    nodes.delay.delayTime.setValueAtTime(ECHO_DELAY_SEC, now);
    nodes.delayFeedback.gain.cancelScheduledValues(now);
    nodes.delayFeedback.gain.setValueAtTime(ECHO_FEEDBACK, now);
  }, []);

  const stopOverlayNodes = useCallback((overlayNodes: OverlayNodes | null) => {
    if (!overlayNodes) return;
    const ctx = audioCtxRef.current;
    try {
      if (ctx) {
        overlayNodes.gain.gain.cancelScheduledValues(ctx.currentTime);
        overlayNodes.gain.gain.setValueAtTime(0, ctx.currentTime);
      }
      overlayNodes.source.stop();
    } catch {
      // Already stopped/scheduled to stop — harmless.
    }
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
    const fromEl = deckEl(t.fromDeckId);
    if (fromEl) fromEl.playbackRate = 1;
    stopOverlayNodes(t.overlayNodes);
    resetDeckNodes(t.toDeckId, 0);
    resetDeckNodes(t.fromDeckId, 1);
    loadedTrackId.current[t.toDeckId] = null;
    transitionRef.current = null;
    useStore.getState().setIsTransitioning(false);
  }, [deckEl, resetDeckNodes, stopOverlayNodes]);

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

  // Build the Web Audio graph once per <audio> element pair, ever. Each
  // deck: <audio> -> MediaElementSource -> BiquadFilter (neutral "allpass"
  // unless a transition needs EQ/filter automation) -> Gain (crossfade
  // progress only) -> master Gain (live volume) -> destination, plus a
  // small always-present delay/feedback send used only for "echo out"
  // transitions.
  useEffect(() => {
    const elA = audioARef.current;
    const elB = audioBRef.current;
    if (!elA || !elB) return;

    // A media element can only ever be bound to one MediaElementSourceNode
    // for its entire lifetime — even across a brand new AudioContext once
    // the original one closes. React Strict Mode's dev-only mount →
    // cleanup → mount cycle reuses these same <audio> DOM nodes, so if
    // cleanup closed the context and this ran a second time, the second
    // `createMediaElementSource` call would throw. Caching the graph in a
    // ref that cleanup doesn't clear sidesteps that entirely.
    if (!graphCacheRef.current) {
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor();

      const masterGain = ctx.createGain();
      masterGain.gain.value = useStore.getState().volume;
      masterGain.connect(ctx.destination);

      function buildDeckNodes(el: HTMLAudioElement, initialGain: number): DeckNodes {
        const source = ctx.createMediaElementSource(el);
        const lowShelf = ctx.createBiquadFilter();
        lowShelf.type = "lowshelf";
        lowShelf.frequency.value = 150;
        lowShelf.gain.value = 0;
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

        source.connect(lowShelf);
        lowShelf.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);

        filter.connect(delaySend);
        delaySend.connect(delay);
        delay.connect(delayFeedback);
        delayFeedback.connect(delay);
        delay.connect(masterGain);

        return { source, lowShelf, filter, gain, delaySend, delay, delayFeedback };
      }

      graphCacheRef.current = {
        ctx,
        masterGain,
        decks: { A: buildDeckNodes(elA, 1), B: buildDeckNodes(elB, 0) },
      };
    }

    const graph = graphCacheRef.current;
    audioCtxRef.current = graph.ctx;
    masterGainRef.current = graph.masterGain;
    deckNodesRef.current = graph.decks;

    return () => {
      // Intentionally does not close the AudioContext or clear
      // graphCacheRef — see the comment above. This component stays
      // mounted for the app's lifetime, so the "real" teardown happens
      // when the tab itself goes away.
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

    function applyTransitionEffect(plan: TransitionPlan, fromDeckId: DeckId, toDeckId: DeckId) {
      const ctx = audioCtxRef.current;
      const fromNodes = deckNodesRef.current[fromDeckId];
      const toNodes = deckNodesRef.current[toDeckId];
      if (!ctx || !fromNodes || !toNodes) return;
      const now = ctx.currentTime;

      if (plan.effect === "highpass-sweep") {
        fromNodes.filter.type = "highpass";
        fromNodes.filter.frequency.cancelScheduledValues(now);
        fromNodes.filter.frequency.setValueAtTime(20, now);
        fromNodes.filter.frequency.linearRampToValueAtTime(300, now + plan.windowSec * 0.5);
      } else if (plan.effect === "lowpass-sweep") {
        toNodes.filter.type = "lowpass";
        toNodes.filter.frequency.cancelScheduledValues(now);
        toNodes.filter.frequency.setValueAtTime(200, now);
        toNodes.filter.frequency.linearRampToValueAtTime(20000, now + plan.windowSec);
      } else if (plan.effect === "echo-tail") {
        fromNodes.delaySend.gain.cancelScheduledValues(now);
        fromNodes.delaySend.gain.setValueAtTime(0, now + plan.windowSec * 0.6);
        fromNodes.delaySend.gain.linearRampToValueAtTime(
          ECHO_WET_LEVEL,
          now + plan.windowSec
        );
      } else if (plan.effect === "eq-kill") {
        // Manual, abrupt EQ-kill steps — snapped (not swept), unlike the
        // continuous highpass/lowpass sweeps above: a DJ's hand kills the
        // bass knob, then the highs, as two discrete gestures.
        fromNodes.lowShelf.gain.cancelScheduledValues(now);
        fromNodes.lowShelf.gain.setValueAtTime(0, now + plan.windowSec * 0.35);
        fromNodes.lowShelf.gain.setValueAtTime(-30, now + plan.windowSec * 0.35 + 0.02);
        fromNodes.filter.type = "highpass";
        fromNodes.filter.frequency.cancelScheduledValues(now);
        fromNodes.filter.frequency.setValueAtTime(20, now + plan.windowSec * 0.7);
        fromNodes.filter.frequency.setValueAtTime(3500, now + plan.windowSec * 0.7 + 0.02);
      } else if (plan.effect === "reverb-wash") {
        // Approximated with a short, dense, high-feedback delay loop rather
        // than a true convolution reverb — the same per-deck delay network
        // Echo Out uses, just retuned for a blurred wash instead of a
        // discrete repeat. resetDeckNodes() restores the echo defaults
        // afterward so a later echo-out on this deck isn't affected.
        fromNodes.delay.delayTime.cancelScheduledValues(now);
        fromNodes.delay.delayTime.setValueAtTime(0.06, now);
        fromNodes.delayFeedback.gain.cancelScheduledValues(now);
        fromNodes.delayFeedback.gain.setValueAtTime(0.6, now);
        fromNodes.delaySend.gain.cancelScheduledValues(now);
        fromNodes.delaySend.gain.setValueAtTime(0, now);
        fromNodes.delaySend.gain.linearRampToValueAtTime(0.5, now + plan.windowSec * 0.8);
        fromNodes.delaySend.gain.linearRampToValueAtTime(0, now + plan.windowSec + 1.2);
      }
      // "brake" and "stutter-gate" are expressed entirely through the main
      // gain curves chosen in startTransition(); "riser" and "tag-sample"
      // are independent synthesized layers added there too. None of the
      // four need anything here.
    }

    /** Synthesizes a classic EDM riser: a filtered noise sweep that builds in pitch and volume under the outgoing track's tail, then cuts out just past the drop. Needs no bundled audio asset — it's generated on the fly. */
    function startRiserLayer(ctx: AudioContext, windowSec: number): OverlayNodes | null {
      const masterGain = masterGainRef.current;
      if (!masterGain) return null;
      const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * windowSec));
      const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < sampleCount; i++) data[i] = Math.random() * 2 - 1;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      const gain = ctx.createGain();

      source.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      const now = ctx.currentTime;
      filter.frequency.setValueAtTime(150, now);
      filter.frequency.exponentialRampToValueAtTime(9000, now + windowSec);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.55, now + windowSec * 0.92);
      gain.gain.linearRampToValueAtTime(0, now + windowSec + 0.15);

      source.start(now);
      source.stop(now + windowSec + 0.2);

      return { source, filter, gain };
    }

    /** Synthesizes a short horn/siren stab right at the transition point — standing in for a vocal tag or air-horn sample, since we have no bundled audio asset to drop in. A detuned oscillator pair (via the noise buffer's playbackRate trick) sweeping upward gives a brassy "stab" character without needing a WaveShaper. */
    function startTagSampleStab(ctx: AudioContext, windowSec: number): OverlayNodes | null {
      const masterGain = masterGainRef.current;
      if (!masterGain) return null;
      const stabSec = Math.min(0.9, Math.max(0.3, windowSec));
      const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * stabSec));
      const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      // A sawtooth-ish tone (not noise) reads as a horn/siren stab rather than a riser's airy sweep.
      const startHz = 220;
      const endHz = 660;
      let phase = 0;
      for (let i = 0; i < sampleCount; i++) {
        const t = i / ctx.sampleRate;
        const hz = startHz + (endHz - startHz) * (t / stabSec);
        phase += hz / ctx.sampleRate;
        phase -= Math.floor(phase);
        data[i] = 2 * phase - 1; // sawtooth
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 900;
      filter.Q.value = 1.2;
      const gain = ctx.createGain();

      source.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.5, now + stabSec * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + stabSec);

      source.start(now);
      source.stop(now + stabSec + 0.05);

      return { source, filter, gain };
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

      // A brake/spinback dies to a full stop and drops the next track in
      // fresh at its native tempo — no tempo-matching, since the whole
      // point is a clean break, not a blend. A Tempo Ramp deliberately
      // attempts a tempo-ratio adjustment even outside the normal
      // tempoSync range, since bridging that gap gradually is the point.
      const startsTempoSynced =
        plan.effect !== "brake" && (plan.tempoSync || plan.category === "tempo-ramp");

      loadedTrackId.current[toDeckId] = nextTrack.id;
      toEl.src = nextTrack.sourceUrl;
      toEl.currentTime = plan.incomingEntryOffsetSec;
      toEl.playbackRate = startsTempoSynced ? plan.tempoRatioStart : 1;
      toNodes.gain.gain.setValueAtTime(0, ctx.currentTime);
      toEl.play().catch(() => {});

      const now = ctx.currentTime;
      const { outCurve, inCurve } =
        plan.effect === "brake"
          ? brakeGainCurves()
          : plan.effect === "stutter-gate"
            ? stutterGateCurves()
            : equalPowerCurves();
      fromNodes.gain.gain.cancelScheduledValues(now);
      toNodes.gain.gain.cancelScheduledValues(now);
      fromNodes.gain.gain.setValueCurveAtTime(outCurve, now, plan.windowSec);
      toNodes.gain.gain.setValueCurveAtTime(inCurve, now, plan.windowSec);
      applyTransitionEffect(plan, fromDeckId, toDeckId);
      const overlayNodes =
        plan.effect === "riser"
          ? startRiserLayer(ctx, plan.windowSec)
          : plan.effect === "tag-sample"
            ? startTagSampleStab(ctx, plan.windowSec)
            : null;

      const transition: ActiveTransition = {
        fromDeckId,
        toDeckId,
        startTime: performance.now(),
        durationMs: Math.max(1, plan.windowSec) * 1000,
        tempoSync: startsTempoSynced,
        tempoRatioStart: plan.tempoRatioStart,
        effect: plan.effect,
        category: plan.category,
        tickIntervalId: null,
        overlayNodes,
      };
      transitionRef.current = transition;
      useStore.getState().setIsTransitioning(true);

      // Gain/filter automation is native (AudioParam-scheduled) and keeps
      // running even if this JS timer is delayed. The timer's only audio
      // duties are things HTMLMediaElement.playbackRate can't do as an
      // AudioParam: the incoming deck's tempo-sync ramp, or — for a brake
      // — the outgoing deck's slow-down ramp.
      const tick = () => {
        const t = transitionRef.current;
        if (!t) return;
        const elapsed = performance.now() - t.startTime;
        const progress = Math.min(1, elapsed / t.durationMs);
        if (t.effect === "brake") {
          const fromDeckEl = deckEl(t.fromDeckId);
          if (fromDeckEl) {
            // Ease-out: decelerates hard early, crawls near the end, like a hand-braked record.
            const eased = 1 - Math.pow(1 - progress, 3);
            fromDeckEl.playbackRate = 1 - eased * (1 - BRAKE_MIN_RATE);
          }
        } else if (t.tempoSync) {
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

      const currentAnalysis = getAnalysis(track.id);
      const plan = planTransition({
        current: { track, analysis: currentAnalysis },
        next: { track: nextTrack, analysis: getAnalysis(nextTrack.id) },
        genreHint: state.styleGenreHint,
        overrideSec: state.crossfadeOverrideSec,
        currentElapsedSec: currentTime,
      });
      const clampedWindow = Math.min(
        plan.windowSec,
        duration / 2,
        Math.max(1, nextTrack.durationSec - plan.incomingEntryOffsetSec)
      );
      // Four independent triggers, any one of which starts the transition:
      // - near the natural end of the file (the classic case)
      // - a hard ceiling on active playback time, so a track never rides
      //   past MAX_ACTIVE_PLAY_SEC regardless of how long the file is
      // - Double Drop: the outgoing track's own drop is imminent, timed so
      //   the window finishes right as it hits (only meaningful when a
      //   drop-category transition was actually chosen — otherwise a
      //   detected drop is just incidental data, not a cue to act on)
      // - Breakdown Mixing: the outgoing track's low-energy breakdown is
      //   imminent — an opportunistic early mix since there's less to
      //   clash with, for whichever transition style got chosen
      const nearNaturalEnd = duration - currentTime <= clampedWindow;
      const pastActiveCap = currentTime >= MAX_ACTIVE_PLAY_SEC - clampedWindow;
      const dropAligned =
        plan.category === "drop" &&
        currentAnalysis.dropAtSec != null &&
        currentTime >= currentAnalysis.dropAtSec - clampedWindow &&
        currentTime < currentAnalysis.dropAtSec + clampedWindow;
      const breakdownOpportunity =
        plan.category !== "drop" &&
        currentAnalysis.breakdownAtSec != null &&
        currentTime >= currentAnalysis.breakdownAtSec - clampedWindow &&
        currentTime < currentAnalysis.breakdownAtSec + clampedWindow;
      if (nearNaturalEnd || pastActiveCap || dropAligned || breakdownOpportunity) {
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
      const activeEl = deckEl(activeDeckRef.current);
      const plan = planTransition({
        current: { track, analysis: getAnalysis(track.id) },
        next: { track: nextTrack, analysis: getAnalysis(nextTrack.id) },
        genreHint: state.styleGenreHint,
        overrideSec: state.crossfadeOverrideSec,
        currentElapsedSec: activeEl?.currentTime ?? null,
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
      stopOverlayNodes(transitionRef.current?.overlayNodes ?? null);
      transitionRef.current = null;
      elA?.removeEventListener("ended", onEndedA);
      elB?.removeEventListener("ended", onEndedB);
    };
  }, [deckEl, resetDeckNodes, stopOverlayNodes]);

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
