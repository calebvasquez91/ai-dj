"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  AUTO_DJ_OFF_FADE_SEC,
  MAX_ACTIVE_PLAY_SEC,
  MIN_ACTIVE_PLAY_SEC,
  TRACK_FADE_IN_SEC,
  TRACK_FADE_OUT_SEC,
  bestTempoRatio,
  brakeGainCurves,
  equalPowerCurves,
  isTempoRampEligible,
  mashupGainCurves,
  planSimpleFade,
  planTransition,
  snapToBeatGrid,
  spinUpGainCurves,
  stutterGateCurves,
  type TransitionPlan,
} from "@/lib/mix-engine";
import { analyzeTrackFromUrl, fallbackAnalysis, type TrackAnalysis } from "@/lib/audio-analysis";
import { getLyricalFingerprint } from "@/lib/lyrics";
import { cancelHypePhrase, speakHypePhrase } from "@/lib/wordPlay";
import { shouldTriggerAmbience } from "@/lib/ambience";
import { useDjWeights, LEARNING_NUDGE_UP, LEARNING_NUDGE_DOWN } from "@/lib/dj-weights";
import { planMashup, MASHUP_COOLDOWN_SEC, type MashupPlan } from "@/lib/mashup-engine";
import { createTimeStretchVoice, type TimeStretchVoice } from "@/lib/time-stretch";
import type { LocalTrack, Track } from "@/types/music";

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

/**
 * A matched mashup in progress: the outgoing <audio> deck keeps playing
 * completely normally while a separate, temporary buffer-voice (decoded
 * audio run through SoundTouchJS, see lib/time-stretch.ts) plays the
 * incoming track tempo/key-matched on top for `plan.durationSec`. Not a
 * TransitionPlan — this is a much longer, differently-shaped process with
 * its own tick loop, tracked independently of `transitionRef`.
 */
interface ActiveMashup {
  fromDeckId: DeckId; // still playing normally, unprocessed
  toDeckId: DeckId; // idle <audio> deck — receives the handoff once the mashup resolves
  nextTrack: LocalTrack;
  plan: MashupPlan;
  voice: TimeStretchVoice;
  voiceGain: GainNode;
  startTime: number; // performance.now()
  durationMs: number;
  lastTickTime: number; // performance.now() at the previous tick, for integrating elapsed track-time
  /** Running estimate of the buffer-voice's position within nextTrack's own timeline — accumulates realDeltaSec * currentTempo each tick, since tempo isn't constant throughout. */
  trackTimeElapsedSec: number;
  /** The buffer-voice's tempo ratio as of the last tick (starts at plan.tempoRatio, eases to 1 during the resolve phase). */
  currentTempo: number;
  tickIntervalId: ReturnType<typeof setInterval> | null;
}

/**
 * A pre-transition tempo ramp in progress: the *outgoing* deck's own track
 * is temporarily played through a SoundTouchJS buffer-voice (the same
 * mechanism the mashup engine uses, just applied to the other side) so its
 * tempo can glide from 1x toward the upcoming track's native tempo — real,
 * independent time-stretching, not playbackRate — before the actual blend
 * starts. Once it reaches the target, playback hands back to the deck's own
 * <audio> element at that matched rate (an ordinary, already-accepted
 * playbackRate hold for the short blend window, same as any tempoSynced
 * incoming deck today) and the pairing is recorded in
 * tempoRampCompletedPairRef so the upcoming startTransition() call knows
 * the outgoing side already did the matching work.
 */
interface ActiveTempoRamp {
  deckId: DeckId;
  trackId: string;
  nextTrackId: string;
  voice: TimeStretchVoice;
  voiceGain: GainNode;
  /** el.currentTime at the moment the buffer-voice took over. */
  entryTrackTimeSec: number;
  /** playbackRate the deck should end up holding — makes its effective tempo match the incoming track's native tempo. */
  targetTempo: number;
  startTime: number;
  durationMs: number;
  lastTickTime: number;
  trackTimeElapsedSec: number;
  currentTempo: number;
  tickIntervalId: ReturnType<typeof setInterval> | null;
}

/** How long the pre-transition tempo ramp takes — matches tempo-ramp's own MIN_WINDOW_SEC_BY_CATEGORY floor in mix-engine.ts. */
const TEMPO_RAMP_PRE_WINDOW_SEC = 8;
/** Short fade at the <audio>-element/buffer-voice swap boundary (both directions) — belt-and-suspenders against a click even though both sides play identical content from the same position. */
const TEMPO_RAMP_SWAP_FADE_SEC = 0.03;

/** Per-deck nodes for the acoustic-feel + stadium-echo vocal moment — built lazily on first use, not part of the always-present per-deck graph, since it's a rarely-triggered effect. */
interface VocalEchoNodes {
  splitter: ChannelSplitterNode;
  vocalForward: GainNode;
  convolver: ConvolverNode;
  reverbGain: GainNode;
  slapDelay: DelayNode;
  slapFeedback: GainNode;
  delayGain: GainNode;
  /** Overall wet level for this effect — the only node actually automated per-trigger; everything upstream is static, silent by default. */
  sendGain: GainNode;
  /** Direct (non-reverb/delay) send for the isolated vocal-forward signal — used by the acapella-drop ad-lib to play it alone, dry, while the main mix is ducked. Silent by default. */
  dryGain: GainNode;
}

/**
 * A freeform beat-aligned loop in progress: repeats a short segment of the
 * *same* track by rewinding the active <audio> element's own currentTime —
 * not a separate buffer voice, so there's no new audio path and releasing
 * it is inherently seamless (playback just stops being rewound and
 * continues forward exactly as it already was). Used for the drum-break
 * ad-lib now; the start/bars/repeat parameters are generic enough to loop
 * any beat-aligned segment.
 */
interface ActiveLoop {
  deckId: DeckId;
  startSec: number;
  endSec: number;
  repeatsRemaining: number;
  tickIntervalId: ReturnType<typeof setInterval> | null;
}

/** A backspin ad-lib in progress — a plain interval driving the active deck's own playbackRate down and back up (never its gain), tracked so an external track change or seek mid-backspin can cancel it before it applies a stale rate to whatever loads next. */
interface ActiveBackspin {
  deckId: DeckId;
  intervalId: ReturnType<typeof setInterval>;
}

