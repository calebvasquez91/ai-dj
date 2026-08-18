/**
 * Best-effort track analysis: tempo (BPM), a beat-grid phase reference,
 * an "energy onset" heuristic for where a track's groove actually starts
 * (as opposed to a cold/silent intro), and a best-effort musical key.
 *
 * This is deliberately simple signal processing, not a research-grade MIR
 * pipeline — good on steady, beat-driven electronic material, weaker on
 * complex or acoustic material, same as any lightweight tempo/key
 * estimator. Confidence scores are exposed so callers can fall back
 * gracefully instead of trusting a bad estimate.
 *
 * The DSP core below (`analyzeSamples` and everything it calls) is pure —
 * it only touches a Float32Array of samples plus a sample rate, so it's
 * unit-testable without a browser AudioContext. `analyzeTrackFromUrl` is
 * the thin browser-only shell that decodes a track and hands its samples
 * to that core.
 */

export interface TrackAnalysis {
  bpm: number;
  bpmConfidence: number; // 0-1
  beatGridOffsetSec: number; // time of a reference beat the grid is anchored to
  energyOnsetSec: number; // best-effort "past the cold intro" entry point
  key: string | null; // e.g. "C major" / "A minor", null if low confidence
  keyConfidence: number; // 0-1
  camelotKey: string | null; // Camelot wheel notation (e.g. "8A") for harmonic-mixing compatibility, derived from `key`
  breakdownAtSec: number | null; // best-effort low-energy breakdown section, for Breakdown Mixing
  dropAtSec: number | null; // best-effort high-energy "drop" moment, for Double Drop alignment
  waveformPeaks: number[]; // compact 0-1 normalized peak array for waveform display
  fallback: boolean; // true if this used the neutral-BPM fallback path
}

const MIN_BPM = 60;
const MAX_BPM = 200;
const ENVELOPE_HOP_SEC = 0.01; // 100Hz envelope rate

const FALLBACK_BPM = 120;

export function fallbackAnalysis(): TrackAnalysis {
  return {
    bpm: FALLBACK_BPM,
    bpmConfidence: 0,
    beatGridOffsetSec: 0,
    energyOnsetSec: 0,
    key: null,
    keyConfidence: 0,
    camelotKey: null,
    breakdownAtSec: null,
    dropAtSec: null,
    waveformPeaks: [],
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// Envelope + onset detection
// ---------------------------------------------------------------------------

function computeEnergyEnvelope(
  samples: Float32Array,
  sampleRate: number,
  hopSec = ENVELOPE_HOP_SEC
): Float32Array {
  const hopSize = Math.max(1, Math.round(sampleRate * hopSec));
  const windowSize = hopSize * 2;
  const numWindows = Math.max(1, Math.floor(samples.length / hopSize));
  const envelope = new Float32Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    const start = w * hopSize;
    const end = Math.min(samples.length, start + windowSize);
    let sumSquares = 0;
    for (let i = start; i < end; i++) sumSquares += samples[i] * samples[i];
    envelope[w] = Math.sqrt(sumSquares / Math.max(1, end - start));
  }
  return envelope;
}

/** Half-wave rectified first difference — emphasizes onsets (energy increases) over steady energy. */
function computeOnsetEnvelope(envelope: Float32Array): Float32Array {
  const onset = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) {
    onset[i] = Math.max(0, envelope[i] - envelope[i - 1]);
  }
  return onset;
}

// ---------------------------------------------------------------------------
// Tempo estimation via autocorrelation of the onset envelope
// ---------------------------------------------------------------------------

/** True if `lag` is (within tolerance) an integer multiple or divisor of `referenceLag` — i.e. an octave/harmonic of the same underlying tempo, not a genuinely competing hypothesis. */
function isHarmonicallyRelated(lag: number, referenceLag: number, tolerance = 0.03): boolean {
  for (const k of [1, 2, 3, 4]) {
    if (Math.abs(lag / (referenceLag * k) - 1) <= tolerance) return true;
    if (Math.abs(referenceLag / (lag * k) - 1) <= tolerance) return true;
  }
  return false;
}

