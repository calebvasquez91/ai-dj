/**
 * Runs the CPU-heavy part of track analysis (onset-envelope autocorrelation
 * for tempo, FFT/chroma for key) off the main thread so a long track never
 * stutters playback while it's being analyzed. Deliberately uses the pure
 * JS analyzeSamples() reference implementation, not the WASM fast path —
 * the WASM loader in audio-analysis.ts injects a <script> tag via
 * `document`, which doesn't exist in a worker's global scope, and
 * reworking that loader to be worker-compatible is out of scope here. The
 * goal of this worker is "never blocks the main thread", not raw speed;
 * the JS path fully satisfies that even without the WASM boost.
 *
 * Imports from audio-analysis-core.ts specifically, NOT audio-analysis.ts —
 * that file is what spawns this worker (`new Worker(new URL("../workers/
 * analysis.worker.ts", ...))`), so importing back from it here would create
 * a cycle between the worker entrypoint and its own spawner, which hung
 * Turbopack's production build indefinitely (dev mode worked fine, since
 * its on-demand compilation never needed to fully resolve the cycle).
 */

import { analyzeSamples } from "@/lib/audio-analysis-core";

interface AnalysisWorkerRequest {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
}

onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const { samples, sampleRate, durationSec } = event.data;
  const result = analyzeSamples(samples, sampleRate, durationSec);
  postMessage(result);
};
