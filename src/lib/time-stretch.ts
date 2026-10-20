/**
 * Tempo/pitch-independent playback of a decoded buffer, behind a small interface — the same way audio-analysis.ts
 * isolates its WASM/worker fast paths behind analyzeTrackFromUrl(). Used by the mashups, the pre-transition tempo ramp
 * and the Song Sync morph (all in DualDeckStage.tsx).
 *
 * The real engine is an AudioWorklet (public/worklets/time-stretch.js, built from SoundTouchJS's WSOLA code plus
 * src/worklets/time-stretch-processor.js): it runs on the audio rendering thread, so a busy page cannot make it miss a
 * block. It used to be SoundTouchJS's PitchShifter, a ScriptProcessorNode that needs the MAIN thread to deliver an event
 * for every 1024 frames; measured on the real player, those events arrived late (up to 49 ms against a 21 ms budget)
 * and every late one was a hole in the sound, which is what "choppy transitions" was. That voice is kept only as the
 * fallback for a browser without AudioWorklet (or if the module fails to load): call preloadTimeStretch(ctx) early so
 * createTimeStretchVoice (which must stay synchronous) can use the worklet.
 *
 * Both still stretch with WSOLA, so a full mix gets mild "warble/phasiness" the further the tempo or pitch strays from
 * 1x/0 semitones: an accepted tradeoff, not a claim of studio-transparent quality.
 */

import { PitchShifter } from "soundtouchjs";

const WORKLET_URL = "/worklets/time-stretch.js";
const PROCESSOR_NAME = "time-stretch";
const FALLBACK_BUFFER_SIZE = 1024;
/** Audio kept before the wanted start so the stretcher's initial skip has something to read. */
const LEAD_IN_FRAMES = 4096;
/** The old ScriptProcessor voice's output trailed the position it had read by this much of the track's own time (measured when it was the only voice). Only the fallback needs it. */
const SCRIPT_PROCESSOR_LAG_SEC = 0.2;
/** The old voice's first audible output sat this far past where it was told to start (the stretcher's initial skip, less what its buffering took back). Only the fallback needs it. */
const SCRIPT_PROCESSOR_START_LEAD_SEC = 0.027;

export interface TimeStretchVoice {
  /** Connect this into the rest of a Web Audio graph. Nothing can connect into it. */
  node: AudioNode;
  setTempo(tempo: number): void;
  setPitchSemitones(semitones: number): void;
  /**
   * Where in the source the audio starts, as a fraction (0-1) of the buffer: the first sample you hear is that one.
   * Call it right after creating the voice (a voice never told where to start begins at 0 on the next tick). With
   * `atContextSec` the voice stays silent until that AudioContext time, then begins on exactly that frame, so a
   * hand-over can be scheduled instead of landing whenever a message happens to arrive. Calling it again re-seeks.
   */
  setStartFraction(fraction: number, atContextSec?: number): void;
  /** Where in the SOURCE the audio being heard right now comes from, seconds: best estimate, accurate to a few milliseconds on average. */
  getPositionSec(): number;
  /** Releases listeners and disconnects the node — call once the voice is done playing. */
  stop(): void;
}

export interface TimeStretchOptions {
  /** Playback speed ratio relative to the buffer's native tempo (1 = unchanged). */
  tempo: number;
  /** Pitch shift in semitones, independent of tempo (0 = unchanged). */
  pitchSemitones: number;
  /** Fires once the buffer finishes playing on its own (not called by stop()). */
  onEnd?: () => void;
  /**
   * Play the source untouched, sample for sample: for a voice that will only ever be at tempo 1 and pitch 0 (a Song Sync
   * morph that holds the tempo). No WSOLA, so no smearing and no timing jitter, and the hand-over is exact; setTempo and
   * setPitchSemitones are ignored. Only the worklet voice can do this; the fallback stretches as usual.
   */
  exact?: boolean;
  /** Most of the source (from the start point) the voice will ever play, seconds. The audio is copied to the audio thread, so a morph that needs 40 s of a 4-minute track should say so rather than copy all 4 minutes. Playing past it counts as the end. */
  maxSourceSec?: number;
}

const loadingModules = new WeakMap<BaseAudioContext, Promise<boolean>>();
const loadedModules = new WeakSet<BaseAudioContext>();

/**
 * Loads the stretcher worklet into a context; resolves true when voices created for it will use the worklet, false when
 * they will fall back (no AudioWorklet support, or the module failed to load). Safe to call repeatedly.
 */
export function preloadTimeStretch(ctx: BaseAudioContext): Promise<boolean> {
  let loading = loadingModules.get(ctx);
  if (!loading) {
    loading = (async () => {
      try {
        if (typeof AudioWorkletNode === "undefined" || !ctx.audioWorklet) return false;
        await ctx.audioWorklet.addModule(WORKLET_URL);
        loadedModules.add(ctx);
        return true;
      } catch (err) {
        console.warn("Time-stretch worklet unavailable, using the main-thread fallback:", err);
        return false;
      }
    })();
    loadingModules.set(ctx, loading);
  }
  return loading;
}