function estimateTempo(
  onsetEnvelope: Float32Array,
  envelopeRateHz: number
): { bpm: number; confidence: number } {
  const minLag = Math.floor((60 / MAX_BPM) * envelopeRateHz);
  const maxLag = Math.ceil((60 / MIN_BPM) * envelopeRateHz);
  if (onsetEnvelope.length < maxLag * 2) {
    return { bpm: FALLBACK_BPM, confidence: 0 };
  }

  const scoresByLag = new Map<number, number>();
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = lag; i < onsetEnvelope.length; i++) {
      sum += onsetEnvelope[i] * onsetEnvelope[i - lag];
      count++;
    }
    scoresByLag.set(lag, count > 0 ? sum / count : 0);
  }

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (const [lag, score] of scoresByLag) {
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // The strongest *genuinely different* competing tempo — octave/harmonic
  // lags of the winner naturally score almost as high for any clean
  // periodic signal, so they're excluded rather than treated as doubt.
  let secondBestScore = 0;
  for (const [lag, score] of scoresByLag) {
    if (lag === bestLag) continue;
    if (isHarmonicallyRelated(lag, bestLag)) continue;
    if (score > secondBestScore) secondBestScore = score;
  }

  const bpm = (60 * envelopeRateHz) / bestLag;
  const confidence =
    bestScore > 0 ? Math.max(0, Math.min(1, 1 - secondBestScore / bestScore)) : 0;
  return { bpm, confidence };
}

function findBeatGridOffset(
  onsetEnvelope: Float32Array,
  envelopeRateHz: number,
  thresholdRatio = 0.5
): number {
  let maxVal = 0;
  for (const v of onsetEnvelope) maxVal = Math.max(maxVal, v);
  if (maxVal <= 0) return 0;
  const threshold = maxVal * thresholdRatio;
  for (let i = 0; i < onsetEnvelope.length; i++) {
    if (onsetEnvelope[i] >= threshold) return i / envelopeRateHz;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Energy-onset / breakdown / drop heuristics — all best-effort sustained-
// threshold crossings over a smoothed energy envelope, not true structural
// (arrangement-aware) analysis. Good enough to pick a sensible "past the
// cold intro" entry point, a plausible low-energy breakdown to mix into,
// and a plausible high-energy "drop" moment to align two tracks around.
// ---------------------------------------------------------------------------

function smoothEnvelope(envelope: Float32Array, windowSize: number): Float32Array {
  const smoothed = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    let sum = 0;
    for (let j = start; j <= i; j++) sum += envelope[j];
    smoothed[i] = sum / (i - start + 1);
  }
  return smoothed;
}

function findEnergyOnset(envelope: Float32Array, envelopeRateHz: number): number {
  if (envelope.length === 0) return 0;

  const smoothWindow = Math.max(1, Math.round(envelopeRateHz * 1)); // ~1s smoothing
  const smoothed = smoothEnvelope(envelope, smoothWindow);

  const sorted = Float32Array.from(smoothed).sort();
  const loudLevel = sorted[Math.floor(sorted.length * 0.75)] || 0;
  if (loudLevel <= 0) return 0;

  const sustainWindow = Math.max(1, Math.round(envelopeRateHz * 2)); // check next ~2s holds up
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] < loudLevel * 0.6) continue;
    const end = Math.min(smoothed.length, i + sustainWindow);
    let sustainSum = 0;
    for (let j = i; j < end; j++) sustainSum += smoothed[j];
    const sustainAvg = sustainSum / Math.max(1, end - i);
    if (sustainAvg >= loudLevel * 0.4) {
      return i / envelopeRateHz;
    }
  }
  return 0;
}

/** Best-effort "drop" heuristic for Double Drop-style alignment: the loudest sustained plateau in the track. Not true drop/structural detection — a proxy. */
function findEnergyPeak(envelope: Float32Array, envelopeRateHz: number): number | null {
  if (envelope.length === 0) return null;
  const smoothWindow = Math.max(1, Math.round(envelopeRateHz * 1));
  const smoothed = smoothEnvelope(envelope, smoothWindow);
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] > bestVal) {
      bestVal = smoothed[i];
      bestIdx = i;
    }
  }
  if (bestVal <= 0) return null;
  return bestIdx / envelopeRateHz;
}

