/**
 * Browser-only shell around the pure DSP core in audio-analysis-core.ts:
 * decodes a track URL, then runs analysis on its samples (in a Web Worker
 * when available, WASM when available, plain JS otherwise). Re-exports the
 * core's types/functions so existing imports of this file keep working
 * unchanged.
 */

export {
  type TrackAnalysis,
  fallbackAnalysis,
  analyzeSamples,
  camelotForKey,
} from "@/lib/audio-analysis-core";
import { analyzeSamples, type TrackAnalysis } from "@/lib/audio-analysis-core";

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

// ---------------------------------------------------------------------------
// Optional WebAssembly fast path (native/analysis.cpp, built by
// scripts/build-wasm.sh into public/wasm/analysis.{js,wasm}). It's a
// from-scratch C++ port of the DSP core, kept in sync by inspection — the
// TypeScript core stays the tested reference implementation and is always
// the fallback if the WASM module fails to load or throws.
// ---------------------------------------------------------------------------

interface WasmTrackAnalysisResult {
  bpm: number;
  bpmConfidence: number;
  beatGridOffsetSec: number;
  energyOnsetSec: number;
  key: string;
  keyConfidence: number;
  camelotKey: string;
  breakdownAtSec: number; // NaN means null
  dropAtSec: number; // NaN means null
  waveformPeaks: number[];
  fallback: boolean;
}

interface AnalysisWasmModule {
  analyzeSamples(samples: Float32Array, sampleRate: number, durationSec: number): WasmTrackAnalysisResult;
}

declare global {
  interface Window {
    createAnalysisModule?: () => Promise<AnalysisWasmModule>;
  }
}

let wasmModulePromise: Promise<AnalysisWasmModule | null> | null = null;

function loadWasmModule(): Promise<AnalysisWasmModule | null> {
  if (wasmModulePromise) return wasmModulePromise;
  wasmModulePromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "/wasm/analysis.js";
    script.onload = () => {
      const factory = window.createAnalysisModule;
      if (!factory) {
        resolve(null);
        return;
      }
      factory().then(resolve).catch(() => resolve(null));
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return wasmModulePromise;
}

function wasmResultToTrackAnalysis(raw: WasmTrackAnalysisResult): TrackAnalysis {
  return {
    bpm: raw.bpm,
    bpmConfidence: raw.bpmConfidence,
    beatGridOffsetSec: raw.beatGridOffsetSec,
    energyOnsetSec: raw.energyOnsetSec,
    key: raw.key.length > 0 ? raw.key : null,
    keyConfidence: raw.keyConfidence,
    camelotKey: raw.camelotKey.length > 0 ? raw.camelotKey : null,
    breakdownAtSec: Number.isNaN(raw.breakdownAtSec) ? null : raw.breakdownAtSec,
    dropAtSec: Number.isNaN(raw.dropAtSec) ? null : raw.dropAtSec,
    waveformPeaks: raw.waveformPeaks,
    fallback: raw.fallback,
  };
}

async function tryAnalyzeSamplesWasm(
  samples: Float32Array,
  sampleRate: number,
  durationSec: number
): Promise<TrackAnalysis | null> {
  try {
    const wasmModule = await loadWasmModule();
    if (!wasmModule) return null;
    const raw = wasmModule.analyzeSamples(samples, sampleRate, durationSec);
    return wasmResultToTrackAnalysis(raw);
  } catch (err) {
    console.warn("WASM analysis failed, falling back to JS:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Web Worker fast path — moves the actual number-crunching (autocorrelation,
// FFT/chroma) off the main thread so a long track never stutters playback
// while it's being analyzed. Uses the pure-JS analyzeSamples() core, not
// the WASM module: the WASM loader above injects a <script> tag via
// `document`, which doesn't exist inside a worker, and reworking that
// loader to be worker-compatible is out of scope — the goal here is "never
// blocks the main thread", which the JS path fully satisfies on its own.
// Falls back to the existing in-thread paths (WASM, then plain JS) if
// workers aren't available, or the worker fails/times out.
// ---------------------------------------------------------------------------

let analysisWorker: Worker | null | undefined; // undefined = not yet attempted this session

function getAnalysisWorker(): Worker | null {
  if (analysisWorker !== undefined) return analysisWorker;
  try {
    analysisWorker = new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), { type: "module" });
  } catch {
    analysisWorker = null;
  }
  return analysisWorker;
}

const WORKER_ANALYSIS_TIMEOUT_MS = 20000;

function analyzeSamplesInWorker(
  samples: Float32Array,
  sampleRate: number,
  durationSec: number
): Promise<TrackAnalysis | null> {
  const worker = getAnalysisWorker();
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, WORKER_ANALYSIS_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timeoutId);
      worker!.removeEventListener("message", handleMessage);
      worker!.removeEventListener("error", handleError);
    }
    function handleMessage(event: MessageEvent<TrackAnalysis>) {
      cleanup();
      resolve(event.data);
    }
    function handleError() {
      cleanup();
      resolve(null);
    }
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    // Posting a copy (not `samples` itself) as a transferable keeps the
    // caller's own array intact for the in-thread fallback path below,
    // should the worker fail or time out.
    const samplesCopy = samples.slice();
    worker.postMessage({ samples: samplesCopy, sampleRate, durationSec }, [samplesCopy.buffer]);
  });
}

/** Browser-only: decodes a track URL and runs the analysis core on its samples (in a Web Worker when available, WASM when available, JS otherwise). */
export async function analyzeTrackFromUrl(url: string): Promise<TrackAnalysis> {
  const AudioContextCtor =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioContextCtor();
  try {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const samples = mixToMono(audioBuffer);
    const workerResult = await analyzeSamplesInWorker(samples, audioBuffer.sampleRate, audioBuffer.duration);
    if (workerResult) return workerResult;
    const wasmResult = await tryAnalyzeSamplesWasm(samples, audioBuffer.sampleRate, audioBuffer.duration);
    return wasmResult ?? analyzeSamples(samples, audioBuffer.sampleRate, audioBuffer.duration);
  } finally {
    ctx.close();
  }
}