/** Real brakes don't slow linearly to a full stop — they decelerate hard early and crawl at the end. An ease-out curve (not linear) captures that. */
const BRAKE_MIN_RATE = 0.15;
/** How slow a "spin up" starts before ramping to full speed — the mirror of BRAKE_MIN_RATE. */
const SPIN_UP_MIN_RATE = 0.2;

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
  // Last few transitionIds actually used, most recent last — fed back into
  // planTransition so it doesn't keep picking the same technique every time
  // several score similarly (which without this, tends to collapse to
  // whichever blend-style option wins ties by default).
  const recentTransitionIdsRef = useRef<string[]>([]);
  // Tracks the last mid-track ambience trigger per-track (reset whenever the
  // active track changes) so shouldTriggerAmbience() can enforce a cooldown.
  const ambienceStateRef = useRef<{ trackId: string | null; lastTriggeredSec: number | null }>({
    trackId: null,
    lastTriggeredSec: null,
  });
  const activeDeckRef = useRef<DeckId>("A");
  const analyzingRef = useRef<Set<string>>(new Set());
  const lyricsFetchingRef = useRef<Set<string>>(new Set());
  const mashupRef = useRef<ActiveMashup | null>(null);
  // True synchronously as soon as a mashup decode kicks off, before mashupRef
  // itself is populated — guards against the tick loop starting a second
  // mashup while the first is still mid-decode (an inherently async gap
  // ActiveMashup's own ref alone can't cover).
  const mashupStartingRef = useRef(false);
  const mashupBufferCacheRef = useRef<Record<string, AudioBuffer>>({});
  // Wall-clock (not track-relative) timestamp of the last mashup, since the
  // cooldown needs to span across tracks/transitions, not reset per-track
  // the way ambience's cooldown does.
  const mashupLastAtRef = useRef<number | null>(null);
  // Memoizes the mashup plan (which includes a randomized bars count) per
  // (current, next) track pairing so it's decided once and held stable —
  // planMashup() is otherwise re-evaluated every 500ms tick, which would
  // otherwise re-roll a fresh random duration on every single check.
  const mashupPlanCacheRef = useRef<{ pairKey: string; plan: MashupPlan | null } | null>(null);
  const vocalEchoNodesRef = useRef<Record<DeckId, VocalEchoNodes | null>>({ A: null, B: null });
  const stadiumIrRef = useRef<AudioBuffer | null>(null);
  const loopRef = useRef<ActiveLoop | null>(null);
  const backspinRef = useRef<ActiveBackspin | null>(null);
  const tempoRampRef = useRef<ActiveTempoRamp | null>(null);
  // True synchronously as soon as a tempo-ramp decode kicks off, before
  // tempoRampRef itself is populated — same reason mashupStartingRef exists.
  const tempoRampStartingRef = useRef(false);
  // Set once a pre-transition tempo ramp finishes for a given
  // `${trackId}>${nextTrackId}` pairing — tryAutoTransition consults this so
  // the eventual startTransition() call knows the outgoing deck already did
  // the tempo-matching work and skips re-ramping the incoming deck on top of it.
  const tempoRampCompletedPairRef = useRef<string | null>(null);
  // A local track ending into a YouTube track (or vice versa) has no shared
  // audio graph to blend through, so instead of an overlapping crossfade the
  // outgoing local deck just fades to silence over the normal transition
  // window, then hands off to the queue — see fadeThenAdvance().
  const crossSourceFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (t.effect === "word-play") cancelHypePhrase();
    resetDeckNodes(t.toDeckId, 0);
    resetDeckNodes(t.fromDeckId, 1);
    loadedTrackId.current[t.toDeckId] = null;
    transitionRef.current = null;
    useStore.getState().setIsTransitioning(false);
    useStore.getState().setActiveTransitionRationale(null);
  }, [deckEl, resetDeckNodes, stopOverlayNodes]);

  /** Tears down an in-progress mashup cleanly (user seeked or picked a different track mid-mashup) — the idle toDeck was never touched yet, so only the buffer-voice and the still-playing fromDeck need resetting. */
  const cancelMashup = useCallback(() => {
    const m = mashupRef.current;
    if (!m) return;
    if (m.tickIntervalId != null) clearInterval(m.tickIntervalId);
    try {
      m.voice.stop();
    } catch {
      // Already stopped — harmless.
    }
    m.voiceGain.disconnect();
    resetDeckNodes(m.fromDeckId, 1);
    mashupRef.current = null;
    useStore.getState().setIsTransitioning(false);
    useStore.getState().setActiveTransitionRationale(null);
  }, [resetDeckNodes]);

  /** Stops an in-progress freeform beat-loop from rewinding again — the deck's own playback just continues forward untouched, since the loop never altered gain or node state, only currentTime. */
  const cancelLoop = useCallback(() => {
    const l = loopRef.current;
    if (!l) return;
    if (l.tickIntervalId != null) clearInterval(l.tickIntervalId);
    loopRef.current = null;
  }, []);

  /** Stops an in-progress backspin from continuing to drive playbackRate — restores it to 1 immediately rather than leaving the deck at whatever intermediate rate the ramp was at. */
  const cancelBackspin = useCallback(() => {
    const b = backspinRef.current;
    if (!b) return;
    clearInterval(b.intervalId);
    const el = deckEl(b.deckId);
    if (el) el.playbackRate = 1;
    backspinRef.current = null;
  }, [deckEl]);

  /** Tears down an in-progress pre-transition tempo ramp (user skipped/seeked mid-ramp) — hands playback straight back to the deck's own <audio> element at wherever the buffer-voice got to, no smoothing, same as cancelTransition/cancelMashup treat an abrupt user-initiated interruption. */
  const cancelTempoRamp = useCallback(() => {
    const r = tempoRampRef.current;
    if (!r) return;
    if (r.tickIntervalId != null) clearInterval(r.tickIntervalId);
    try {
      r.voice.stop();
    } catch {
      // Already stopped — harmless.
    }
    r.voiceGain.disconnect();
    const el = deckEl(r.deckId);
    const nodes = deckNodesRef.current[r.deckId];
    const ctx = audioCtxRef.current;
    if (el) {
      el.currentTime = r.entryTrackTimeSec + r.trackTimeElapsedSec;
      el.playbackRate = 1;
      el.play().catch(() => {});
    }
    if (nodes && ctx) {
      nodes.gain.gain.cancelScheduledValues(ctx.currentTime);
      nodes.gain.gain.setValueAtTime(1, ctx.currentTime);
    }
    tempoRampRef.current = null;
    tempoRampCompletedPairRef.current = null;
  }, [deckEl]);

  // Background analysis: as soon as a track is reachable (now playing or
  // queued), estimate its BPM/beat-grid/energy-onset/key so a mix engine
  // decision is ready before Mix Now or an auto-transition needs it.
  useEffect(() => {
    const tracks = currentTrack ? [currentTrack, ...queue] : queue;
    for (const track of tracks) {
      // YouTube/Spotify tracks have no fetchable/decodable audio buffer to
      // analyze — trackAnalysis simply never gets an entry for them, which
      // the compatibility scorer and mix engine already treat as neutral.
      if (track.source !== "local") continue;
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

  // Same reachability rule as the analysis effect above, for the lyrical
  // fingerprint (track-sequencing.ts's compatibility score) — a separate
  // effect since it's an independent lookup (LRCLIB by title/artist, not
  // decoded audio) with its own once-ever-per-track cache.
  useEffect(() => {
    const tracks = currentTrack ? [currentTrack, ...queue] : queue;
    for (const track of tracks) {
      const state = useStore.getState();
      if (state.trackLyricalFingerprints[track.id] || lyricsFetchingRef.current.has(track.id)) continue;
      lyricsFetchingRef.current.add(track.id);
      getLyricalFingerprint(track.title, track.artist)
        .then((fingerprint) => {
          // A real fingerprint or a genuine "searched, nothing found" are
          // both safe to cache permanently — only a thrown error (below)
          // isn't, since that's a transient failure, not a real answer.
          useStore.getState().setLyricalFingerprint(track.id, fingerprint ?? { words: new Set(), moodTags: new Set() });
        })
        .catch(() => {
          // Network/parse failure — don't cache a negative; a later session tries again.
        })
        .finally(() => {
          lyricsFetchingRef.current.delete(track.id);
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
      if (transitionRef.current || mashupRef.current) return;
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

    /** Synthesizes a "chirp" tone for Scratch Transition/Transform Chop — a rapidly wobbling sawtooth standing in for the classic turntablist scratch sound, layered on top of the stutter-gate alternation applied to the actual decks. Real scratching is a physical gesture we can't replicate (and often uses a dedicated scratch record, not the track's own audio), so this approximates the *sound signature* rather than the technique. */
    function startScratchChirpLayer(ctx: AudioContext, windowSec: number): OverlayNodes | null {
      const masterGain = masterGainRef.current;
      if (!masterGain) return null;
      const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * windowSec));
      const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      const carrierHz = 350;
      const modHz = 9; // wobble rate — the pulse that reads as a "chirp"
      let phase = 0;
      for (let i = 0; i < sampleCount; i++) {
        const t = i / ctx.sampleRate;
        const wobble = Math.sin(2 * Math.PI * modHz * t);
        const instHz = carrierHz + wobble * 220;
        phase += instHz / ctx.sampleRate;
        phase -= Math.floor(phase);
        data[i] = 2 * phase - 1; // sawtooth for a scratchier timbre than a pure tone
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 500;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();

      source.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.35, now + Math.min(0.15, windowSec * 0.2));
      gain.gain.setValueAtTime(0.35, now + windowSec * 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + windowSec);

      source.start(now);
      source.stop(now + windowSec + 0.05);

      return { source, filter, gain };
    }

    function startTransition(nextTrack: LocalTrack, plan: TransitionPlan) {
      if (transitionRef.current) return;
      const ctx = audioCtxRef.current;
      const fromDeckId = activeDeckRef.current;
      const toDeckId: DeckId = fromDeckId === "A" ? "B" : "A";
      const fromEl = deckEl(fromDeckId);
      const toEl = deckEl(toDeckId);
      const fromNodes = deckNodesRef.current[fromDeckId];
      const toNodes = deckNodesRef.current[toDeckId];
      if (!ctx || !fromEl || !toEl || !fromNodes || !toNodes) return;

      recentTransitionIdsRef.current = [...recentTransitionIdsRef.current, plan.transitionId].slice(-3);
      // One-shot: a manual pick or reroll only applies to this upcoming mix —
      // Auto-DJ resumes normal automatic variety for the next one unless the
      // user sets a new override.
      useStore.getState().setForcedTransitionId(null);
      useStore.getState().clearRerolledTransitionIds();

      // A brake/spinback dies to a full stop, and a spin-up starts from
      // one, dropping the next track in fresh at its own native tempo —
      // no tempo-matching either way, since the whole point is a clean
      // break, not a blend. A Tempo Ramp deliberately attempts a
      // tempo-ratio adjustment even outside the normal tempoSync range,
      // since bridging that gap gradually is the point.
      const startsTempoSynced =
        plan.effect !== "brake" &&
        plan.effect !== "spin-up" &&
        (plan.tempoSync || plan.category === "tempo-ramp");

      loadedTrackId.current[toDeckId] = nextTrack.id;
      toEl.src = nextTrack.sourceUrl;
      toEl.currentTime = plan.incomingEntryOffsetSec;
      toEl.playbackRate = plan.effect === "spin-up" ? SPIN_UP_MIN_RATE : startsTempoSynced ? plan.tempoRatioStart : 1;
      toNodes.gain.gain.setValueAtTime(0, ctx.currentTime);
      toEl.play().catch(() => {});

      const now = ctx.currentTime;
      const { outCurve, inCurve } =
        plan.effect === "brake"
          ? brakeGainCurves()
          : plan.effect === "spin-up"
            ? spinUpGainCurves()
            : plan.effect === "stutter-gate" || plan.effect === "scratch-chirp"
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
            : plan.effect === "scratch-chirp"
              ? startScratchChirpLayer(ctx, plan.windowSec)
              : null;
      if (plan.effect === "word-play") {
        // Fire-and-forget: SpeechSynthesis doesn't route through this
        // component's Web Audio graph, so it can't be volume-matched or
        // ducked under the music — it just speaks over whatever's playing.
        speakHypePhrase();
      }

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
      useStore.getState().setActiveTransitionRationale(plan.rationale);

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
        } else if (t.effect === "spin-up") {
          const toDeckEl = deckEl(t.toDeckId);
          if (toDeckEl) {
            // Same ease-out shape as a brake, run in reverse: catches up fast, then levels off at full speed.
            const eased = 1 - Math.pow(1 - progress, 3);
            toDeckEl.playbackRate = SPIN_UP_MIN_RATE + eased * (1 - SPIN_UP_MIN_RATE);
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
      useStore.getState().setActiveTransitionRationale(null);
      useStore.getState().next();
    }

    function getAnalysis(trackId: string): TrackAnalysis {
      return useStore.getState().trackAnalysis[trackId] ?? fallbackAnalysis();
    }

    /**
     * Local-adaptation hook: only does anything when the user actually
     * overrode this mix (a manual pick or a reroll) — in that case, compare
     * against what auto-scoring alone would have chosen and nudge category
     * weights accordingly, so a repeated override gradually shifts what
     * "auto" means for this browser instead of having to be re-applied by
     * hand every time. A no-op the vast majority of the time (no override),
     * so it never adds cost to the common case.
     */
    function applyLearningNudge(
      track: Track,
      nextTrack: Track,
      state: ReturnType<typeof useStore.getState>,
      currentTime: number | null,
      plan: TransitionPlan
    ) {
      if (!state.forcedTransitionId && state.rerolledTransitionIds.length === 0) return;
      const autoPlan = planTransition({
        current: { track, analysis: getAnalysis(track.id) },
        next: { track: nextTrack, analysis: getAnalysis(nextTrack.id) },
        genreHint: state.styleGenreHint,
        overrideSec: state.crossfadeOverrideSec,
        currentElapsedSec: currentTime,
        djMode: state.djMode,
        recentTransitionIds: recentTransitionIdsRef.current,
        categoryWeights: useDjWeights.getState().categoryWeights,
      });
      if (autoPlan.category !== plan.category) {
        useDjWeights.getState().nudge(plan.category, LEARNING_NUDGE_UP);
        useDjWeights.getState().nudge(autoPlan.category, LEARNING_NUDGE_DOWN);
      }
    }

    /** Fetches and decodes a track's audio into an AudioBuffer for the mashup buffer-voice — cached by URL so a re-decode never happens twice for the same track. */
    async function decodeTrackBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
      const cached = mashupBufferCacheRef.current[url];
      if (cached) return cached;
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      mashupBufferCacheRef.current[url] = buffer;
      return buffer;
    }

    /**
     * Starts a matched mashup: decodes the incoming track, plays it
     * tempo/key-matched over the still-playing outgoing deck via a
     * SoundTouchJS voice, and schedules the full gain choreography as one
     * native curve (mashupGainCurves) up front — only tempo/pitch easing
     * and the eventual handoff need a JS tick, since SoundTouchJS's
     * tempo/pitch aren't AudioParams.
     */
    async function startMashup(nextTrack: LocalTrack, plan: MashupPlan) {
      if (transitionRef.current || mashupRef.current || mashupStartingRef.current) return;
      mashupStartingRef.current = true;
      const currentTrackIdAtStart = useStore.getState().currentTrack?.id;
      try {
        const ctx = audioCtxRef.current;
        const masterGain = masterGainRef.current;
        if (!ctx || !masterGain) return;

        const buffer = await decodeTrackBuffer(ctx, nextTrack.sourceUrl);

        // The world may have moved on while we were decoding (track
        // skipped, a transition started some other way) — abort rather
        // than layer a mashup onto a pairing that's no longer current.
        const state = useStore.getState();
        if (transitionRef.current || mashupRef.current) return;
        if (state.currentTrack?.id !== currentTrackIdAtStart || state.queue[0]?.id !== nextTrack.id) return;

        const fromDeckId = activeDeckRef.current;
        const toDeckId: DeckId = fromDeckId === "A" ? "B" : "A";
        const fromNodes = deckNodesRef.current[fromDeckId];
        if (!fromNodes) return;

        const voice = createTimeStretchVoice(ctx, buffer, {
          tempo: plan.tempoRatio,
          pitchSemitones: plan.pitchSemitones,
        });
        voice.setStartFraction(Math.max(0, Math.min(1, plan.entryOffsetSec / buffer.duration)));
        const voiceGain = ctx.createGain();
        voiceGain.gain.value = 0;
        voice.node.connect(voiceGain);
        voiceGain.connect(masterGain);

        const now = ctx.currentTime;
        const { outCurve, inCurve } = mashupGainCurves();
        fromNodes.gain.gain.cancelScheduledValues(now);
        fromNodes.gain.gain.setValueCurveAtTime(outCurve, now, plan.durationSec);
        voiceGain.gain.cancelScheduledValues(now);
        voiceGain.gain.setValueCurveAtTime(inCurve, now, plan.durationSec);

        const mashup: ActiveMashup = {
          fromDeckId,
          toDeckId,
          nextTrack,
          plan,
          voice,
          voiceGain,
          startTime: performance.now(),
          lastTickTime: performance.now(),
          durationMs: Math.max(1, plan.durationSec) * 1000,
          trackTimeElapsedSec: 0,
          currentTempo: plan.tempoRatio,
          tickIntervalId: null,
        };
        mashupRef.current = mashup;
        useStore.getState().setIsTransitioning(true);
        useStore.getState().setActiveTransitionRationale(plan.rationale);

        // Resolve phase starts at this fraction of the total duration — the
        // last stretch of mashupGainCurves' own resolve taper, kept in sync
        // so the tempo/pitch easing lands right as the gain hand-off does.
        const resolveStartRatio = 0.7;
        const tick = () => {
          const m = mashupRef.current;
          if (!m) return;
          const nowMs = performance.now();
          const realDeltaSec = (nowMs - m.lastTickTime) / 1000;
          m.trackTimeElapsedSec += realDeltaSec * m.currentTempo;
          m.lastTickTime = nowMs;

          const progress = Math.min(1, (nowMs - m.startTime) / m.durationMs);
          if (progress >= resolveStartRatio) {
            const localProgress = (progress - resolveStartRatio) / (1 - resolveStartRatio);
            m.currentTempo = m.plan.tempoRatio + (1 - m.plan.tempoRatio) * localProgress;
            m.voice.setTempo(m.currentTempo);
            m.voice.setPitchSemitones(m.plan.pitchSemitones * (1 - localProgress));
          }
          if (progress >= 1) {
            if (m.tickIntervalId != null) clearInterval(m.tickIntervalId);
            completeMashup(m);
          }
        };
        mashup.tickIntervalId = setInterval(tick, TICK_INTERVAL_MS);
      } catch {
        // Fetch/decode/SoundTouchJS failure — just skip this mashup
        // attempt. tryAutoTransition falls through to a normal transition
        // on a later tick since mashupRef never got populated.
      } finally {
        mashupStartingRef.current = false;
      }
    }

    /** Hands the mashup off to a normal <audio> deck at the exact position the buffer-voice reached, then tears the buffer-voice down — the rest of the app (transition timing, ambience, analysis) goes right back to reasoning about the normal two-deck world afterward. */
    function completeMashup(m: ActiveMashup) {
      const ctx = audioCtxRef.current;
      const idleEl = deckEl(m.toDeckId);
      const idleNodes = deckNodesRef.current[m.toDeckId];
      if (ctx && idleEl && idleNodes) {
        loadedTrackId.current[m.toDeckId] = m.nextTrack.id;
        idleEl.src = m.nextTrack.sourceUrl;
        idleEl.currentTime = m.plan.entryOffsetSec + m.trackTimeElapsedSec;
        idleEl.playbackRate = 1;
        idleNodes.gain.gain.cancelScheduledValues(ctx.currentTime);
        idleNodes.gain.gain.setValueAtTime(1, ctx.currentTime);
        idleEl.play().catch(() => {});
      }

      // A brief overlap (same track, same position, both at native tempo/
      // pitch by now) before killing the buffer-voice — guards against any
      // <audio> element play() start latency producing a gap, without
      // risking an audible clash since both sides are playing identical
      // content at this instant.
      const fromDeckId = m.fromDeckId;
      setTimeout(() => {
        try {
          m.voice.stop();
        } catch {
          // Already stopped — harmless.
        }
        const fromEl = deckEl(fromDeckId);
        if (fromEl) {
          fromEl.pause();
          fromEl.playbackRate = 1;
        }
        resetDeckNodes(fromDeckId, 1);
        loadedTrackId.current[fromDeckId] = null;
      }, 150);

      activeDeckRef.current = m.toDeckId;
      setActiveDeck(m.toDeckId);
      mashupRef.current = null;
      mashupLastAtRef.current = Date.now();
      useStore.getState().setIsTransitioning(false);
      useStore.getState().setActiveTransitionRationale(null);
      useStore.getState().next();
    }

    /**
     * Begins gliding the outgoing deck's own track from its native tempo
     * toward nextTrack's native tempo, using a SoundTouchJS buffer-voice in
     * place of the deck's <audio> element — the same swap technique the
     * mashup engine uses, just run on the other side, so the change is
     * genuinely independent of pitch instead of a playbackRate shift. Only
     * called for a plan.category === "tempo-ramp" pairing that already
     * passed isTempoRampEligible(); safe to call speculatively — bails out
     * on any staleness (track changed mid-decode) or if there isn't enough
     * runway left for a worthwhile ramp.
     */
    async function startTempoRamp(
      track: LocalTrack,
      nextTrack: Track,
      currentAnalysis: TrackAnalysis,
      nextAnalysis: TrackAnalysis
    ) {
      if (transitionRef.current || mashupRef.current || tempoRampRef.current || tempoRampStartingRef.current) return;
      tempoRampStartingRef.current = true;
      const trackIdAtStart = track.id;
      const nextTrackIdAtStart = nextTrack.id;
      try {
        const ctx = audioCtxRef.current;
        const masterGain = masterGainRef.current;
        if (!ctx || !masterGain) return;

        const deckId = activeDeckRef.current;
        const el = deckEl(deckId);
        const nodes = deckNodesRef.current[deckId];
        if (!el || !nodes) return;

        const buffer = await decodeTrackBuffer(ctx, track.sourceUrl);

        // The world may have moved on while decoding — abort rather than
        // ramp a pairing that's no longer current.
        const state = useStore.getState();
        if (transitionRef.current || mashupRef.current || tempoRampRef.current) return;
        if (state.currentTrack?.id !== trackIdAtStart || state.queue[0]?.id !== nextTrackIdAtStart) return;
        if (activeDeckRef.current !== deckId) return;

        const entryTrackTimeSec = el.currentTime;
        const remainingSec = buffer.duration - entryTrackTimeSec;
        // Not enough runway left for a worthwhile ramp — skip it, the
        // existing incoming-deck playbackRate ramp in startTransition still
        // covers this pairing as a fallback.
        if (remainingSec < TEMPO_RAMP_PRE_WINDOW_SEC * 0.5) return;

        const targetTempo = 1 / bestTempoRatio(currentAnalysis.bpm, nextAnalysis.bpm);

        const voice = createTimeStretchVoice(ctx, buffer, { tempo: 1, pitchSemitones: 0 });
        voice.setStartFraction(Math.max(0, Math.min(1, entryTrackTimeSec / buffer.duration)));
        const voiceGain = ctx.createGain();
        voiceGain.gain.value = 0;
        voice.node.connect(voiceGain);
        voiceGain.connect(masterGain);

        const now = ctx.currentTime;
        voiceGain.gain.setValueAtTime(0, now);
        voiceGain.gain.linearRampToValueAtTime(1, now + TEMPO_RAMP_SWAP_FADE_SEC);
        nodes.gain.gain.cancelScheduledValues(now);
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
        nodes.gain.gain.linearRampToValueAtTime(0, now + TEMPO_RAMP_SWAP_FADE_SEC);

        // Brief overlap while the voice spins up — both sides play identical
        // content from the same position at this instant, so a moment of
        // overlap is inaudible, unlike a gap would be.
        setTimeout(() => {
          el.pause();
        }, 150);

        const ramp: ActiveTempoRamp = {
          deckId,
          trackId: trackIdAtStart,
          nextTrackId: nextTrackIdAtStart,
          voice,
          voiceGain,
          entryTrackTimeSec,
          targetTempo,
          startTime: performance.now(),
          durationMs: TEMPO_RAMP_PRE_WINDOW_SEC * 1000,
          lastTickTime: performance.now(),
          trackTimeElapsedSec: 0,
          currentTempo: 1,
          tickIntervalId: null,
        };
        tempoRampRef.current = ramp;

        const tick = () => {
          const r = tempoRampRef.current;
          if (!r) return;
          // Staleness guard: if the pairing this ramp was computed for no
          // longer matches reality (track skipped/changed underneath it),
          // cancel outright rather than keep gliding toward a stale target.
          const s = useStore.getState();
          if (s.currentTrack?.id !== r.trackId || s.queue[0]?.id !== r.nextTrackId) {
            if (r.tickIntervalId != null) clearInterval(r.tickIntervalId);
            cancelTempoRamp();
            return;
          }
          const nowMs = performance.now();
          const realDeltaSec = (nowMs - r.lastTickTime) / 1000;
          r.trackTimeElapsedSec += realDeltaSec * r.currentTempo;
          r.lastTickTime = nowMs;

          const progress = Math.min(1, (nowMs - r.startTime) / r.durationMs);
          r.currentTempo = 1 + (r.targetTempo - 1) * progress;
          r.voice.setTempo(r.currentTempo);

          if (progress >= 1) {
            if (r.tickIntervalId != null) clearInterval(r.tickIntervalId);
            completeTempoRamp(r);
          }
        };
        ramp.tickIntervalId = setInterval(tick, TICK_INTERVAL_MS);
      } catch {
        // Decode/SoundTouchJS failure — just skip the pre-ramp.
        // tryAutoTransition falls back to the existing incoming-deck
        // playbackRate ramp at blend time.
      } finally {
        tempoRampStartingRef.current = false;
      }
    }

    /** Hands the tempo ramp back to the deck's own <audio> element at the matched rate it reached, then tears the buffer-voice down — mirrors completeMashup's own brief-overlap handoff. */
    function completeTempoRamp(r: ActiveTempoRamp) {
      const ctx = audioCtxRef.current;
      const el = deckEl(r.deckId);
      const nodes = deckNodesRef.current[r.deckId];
      if (ctx && el && nodes) {
        el.currentTime = r.entryTrackTimeSec + r.trackTimeElapsedSec;
        el.playbackRate = r.targetTempo;
        el.play().catch(() => {});
        const now = ctx.currentTime;
        nodes.gain.gain.cancelScheduledValues(now);
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
        nodes.gain.gain.linearRampToValueAtTime(1, now + TEMPO_RAMP_SWAP_FADE_SEC);
        r.voiceGain.gain.cancelScheduledValues(now);
        r.voiceGain.gain.setValueAtTime(r.voiceGain.gain.value, now);
        r.voiceGain.gain.linearRampToValueAtTime(0, now + TEMPO_RAMP_SWAP_FADE_SEC);
      }

      const voice = r.voice;
      setTimeout(() => {
        try {
          voice.stop();
        } catch {
          // Already stopped — harmless.
        }
      }, 150);

      tempoRampRef.current = null;
      tempoRampCompletedPairRef.current = `${r.trackId}>${r.nextTrackId}`;
    }

    /** A synthesized noise-decay impulse response standing in for a real captured hall/stadium recording — no bundled audio asset, same zero-asset approach as every other FX in this app. Built once and shared across every deck's ConvolverNode. */
    function getStadiumImpulseResponse(ctx: AudioContext): AudioBuffer {
      if (stadiumIrRef.current) return stadiumIrRef.current;
      const durationSec = 3.2;
      const sampleCount = Math.floor(ctx.sampleRate * durationSec);
      const buffer = ctx.createBuffer(2, sampleCount, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < sampleCount; i++) {
          const t = i / sampleCount;
          const decay = Math.pow(1 - t, 2.2); // slow, dense tail — reads as a big room, not a small one
          data[i] = (Math.random() * 2 - 1) * decay;
        }
      }
      stadiumIrRef.current = buffer;
      return buffer;
    }

    /**
     * Lazily builds the vocal-forward reverb/delay send for one deck, tapped
     * from that deck's existing (already-connected) filter node — built
     * once per deck, then reused on every later vocal-echo trigger.
     *
     * Rough vocal isolation via mid/side processing: most pop/EDM mixes
     * place vocals near-center, so boosting mid ((L+R)*0.5) while
     * subtracting side ((L-R)*0.5) is a real, if approximate, mixing-
     * engineer technique for pulling vocal-ish content forward — not a
     * guess. It's not true source separation (that needs a Demucs/
     * Spleeter-class ML model, out of scope for a browser tab), so
     * instruments panned near-center bleed through too.
     */
    function getOrCreateVocalEchoNodes(deckId: DeckId, ctx: AudioContext, deckNodes: DeckNodes, masterGain: GainNode): VocalEchoNodes {
      const existing = vocalEchoNodesRef.current[deckId];
      if (existing) return existing;

      const splitter = ctx.createChannelSplitter(2);
      deckNodes.filter.connect(splitter);

      const midL = ctx.createGain();
      midL.gain.value = 0.5;
      const midR = ctx.createGain();
      midR.gain.value = 0.5;
      const sideL = ctx.createGain();
      sideL.gain.value = 0.5;
      const sideR = ctx.createGain();
      sideR.gain.value = -0.5;
      splitter.connect(midL, 0);
      splitter.connect(midR, 1);
      splitter.connect(sideL, 0);
      splitter.connect(sideR, 1);

      const midSum = ctx.createGain();
      midSum.gain.value = 1.4; // boost the (rough) vocal-forward center
      const sideSum = ctx.createGain();
      sideSum.gain.value = -0.6; // subtract the (rough) stereo-width content
      midL.connect(midSum);
      midR.connect(midSum);
      sideL.connect(sideSum);
      sideR.connect(sideSum);

      const vocalForward = ctx.createGain();
      midSum.connect(vocalForward);
      sideSum.connect(vocalForward);

      const convolver = ctx.createConvolver();
      convolver.buffer = getStadiumImpulseResponse(ctx);
      convolver.normalize = true;
      const reverbGain = ctx.createGain();
      vocalForward.connect(convolver);
      convolver.connect(reverbGain);

      const slapDelay = ctx.createDelay(1);
      slapDelay.delayTime.value = 0.11;
      const slapFeedback = ctx.createGain();
      slapFeedback.gain.value = 0.28;
      const delayGain = ctx.createGain();
      delayGain.gain.value = 0.7;
      vocalForward.connect(slapDelay);
      slapDelay.connect(slapFeedback);
      slapFeedback.connect(slapDelay);
      slapDelay.connect(delayGain);

      const sendGain = ctx.createGain();
      sendGain.gain.value = 0;
      reverbGain.connect(sendGain);
      delayGain.connect(sendGain);
      sendGain.connect(masterGain);

      // Direct (dry) send for the acapella drop — plays the isolated
      // vocal-forward signal alone, without the reverb/delay coloring,
      // while the main deck gain is ducked. Silent by default, same as sendGain.
      const dryGain = ctx.createGain();
      dryGain.gain.value = 0;
      vocalForward.connect(dryGain);
      dryGain.connect(masterGain);

      const nodes: VocalEchoNodes = {
        splitter,
        vocalForward,
        convolver,
        reverbGain,
        slapDelay,
        slapFeedback,
        delayGain,
        sendGain,
        dryGain,
      };
      vocalEchoNodesRef.current[deckId] = nodes;
      return nodes;
    }

    /**
     * The acoustic-feel + stadium-echo vocal moment: gently rolls off harsh
     * highs and heavy low end on the deck's normal signal (an EQ move, no
     * new nodes) while ramping up the vocal-forward reverb/delay send —
     * both ease back to neutral by the end, never a sudden drop.
     */
    function triggerVocalEcho(deckId: DeckId, windowSec: number) {
      const ctx = audioCtxRef.current;
      const masterGain = masterGainRef.current;
      const nodes = deckNodesRef.current[deckId];
      if (!ctx || !masterGain || !nodes) return;
      const vocalNodes = getOrCreateVocalEchoNodes(deckId, ctx, nodes, masterGain);
      const now = ctx.currentTime;

      nodes.filter.type = "lowpass";
      nodes.filter.frequency.cancelScheduledValues(now);
      nodes.filter.frequency.setValueAtTime(20000, now);
      nodes.filter.frequency.linearRampToValueAtTime(3200, now + windowSec * 0.3);
      nodes.filter.frequency.setValueAtTime(3200, now + windowSec * 0.7);
      nodes.filter.frequency.linearRampToValueAtTime(20000, now + windowSec);

      nodes.lowShelf.gain.cancelScheduledValues(now);
      nodes.lowShelf.gain.setValueAtTime(0, now);
      nodes.lowShelf.gain.linearRampToValueAtTime(-8, now + windowSec * 0.3);
      nodes.lowShelf.gain.setValueAtTime(-8, now + windowSec * 0.7);
      nodes.lowShelf.gain.linearRampToValueAtTime(0, now + windowSec);

      nodes.delaySend.gain.cancelScheduledValues(now);
      nodes.delaySend.gain.setValueAtTime(nodes.delaySend.gain.value, now);
      nodes.delaySend.gain.linearRampToValueAtTime(0, now + windowSec * 0.3);

      vocalNodes.sendGain.gain.cancelScheduledValues(now);
      vocalNodes.sendGain.gain.setValueAtTime(0, now);
      vocalNodes.sendGain.gain.linearRampToValueAtTime(0.9, now + windowSec * 0.3);
      vocalNodes.sendGain.gain.setValueAtTime(0.9, now + windowSec * 0.7);
      vocalNodes.sendGain.gain.linearRampToValueAtTime(0, now + windowSec);
    }

    /**
     * A standalone backspin flourish — reuses the same ease-out deceleration
     * curve as the Spinback/Brake transition, but as an in-track ad-lib: rides
     * the active deck's own playbackRate down toward BRAKE_MIN_RATE and back
     * to 1, never touching gain, so there's never a moment of silence.
     * Guarded by backspinRef so a track change or seek mid-backspin can
     * cancel it before it applies a stale rate to whatever loads next.
     */
    function triggerBackspin(deckId: DeckId, windowSec: number) {
      if (backspinRef.current) return;
      const el = deckEl(deckId);
      if (!el) return;
      const decelRatio = 0.75;
      const decelMs = windowSec * decelRatio * 1000;
      const recoverMs = windowSec * (1 - decelRatio) * 1000;
      const startedAt = performance.now();
      const intervalId = setInterval(() => {
        const b = backspinRef.current;
        if (!b) return;
        const loopEl = deckEl(b.deckId);
        if (!loopEl) return;
        const elapsed = performance.now() - startedAt;
        if (elapsed < decelMs) {
          const progress = elapsed / decelMs;
          const eased = 1 - Math.pow(1 - progress, 3);
          loopEl.playbackRate = 1 - eased * (1 - BRAKE_MIN_RATE);
        } else if (elapsed < decelMs + recoverMs) {
          const progress = (elapsed - decelMs) / recoverMs;
          loopEl.playbackRate = BRAKE_MIN_RATE + progress * (1 - BRAKE_MIN_RATE);
        } else {
          loopEl.playbackRate = 1;
          clearInterval(b.intervalId);
          backspinRef.current = null;
        }
      }, TICK_INTERVAL_MS);
      backspinRef.current = { deckId, intervalId };
    }

    /**
     * The freeform beat-loop primitive: repeats a short beat-aligned segment
     * of the *currently playing* track by rewinding the active <audio>
     * element's own currentTime back to startSec once it reaches endSec —
     * no separate buffer voice, no new node graph, so release after the
     * final repeat is inherently seamless (playback simply stops being
     * rewound and continues forward exactly as it already was).
     * Honest limitation: the loop-back splice isn't zero-crossing-aligned;
     * beat-grid snapping keeps it landing on-beat, but a very quiet click at
     * the seam is possible on some material.
     */
    function startBeatLoop(
      deckId: DeckId,
      analysis: TrackAnalysis,
      currentTimeSec: number,
      barsCount: number,
      repeatCount: number
    ) {
      if (loopRef.current) return;
      const el = deckEl(deckId);
      if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
      const startSec = snapToBeatGrid(currentTimeSec, analysis.beatGridOffsetSec, analysis.bpm);
      const effectiveBpm = analysis.bpm > 0 ? analysis.bpm : 120;
      const endSec = startSec + (barsCount * 4 * 60) / effectiveBpm;
      if (endSec >= el.duration - 1) return;

      const loop: ActiveLoop = { deckId, startSec, endSec, repeatsRemaining: repeatCount, tickIntervalId: null };
      loop.tickIntervalId = setInterval(() => {
        const l = loopRef.current;
        if (!l) return;
        const loopEl = deckEl(l.deckId);
        if (!loopEl) return;
        if (loopEl.currentTime >= l.endSec) {
          l.repeatsRemaining -= 1;
          if (l.repeatsRemaining <= 0) {
            if (l.tickIntervalId != null) clearInterval(l.tickIntervalId);
            loopRef.current = null;
            return;
          }
          loopEl.currentTime = l.startSec;
        }
      }, TICK_INTERVAL_MS);
      loopRef.current = loop;
    }

    /**
     * Ducks the deck's normal mix down while bringing the isolated
     * vocal-forward signal up to play alone, dry, for a phrase — then
     * reverses both. Reuses the same M/S tap built for the vocal-echo
     * moment; both sides only ever ramp, so the full mix is always heard
     * fading back in rather than snapping back.
     */
    function triggerAcapellaDrop(deckId: DeckId, windowSec: number) {
      const ctx = audioCtxRef.current;
      const masterGain = masterGainRef.current;
      const nodes = deckNodesRef.current[deckId];
      if (!ctx || !masterGain || !nodes) return;
      const vocalNodes = getOrCreateVocalEchoNodes(deckId, ctx, nodes, masterGain);
      const now = ctx.currentTime;
      const duckedLevel = 0.08;

      nodes.gain.gain.cancelScheduledValues(now);
      nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
      nodes.gain.gain.linearRampToValueAtTime(duckedLevel, now + windowSec * 0.15);
      nodes.gain.gain.setValueAtTime(duckedLevel, now + windowSec * 0.85);
      nodes.gain.gain.linearRampToValueAtTime(1, now + windowSec);

      vocalNodes.dryGain.gain.cancelScheduledValues(now);
      vocalNodes.dryGain.gain.setValueAtTime(0, now);
      vocalNodes.dryGain.gain.linearRampToValueAtTime(1.6, now + windowSec * 0.15);
      vocalNodes.dryGain.gain.setValueAtTime(1.6, now + windowSec * 0.85);
      vocalNodes.dryGain.gain.linearRampToValueAtTime(0, now + windowSec);
    }

    /** Occasional mid-track FX — never during an active transition, gated by ambienceEnabled/ambienceFrequency and shouldTriggerAmbience()'s own cooldown/energy-curve logic. */
    function tryAmbience() {
      if (transitionRef.current || mashupRef.current || loopRef.current || backspinRef.current || tempoRampRef.current)
        return;
      const state = useStore.getState();
      if (!state.ambienceEnabled || state.ambienceFrequency === "off") return;
      const track = state.currentTrack;
      if (!track) return;
      const activeEl = deckEl(activeDeckRef.current);
      const ctx = audioCtxRef.current;
      if (!activeEl || !ctx) return;
      const currentTime = activeEl.currentTime;

      if (ambienceStateRef.current.trackId !== track.id) {
        ambienceStateRef.current = { trackId: track.id, lastTriggeredSec: null };
      }
      const cue = shouldTriggerAmbience({
        analysis: getAnalysis(track.id),
        durationSec: track.durationSec,
        currentTimeSec: currentTime,
        lastTriggeredSec: ambienceStateRef.current.lastTriggeredSec,
        frequency: state.ambienceFrequency,
      });
      if (!cue) return;
      ambienceStateRef.current.lastTriggeredSec = currentTime;

      if (cue.effect === "riser") {
        startRiserLayer(ctx, cue.windowSec);
      } else if (cue.effect === "echo-tail") {
        const nodes = deckNodesRef.current[activeDeckRef.current];
        if (!nodes) return;
        const now = ctx.currentTime;
        nodes.delaySend.gain.cancelScheduledValues(now);
        nodes.delaySend.gain.setValueAtTime(0, now);
        nodes.delaySend.gain.linearRampToValueAtTime(ECHO_WET_LEVEL, now + cue.windowSec * 0.6);
        nodes.delaySend.gain.linearRampToValueAtTime(0, now + cue.windowSec);
      } else if (cue.effect === "vocal-echo") {
        triggerVocalEcho(activeDeckRef.current, cue.windowSec);
      } else if (cue.effect === "backspin") {
        triggerBackspin(activeDeckRef.current, cue.windowSec);
      } else if (cue.effect === "acapella-drop") {
        triggerAcapellaDrop(activeDeckRef.current, cue.windowSec);
      } else if (cue.effect === "drum-break") {
        startBeatLoop(activeDeckRef.current, getAnalysis(track.id), currentTime, cue.barsCount, cue.repeatCount);
      }
    }

    /** Nothing queued to transition into — instead of an abrupt stop, fade the active deck's gain to 0 so it reaches silence right as the track naturally ends. Recomputing from the current gain value every tick (rather than a one-shot scheduled ramp) keeps this self-correcting if the check re-fires before the fade completes. */
    function fadeOutIfEnding(activeEl: HTMLAudioElement, duration: number, currentTime: number) {
      const remaining = duration - currentTime;
      if (remaining > TRACK_FADE_OUT_SEC) return;
      const ctx = audioCtxRef.current;
      const nodes = deckNodesRef.current[activeDeckRef.current];
      if (!ctx || !nodes) return;
      const now = ctx.currentTime;
      nodes.gain.gain.cancelScheduledValues(now);
      nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
      nodes.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.05, remaining));
    }

    /**
     * Cross-source hand-off (local -> YouTube or YouTube -> local): the two
     * playback engines never share an audio graph, so there's no overlapping
     * blend to run — instead the outgoing local deck fades to silence over
     * `windowSec` (the same window a normal transition would use) and the
     * queue advances once that fade completes. Still never an abrupt cut,
     * just not a true overlapping crossfade — that remains a stretch goal.
     */
    function fadeThenAdvance(windowSec: number) {
      if (crossSourceFadeTimeoutRef.current != null) return; // already fading out
      const ctx = audioCtxRef.current;
      const nodes = deckNodesRef.current[activeDeckRef.current];
      if (ctx && nodes) {
        const now = ctx.currentTime;
        nodes.gain.gain.cancelScheduledValues(now);
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
        nodes.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.05, windowSec));
      }
      crossSourceFadeTimeoutRef.current = setTimeout(() => {
        crossSourceFadeTimeoutRef.current = null;
        useStore.getState().next();
      }, Math.max(50, windowSec * 1000));
    }

    function tryAutoTransition() {
      if (transitionRef.current || mashupRef.current || loopRef.current || backspinRef.current) return;
      const state = useStore.getState();
      const track = state.currentTrack;
      if (!track) return;
      if (track.source !== "local") return; // owned by YouTubeDeckStage/SpotifyDeckStage
      const activeEl = deckEl(activeDeckRef.current);
      if (!activeEl) return;
      const duration = activeEl.duration;
      if (!duration || !Number.isFinite(duration)) return;
      // While a pre-transition tempo ramp is running, the deck's own <audio>
      // element is paused (the buffer-voice is carrying playback instead),
      // so its currentTime is frozen — use the ramp's own running estimate
      // of track position instead, or every timing trigger below would stop
      // advancing for the whole ramp window.
      const activeRamp =
        tempoRampRef.current?.deckId === activeDeckRef.current ? tempoRampRef.current : null;
      const currentTime = activeRamp
        ? activeRamp.entryTrackTimeSec + activeRamp.trackTimeElapsedSec
        : activeEl.currentTime;

      const nextTrack = state.queue[0];
      if (!nextTrack) {
        fadeOutIfEnding(activeEl, duration, currentTime);
        return;
      }

      if (!state.autoDjEnabled) {
        const plan = planSimpleFade(AUTO_DJ_OFF_FADE_SEC);
        const clampedWindow = Math.min(plan.windowSec, duration / 2);
        if (duration - currentTime <= clampedWindow) {
          if (nextTrack.source !== "local") {
            fadeThenAdvance(clampedWindow);
          } else {
            startTransition(nextTrack, { ...plan, windowSec: clampedWindow });
          }
        }
        return;
      }

      const currentAnalysis = getAnalysis(track.id);

      // Opportunistic matched mashup: a rarer, bigger "special moment" than
      // a normal transition, so it's checked first (and takes over the
      // whole tick if triggered) rather than folded into planTransition's
      // own scoring. Needs a longer runway than a normal transition window
      // — it only fires once there's just enough of the current track left
      // for the whole planned overlap to actually fit before the file ends.
      if (
        state.mashupEnabled &&
        nextTrack.source === "local" &&
        !mashupRef.current &&
        !mashupStartingRef.current &&
        !tempoRampRef.current
      ) {
        const cooldownOk =
          mashupLastAtRef.current == null || Date.now() - mashupLastAtRef.current >= MASHUP_COOLDOWN_SEC * 1000;
        if (cooldownOk) {
          const pairKey = `${track.id}>${nextTrack.id}`;
          if (mashupPlanCacheRef.current?.pairKey !== pairKey) {
            const plan = planMashup(
              { track, analysis: currentAnalysis },
              { track: nextTrack, analysis: getAnalysis(nextTrack.id) }
            );
            mashupPlanCacheRef.current = { pairKey, plan };
          }
          const mashupPlan = mashupPlanCacheRef.current.plan;
          if (mashupPlan && duration - currentTime <= mashupPlan.durationSec) {
            void startMashup(nextTrack, mashupPlan);
            return;
          }
        }
      }

      const nextAnalysis = getAnalysis(nextTrack.id);
      const plan = planTransition({
        current: { track, analysis: currentAnalysis },
        next: { track: nextTrack, analysis: nextAnalysis },
        genreHint: state.styleGenreHint,
        overrideSec: state.crossfadeOverrideSec,
        currentElapsedSec: currentTime,
        djMode: state.djMode,
        recentTransitionIds: recentTransitionIdsRef.current,
        forceTransitionId: state.forcedTransitionId,
        excludeTransitionIds: state.rerolledTransitionIds,
        varietyBias: state.djVarietyBias,
        categoryWeights: useDjWeights.getState().categoryWeights,
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
      // Double Drop and Breakdown Mixing are gated behind MIN_ACTIVE_PLAY_SEC
      // (a floor, not a ceiling) — they're the two *opportunistic* triggers
      // that could otherwise fire well before a track's had any real airtime.
      const nearNaturalEnd = duration - currentTime <= clampedWindow;
      const pastActiveCap = currentTime >= MAX_ACTIVE_PLAY_SEC - clampedWindow;
      const pastMinFloor = currentTime >= MIN_ACTIVE_PLAY_SEC;
      const dropAligned =
        pastMinFloor &&
        plan.category === "drop" &&
        currentAnalysis.dropAtSec != null &&
        currentTime >= currentAnalysis.dropAtSec - clampedWindow &&
        currentTime < currentAnalysis.dropAtSec + clampedWindow;
      const breakdownOpportunity =
        pastMinFloor &&
        plan.category !== "drop" &&
        currentAnalysis.breakdownAtSec != null &&
        currentTime >= currentAnalysis.breakdownAtSec - clampedWindow &&
        currentTime < currentAnalysis.breakdownAtSec + clampedWindow;

      const pairKey = `${track.id}>${nextTrack.id}`;
      // A Tempo Ramp pick gets an earlier, separate anticipation check: start
      // gliding the outgoing deck's tempo TEMPO_RAMP_PRE_WINDOW_SEC before
      // any of the normal triggers below would actually fire, so both decks
      // are already close in tempo by the time the real blend starts. Uses
      // the same four trigger shapes, just widened by that lead time.
      if (
        plan.category === "tempo-ramp" &&
        !tempoRampRef.current &&
        !tempoRampStartingRef.current &&
        tempoRampCompletedPairRef.current !== pairKey &&
        isTempoRampEligible(currentAnalysis, nextAnalysis)
      ) {
        const anticipationWindow = clampedWindow + TEMPO_RAMP_PRE_WINDOW_SEC;
        const nearNaturalEndSoon = duration - currentTime <= anticipationWindow;
        const pastActiveCapSoon = currentTime >= MAX_ACTIVE_PLAY_SEC - anticipationWindow;
        const pastMinFloorSoon = currentTime >= MIN_ACTIVE_PLAY_SEC - TEMPO_RAMP_PRE_WINDOW_SEC;
        const breakdownOpportunitySoon =
          pastMinFloorSoon &&
          currentAnalysis.breakdownAtSec != null &&
          currentTime >= currentAnalysis.breakdownAtSec - anticipationWindow &&
          currentTime < currentAnalysis.breakdownAtSec + anticipationWindow;
        if (nearNaturalEndSoon || pastActiveCapSoon || breakdownOpportunitySoon) {
          void startTempoRamp(track, nextTrack, currentAnalysis, nextAnalysis);
        }
      }

      if (nearNaturalEnd || pastActiveCap || dropAligned || breakdownOpportunity) {
        if (nextTrack.source !== "local") {
          fadeThenAdvance(clampedWindow);
          tempoRampCompletedPairRef.current = null;
          return;
        }
        // If the outgoing deck already glided to the incoming track's tempo
        // via startTempoRamp, the blend itself needs no further tempo
        // ramping — both decks are already matched, so this is just a
        // normal equal-power crossfade at native tempo on both sides.
        const finalPlan =
          tempoRampCompletedPairRef.current === pairKey
            ? { ...plan, windowSec: clampedWindow, tempoSync: true, tempoRatioStart: 1 }
            : { ...plan, windowSec: clampedWindow };
        applyLearningNudge(track, nextTrack, state, currentTime, finalPlan);
        startTransition(nextTrack, finalPlan);
        tempoRampCompletedPairRef.current = null;
      }
    }

    const interval = setInterval(() => {
      if (useStore.getState().currentTrack?.source !== "local") return; // owned by YouTubeDeckStage/SpotifyDeckStage
      const activeEl = deckEl(activeDeckRef.current);
      if (activeEl) {
        // Same reasoning as tryAutoTransition's own currentTime read: the
        // deck's <audio> element is paused during a pre-transition tempo
        // ramp, so the displayed position needs the ramp's own running
        // estimate instead, or the progress bar would appear to freeze.
        const activeRamp =
          tempoRampRef.current?.deckId === activeDeckRef.current ? tempoRampRef.current : null;
        useStore
          .getState()
          .setCurrentTime(
            activeRamp ? activeRamp.entryTrackTimeSec + activeRamp.trackTimeElapsedSec : activeEl.currentTime
          );
      }
      tryAutoTransition();
      tryAmbience();
    }, 500);

    const unsubscribe = useStore.subscribe((state, prevState) => {
      if (state.mixNowRequestId === prevState.mixNowRequestId) return;
      if (transitionRef.current || mashupRef.current) return;
      const track = state.currentTrack;
      const nextTrack = state.queue[0];
      if (!track || !nextTrack) return;
      if (track.source !== "local") return; // owned by YouTubeDeckStage/SpotifyDeckStage
      if (nextTrack.source !== "local") {
        fadeThenAdvance(AUTO_DJ_OFF_FADE_SEC);
        return;
      }
      const activeEl = deckEl(activeDeckRef.current);
      const plan = planTransition({
        current: { track, analysis: getAnalysis(track.id) },
        next: { track: nextTrack, analysis: getAnalysis(nextTrack.id) },
        genreHint: state.styleGenreHint,
        overrideSec: state.crossfadeOverrideSec,
        currentElapsedSec: activeEl?.currentTime ?? null,
        djMode: state.djMode,
        recentTransitionIds: recentTransitionIdsRef.current,
        forceTransitionId: state.forcedTransitionId,
        excludeTransitionIds: state.rerolledTransitionIds,
        varietyBias: state.djVarietyBias,
        categoryWeights: useDjWeights.getState().categoryWeights,
      });
      applyLearningNudge(track, nextTrack, state, activeEl?.currentTime ?? null, plan);
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
      if (mashupRef.current?.tickIntervalId != null) {
        clearInterval(mashupRef.current.tickIntervalId);
      }
      try {
        mashupRef.current?.voice.stop();
      } catch {
        // Already stopped — harmless.
      }
      mashupRef.current = null;
      if (loopRef.current?.tickIntervalId != null) {
        clearInterval(loopRef.current.tickIntervalId);
      }
      loopRef.current = null;
      if (backspinRef.current != null) {
        clearInterval(backspinRef.current.intervalId);
      }
      backspinRef.current = null;
      if (tempoRampRef.current?.tickIntervalId != null) {
        clearInterval(tempoRampRef.current.tickIntervalId);
      }
      try {
        tempoRampRef.current?.voice.stop();
      } catch {
        // Already stopped — harmless.
      }
      tempoRampRef.current = null;
      if (crossSourceFadeTimeoutRef.current != null) {
        clearTimeout(crossSourceFadeTimeoutRef.current);
        crossSourceFadeTimeoutRef.current = null;
      }
      elA?.removeEventListener("ended", onEndedA);
      elB?.removeEventListener("ended", onEndedB);
    };
  }, [cancelTempoRamp, deckEl, resetDeckNodes, stopOverlayNodes]);

  // External track changes (library/queue click, next/previous, playlist
  // play) land here. Transitions we drive ourselves already have the new
  // deck's loadedTrackId pre-set to match, so this effect is a no-op for
  // those and only does real work for genuinely new external picks —
  // which always start at the literal beginning, preserving "play this
  // track from the top" semantics for a direct click (only mix
  // transitions use the analyzed entry point).
  useEffect(() => {
    if (!currentTrack) return;
    if (crossSourceFadeTimeoutRef.current != null) {
      clearTimeout(crossSourceFadeTimeoutRef.current);
      crossSourceFadeTimeoutRef.current = null;
    }
    if (currentTrack.source !== "local") {
      // Ownership transferred to YouTubeDeckStage/SpotifyDeckStage — release
      // both local decks so nothing local keeps playing underneath.
      cancelTransition();
      cancelMashup();
      cancelLoop();
      cancelBackspin();
      cancelTempoRamp();
      (["A", "B"] as DeckId[]).forEach((id) => deckEl(id)?.pause());
      loadedTrackId.current = { A: null, B: null };
      return;
    }
    if (loadedTrackId.current[activeDeck] === currentTrack.id) return;

    cancelTransition();
    cancelMashup();
    cancelLoop();
    cancelBackspin();
    cancelTempoRamp();

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
    resetDeckNodes(activeDeck, 0);
    activeEl.playbackRate = 1;
    activeEl.src = currentTrack.sourceUrl;
    // A track that starts outside of a transition (a direct pick, or the
    // very first track of a session) fades in from silence instead of
    // snapping to full volume — tracks that arrive via a real transition
    // never hit this branch (loadedTrackId already matches), so this never
    // stacks with a transition's own gain curve.
    const activeNodes = deckNodesRef.current[activeDeck];
    const ctx = audioCtxRef.current;
    if (ctx && activeNodes) {
      const now = ctx.currentTime;
      activeNodes.gain.gain.cancelScheduledValues(now);
      activeNodes.gain.gain.setValueAtTime(0, now);
      activeNodes.gain.gain.linearRampToValueAtTime(1, now + TRACK_FADE_IN_SEC);
    }
    if (useStore.getState().isPlaying) {
      audioCtxRef.current?.resume().catch(() => {});
      activeEl.play().catch(() => {});
    }
  }, [
    currentTrack,
    activeDeck,
    cancelBackspin,
    cancelLoop,
    cancelMashup,
    cancelTempoRamp,
    cancelTransition,
    deckEl,
    resetDeckNodes,
  ]);

  useEffect(() => {
    const activeEl = deckEl(activeDeck);
    if (!activeEl || !currentTrack || currentTrack.source !== "local") return;
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
    if (seekRequest == null || currentTrack?.source !== "local") return; // owned by YouTubeDeckStage/SpotifyDeckStage
    cancelTransition();
    cancelMashup();
    cancelLoop();
    cancelBackspin();
    cancelTempoRamp();
    const activeEl = deckEl(activeDeck);
    if (activeEl) activeEl.currentTime = seekRequest;
    clearSeekRequest();
  }, [
    seekRequest,
    activeDeck,
    currentTrack,
    cancelBackspin,
    cancelLoop,
    cancelMashup,
    cancelTempoRamp,
    clearSeekRequest,
    cancelTransition,
    deckEl,
  ]);

  return (
    <>
      {/* crossOrigin is required for createMediaElementSource to read samples
          from cross-origin audio (Vercel Blob) — without it the element still
          plays normally, but the Web Audio graph it feeds outputs silence. */}
      <audio ref={audioARef} preload="auto" crossOrigin="anonymous" className="hidden" />
      <audio ref={audioBRef} preload="auto" crossOrigin="anonymous" className="hidden" />
    </>
  );
}