/** Wraps a decoded AudioBuffer in a tempo/pitch-independent playback voice. */
export function createTimeStretchVoice(ctx: AudioContext, buffer: AudioBuffer, options: TimeStretchOptions): TimeStretchVoice {
  if (loadedModules.has(ctx)) {
    try {
      return createWorkletVoice(ctx, buffer, options);
    } catch (err) {
      console.warn("Time-stretch worklet voice failed, using the main-thread fallback:", err);
    }
  }
  return createScriptProcessorVoice(ctx, buffer, options);
}

function createWorkletVoice(
  ctx: AudioContext,
  buffer: AudioBuffer,
  { tempo, pitchSemitones, onEnd, maxSourceSec, exact }: TimeStretchOptions
): TimeStretchVoice {
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  const rate = buffer.sampleRate;
  let currentTempo = exact ? 1 : tempo;
  let report: { source: number; at: number } | null = null;
  let startFrame = 0;
  let started = false;
  let stopped = false;

  node.port.onmessage = (event: MessageEvent) => {
    const m = event.data as { type: string; sourceFrame?: number; atFrame?: number };
    if (m.type === "pos" && m.sourceFrame != null && m.atFrame != null) report = { source: m.sourceFrame, at: m.atFrame };
    else if (m.type === "ended" && !stopped) onEnd?.();
  };
  // Tempo and pitch first: the processor works out where to start feeding from them when the audio arrives.
  node.port.postMessage({ type: "tempo", value: tempo });
  node.port.postMessage({ type: "pitch", semitones: pitchSemitones });

  const start = (fraction: number, atContextSec?: number) => {
    if (stopped) return;
    started = true;
    report = null;
    startFrame = Math.max(0, Math.min(buffer.length, Math.floor(fraction * buffer.length)));
    const from = Math.max(0, startFrame - LEAD_IN_FRAMES);
    const to = maxSourceSec != null ? Math.min(buffer.length, startFrame + Math.ceil(maxSourceSec * rate)) : buffer.length;
    // Copies (the AudioBuffer keeps its own data), handed over without a second copy.
    const left = buffer.getChannelData(0).slice(from, to);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice(from, to) : undefined;
    node.port.postMessage(
      { type: "load", left, right, baseFrame: from, startFrame, exact: !!exact, atFrame: atContextSec != null ? Math.round(atContextSec * ctx.sampleRate) : 0 },
      right ? [left.buffer, right.buffer] : [left.buffer]
    );
  };
  // A caller that never says where to start still gets sound, from the top, once its own synchronous setup is done.
  queueMicrotask(() => {
    if (!started) start(0);
  });

  return {
    node,
    setTempo: (t) => {
      if (exact) return;
      currentTempo = t;
      node.port.postMessage({ type: "tempo", value: t });
    },
    setPitchSemitones: (semitones) => {
      node.port.postMessage({ type: "pitch", semitones });
    },
    setStartFraction: start,
    getPositionSec: () => {
      if (!report) return startFrame / rate;
      // The audio thread reports every ~10 ms; carry the last report forward to now at the current tempo.
      const framesSince = Math.max(0, ctx.currentTime * ctx.sampleRate - report.at);
      return Math.max(0, (report.source + framesSince * currentTempo) / rate);
    },
    stop: () => {
      stopped = true;
      node.port.onmessage = null;
      node.port.postMessage({ type: "stop" });
      try {
        node.disconnect();
      } catch {
        // Already disconnected — harmless.
      }
    },
  };
}

/** The original voice: SoundTouchJS's PitchShifter on a main-thread ScriptProcessorNode. See the file comment for why it is only the fallback. */
function createScriptProcessorVoice(
  ctx: AudioContext,
  buffer: AudioBuffer,
  { tempo, pitchSemitones, onEnd }: TimeStretchOptions
): TimeStretchVoice {
  const shifter = new PitchShifter(ctx, buffer, FALLBACK_BUFFER_SIZE, onEnd);
  shifter.tempo = tempo;
  shifter.pitchSemitones = pitchSemitones;

  return {
    node: shifter.node,
    setTempo: (t) => {
      shifter.tempo = t;
    },
    setPitchSemitones: (s) => {
      shifter.pitchSemitones = s;
    },
    // No scheduled starts on this voice: it begins whenever its first callback runs. Its first audible sample sat a
    // little past the start it was given; lead it by that so the sound lands where was asked.
    setStartFraction: (fraction) => {
      shifter.percentagePlayed = fraction + SCRIPT_PROCESSOR_START_LEAD_SEC / buffer.duration;
    },
    getPositionSec: () => shifter.timePlayed - SCRIPT_PROCESSOR_LAG_SEC,
    stop: () => {
      shifter.off();
      shifter.disconnect();
    },
  };
}