/** Best-effort "breakdown" heuristic for Breakdown Mixing: the first sustained low-energy dip after the track's energy onset. Not true structural detection — a proxy. */
function findBreakdown(envelope: Float32Array, envelopeRateHz: number, afterSec: number): number | null {
  if (envelope.length === 0) return null;
  const smoothWindow = Math.max(1, Math.round(envelopeRateHz * 1));
  const smoothed = smoothEnvelope(envelope, smoothWindow);
  const sorted = Float32Array.from(smoothed).sort();
  const loudLevel = sorted[Math.floor(sorted.length * 0.75)] || 0;
  if (loudLevel <= 0) return null;

  const startIdx = Math.max(0, Math.round(afterSec * envelopeRateHz));
  const sustainWindow = Math.max(1, Math.round(envelopeRateHz * 2));
  for (let i = startIdx; i < smoothed.length; i++) {
    if (smoothed[i] > loudLevel * 0.35) continue; // looking for a genuine dip, not just a quiet instant
    const end = Math.min(smoothed.length, i + sustainWindow);
    let sustainSum = 0;
    for (let j = i; j < end; j++) sustainSum += smoothed[j];
    const sustainAvg = sustainSum / Math.max(1, end - i);
    if (sustainAvg <= loudLevel * 0.35) {
      return i / envelopeRateHz;
    }
  }
  return null;
}

/** Downsamples the energy envelope into a small, 0-1 normalized peak array for waveform rendering — cheap to compute since it reuses the envelope already built for tempo/onset analysis, no extra decoding needed. */
function downsampleForWaveform(envelope: Float32Array, points = 240): number[] {
  const peaks = new Array<number>(points).fill(0);
  if (envelope.length === 0) return peaks;
  const chunk = envelope.length / points;
  let maxVal = 0;
  for (let p = 0; p < points; p++) {
    const start = Math.floor(p * chunk);
    const end = Math.max(start + 1, Math.floor((p + 1) * chunk));
    let peak = 0;
    for (let i = start; i < end && i < envelope.length; i++) {
      if (envelope[i] > peak) peak = envelope[i];
    }
    peaks[p] = peak;
    if (peak > maxVal) maxVal = peak;
  }
  if (maxVal > 0) {
    for (let p = 0; p < points; p++) peaks[p] /= maxVal;
  }
  return peaks;
}

// ---------------------------------------------------------------------------
// Best-effort key estimation: chroma vector (via a small radix-2 FFT) +
// Krumhansl-Kessler major/minor profile correlation.
// ---------------------------------------------------------------------------

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Standard published Krumhansl-Kessler key profiles (public research constants).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` length must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angleStep = (-2 * Math.PI) / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < halfLen; k++) {
        const angle = angleStep * k;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);
        const evenIdx = start + k;
        const oddIdx = start + k + halfLen;
        const oddRe = re[oddIdx] * wRe - im[oddIdx] * wIm;
        const oddIm = re[oddIdx] * wIm + im[oddIdx] * wRe;
        re[oddIdx] = re[evenIdx] - oddRe;
        im[oddIdx] = im[evenIdx] - oddIm;
        re[evenIdx] += oddRe;
        im[evenIdx] += oddIm;
      }
    }
  }
}

function frameChroma(frame: Float32Array, sampleRate: number): number[] {
  const size = nextPowerOfTwo(frame.length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < frame.length; i++) {
    // Hann window to reduce spectral leakage.
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame.length - 1 || 1));
    re[i] = frame[i] * w;
  }
  fft(re, im);

  const chroma = new Array(12).fill(0);
  const minFreq = 65; // ~C2
  const maxFreq = 1050; // ~C6
  for (let bin = 1; bin < size / 2; bin++) {
    const freq = (bin * sampleRate) / size;
    if (freq < minFreq || freq > maxFreq) continue;
    const magnitude = Math.hypot(re[bin], im[bin]);
    const midiPitch = 69 + 12 * Math.log2(freq / 440);
    const pitchClass = ((Math.round(midiPitch) % 12) + 12) % 12;
    chroma[pitchClass] += magnitude * magnitude;
  }
  return chroma;
}

function correlate(a: number[], b: number[]): number {
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom > 0 ? num / denom : 0;
}

function rotate(profile: number[], n: number): number[] {
  return profile.map((_, i) => profile[(i - n + 12 * 100) % 12]);
}

function estimateKey(
  samples: Float32Array,
  sampleRate: number,
  durationSec: number
): { key: string | null; confidence: number } {
  if (durationSec < 4) return { key: null, confidence: 0 };

  const frameSec = Math.min(2, durationSec / 4);
  const frameSize = Math.round(frameSec * sampleRate);
  const offsets = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85];
  const chromaSum = new Array(12).fill(0);
  let framesUsed = 0;

  for (const offsetRatio of offsets) {
    const start = Math.floor(offsetRatio * samples.length);
    const end = Math.min(samples.length, start + frameSize);
    if (end - start < frameSize / 2) continue;
    const frame = samples.subarray(start, end);
    const chroma = frameChroma(frame, sampleRate);
    for (let i = 0; i < 12; i++) chromaSum[i] += chroma[i];
    framesUsed++;
  }

  if (framesUsed === 0) return { key: null, confidence: 0 };
  const chroma = chromaSum.map((v) => v / framesUsed);

  let bestScore = -Infinity;
  let secondScore = -Infinity;
  let bestLabel: string | null = null;

  for (let tonic = 0; tonic < 12; tonic++) {
    const majorScore = correlate(chroma, rotate(MAJOR_PROFILE, tonic));
    const minorScore = correlate(chroma, rotate(MINOR_PROFILE, tonic));
    for (const [score, label] of [
      [majorScore, `${PITCH_CLASSES[tonic]} major`],
      [minorScore, `${PITCH_CLASSES[tonic]} minor`],
    ] as const) {
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestLabel = label;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
  }

  const confidence = Math.max(0, Math.min(1, bestScore - secondScore));
  return { key: bestLabel, confidence };
}

// ---------------------------------------------------------------------------
// Camelot wheel — maps an estimated key to Camelot notation (e.g. "8A") for
// harmonic-mixing compatibility scoring. Camelot numbers follow the circle
// of fifths (each +7 semitones/perfect-fifth step advances the number by
// one); a minor key shares its relative major's number with the "A" letter
// in place of "B" (relative major = minor tonic + 3 semitones).
// ---------------------------------------------------------------------------

const MAJOR_CAMELOT_NUMBER_BY_SEMITONE = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];

export function camelotForKey(key: string | null): string | null {
  if (!key) return null;
  const match = key.match(/^([A-G]#?)\s+(major|minor)$/);
  if (!match) return null;
  const semitone = PITCH_CLASSES.indexOf(match[1]);
  if (semitone < 0) return null;
  const isMinor = match[2] === "minor";
  const idx = isMinor ? (semitone + 3) % 12 : semitone;
  const number = MAJOR_CAMELOT_NUMBER_BY_SEMITONE[idx];
  return `${number}${isMinor ? "A" : "B"}`;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

const MIN_TEMPO_CONFIDENCE = 0.15;

export function analyzeSamples(
  samples: Float32Array,
  sampleRate: number,
  durationSec: number
): TrackAnalysis {
  const envelope = computeEnergyEnvelope(samples, sampleRate);
  const envelopeRateHz = 1 / ENVELOPE_HOP_SEC;
  const onsetEnvelope = computeOnsetEnvelope(envelope);

  const { bpm: rawBpm, confidence: bpmConfidence } = estimateTempo(onsetEnvelope, envelopeRateHz);
  const usableBpm = bpmConfidence >= MIN_TEMPO_CONFIDENCE ? rawBpm : FALLBACK_BPM;

  const beatGridOffsetSec = findBeatGridOffset(onsetEnvelope, envelopeRateHz);
  const energyOnsetSec = findEnergyOnset(envelope, envelopeRateHz);
  const breakdownAtSec = findBreakdown(envelope, envelopeRateHz, energyOnsetSec);
  const dropAtSec = findEnergyPeak(envelope, envelopeRateHz);
  const waveformPeaks = downsampleForWaveform(envelope);
  const { key, confidence: keyConfidence } = estimateKey(samples, sampleRate, durationSec);

  return {
    bpm: usableBpm,
    bpmConfidence,
    beatGridOffsetSec,
    energyOnsetSec,
    key,
    keyConfidence,
    camelotKey: camelotForKey(key),
    breakdownAtSec,
    dropAtSec,
    waveformPeaks,
    fallback: bpmConfidence < MIN_TEMPO_CONFIDENCE,
  };
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

/** Browser-only: decodes a track URL and runs the pure analysis core on its samples. */
export async function analyzeTrackFromUrl(url: string): Promise<TrackAnalysis> {
  const AudioContextCtor =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioContextCtor();
  try {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const samples = mixToMono(audioBuffer);
    return analyzeSamples(samples, audioBuffer.sampleRate, audioBuffer.duration);
  } finally {
    ctx.close();
  }
}
