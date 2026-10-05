/**
 * Song map: a machine-readable description of a track's rhythmic and
 * structural skeleton — every beat position, which beats are downbeats
 * (bar starts), where 8/16/32-bar phrases begin, and coarse sections.
 * It replaces "a tempo plus one offset" (TrackAnalysis.beatGridOffsetSec)
 * as what transitions can be aligned to, so a mix can land on a phrase
 * boundary instead of merely on a beat.
 *
 * Pure DSP over a mono Float32Array — no DOM, no Worker, no WASM — so it
 * runs in the existing analysis worker and in Node tests alike.
 *
 * Pipeline (each stage is exported so it can be tested on its own):
 *   1. features      decimate, STFT, log-magnitude band flux -> onset strength
 *   2. tempo         autocorrelation of onset strength + harmonic summation
 *   3. beats         dynamic-programming beat tracker (Ellis 2007) + sub-frame refinement
 *   4. downbeats     which of 4 beat phases is "beat 1": low-band accent + bass change
 *   5. phrases       which bar phase starts an 8/16/32-bar phrase: bar-level novelty
 *   6. sections      novelty peaks -> sections, labelled by relative energy
 *
 * Honest limits (see song-map.test.ts for what is and isn't measured):
 *  - Assumes 4/4. Waltz or 6/8 material will get a confident-looking but wrong bar grid.
 *  - Assumes roughly steady tempo (it follows slow drift, not tempo changes).
 *  - Downbeat and phrase phases are inferred from accents/novelty, not heard
 *    "beat 1"; each carries a confidence so callers can ignore weak ones.
 *  - Section labels are energy heuristics (intro/build/drop/breakdown/body/outro),
 *    not a learned model — it cannot tell a verse from a chorus.
 */

export const SONG_MAP_VERSION = 1;

export type SongSectionLabel = "intro" | "build" | "drop" | "breakdown" | "body" | "outro";

export interface SongSection {
  startSec: number;
  endSec: number;
  label: SongSectionLabel;
  /** Mean loudness of the section relative to the track's loud passages, 0-1. */
  energy: number;
  /** 0-1: how clearly a structural change marks the section's start. */
  confidence: number;
}

export interface SongMap {
  version: number;
  durationSec: number;
  /** Mean tempo implied by the tracked beats. */
  bpm: number;
  /**
   * 0-1: how evenly spaced the tracked beats are (see beatRegularity). Calibrated on 102 real Splice loops with known
   * BPM: >= 0.3 kept 71% of files, with the tempo right up to an octave on 94% of them (exactly right on 74%);
   * below that the tempo was often wrong. Octave ambiguity (85 vs 170) is the main residual error.
   */
  tempoConfidence: number;
  beatsPerBar: 4;
  /** Every tracked beat, seconds. */
  beats: number[];
  /** Index into `beats` of the first downbeat (0-3 unless the bar line slips right at the start). */
  downbeatPhase: number;
  /** 0-1: how clearly one beat phase won as "beat 1". Treat < ~0.3 as a guess. */
  downbeatConfidence: number;
  /** Bar starts, seconds (every 4th beat from `downbeatPhase`). */
  downbeats: number[];
  phrases: {
    /** Phrase starts, seconds, for 8-, 16- and 32-bar phrases; each list is a subset of the one before it. */
    bars8: number[];
    bars16: number[];
    bars32: number[];
    /** 0-1: how clearly the 8-bar phrase phase stood out. */
    confidence: number;
  };
  sections: SongSection[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const DECIMATE = 4; // 44.1 kHz -> ~11 kHz; everything we use (kick..hats) lives below 5 kHz
const FFT_SIZE = 512;
const FRAME_HOP_SEC = 0.01;
const MIN_BPM = 60;
const MAX_BPM = 200;
const TEMPO_PRIOR_CENTER_BPM = 120;
const TEMPO_PRIOR_SIGMA_OCTAVES = 0.5;
const BEAT_TIGHTNESS = 100; // Ellis' alpha: how strongly beats are pulled to the steady tempo
/** Added to every frame time: the flux peak lands slightly before the frame centre, so beats came out ~17 ms early on synthetic ground truth (calibrated in song-map.test.ts; re-check on real recordings before trusting it below ~10 ms). */
const ONSET_TIMING_OFFSET_SEC = 0.005;
const MIN_DURATION_SEC = 10;
/** Below this there are no transients to track (a steady tone measured 0.01; the quietest of 102 real loops 0.84), and the beat tracker would otherwise return a perfectly regular, perfectly fictional grid. */
const MIN_ONSET_ACTIVITY = 0.3;
/** Don't promote past this tempo (DJs hear 85 and 170 as the same tune; above ~190 the "beat" is usually a subdivision). */
const OCTAVE_MAX_BPM = 190;

const BAND_EDGES_HZ = {
  low: [40, 150],
  lowMid: [150, 500],
  mid: [500, 2000],
  high: [2000, 5000],
} as const;
const BAND_WEIGHT = { low: 1.0, lowMid: 0.8, mid: 1.0, high: 0.6 } as const;

// ---------------------------------------------------------------------------
// 1. Features
// ---------------------------------------------------------------------------

/** Averages groups of `factor` samples (a crude box low-pass + decimate — fine for onset detection, not for listening). */
export function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return samples;
  const n = Math.floor(samples.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) sum += samples[base + k];
    out[i] = sum / factor;
  }
  return out;
}

/** In-place radix-2 FFT. `re`/`im` lengths must be equal powers of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlr = Math.cos(ang);
    const wli = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nwr = wr * wlr - wi * wli;
        wi = wr * wli + wi * wlr;
        wr = nwr;
      }
    }
  }
}

export interface SpectralFeatures {
  frameRateHz: number;
  numFrames: number;
  /** Seconds from the start of the audio to the center of frame 0 (frame t is centred at frameOffsetSec + t / frameRateHz). */
  frameOffsetSec: number;
  /** Combined, normalised onset strength (zero-mean, unit-variance, half-wave rectified around a local mean). */
  oss: Float32Array;
  /** Per-band positive spectral flux (raw, un-normalised). */
  flux: { low: Float32Array; lowMid: Float32Array; mid: Float32Array; high: Float32Array };
  /** Mean log-magnitude per band per frame — a loudness-ish measure for bar features. */
  level: { low: Float32Array; lowMid: Float32Array; mid: Float32Array; high: Float32Array };
  /** Per-frame log-magnitude of the low-frequency bins (≈ 40-520 Hz), for bass-movement features. */
  bass: Float32Array[];
  /** Linear RMS of the decimated audio per frame. */
  rms: Float32Array;
  /** Total positive spectral flux over total log-spectrum level: ~0 for audio with no transients (a steady tone, silence), 0.8+ for the quietest real loops, 10+ for noise. */
  onsetActivity: number;
}

export function computeSpectralFeatures(samples: Float32Array, sampleRate: number): SpectralFeatures {
  const x = decimate(samples, DECIMATE);
  const sr = sampleRate / DECIMATE;
  const hop = Math.max(1, Math.round(sr * FRAME_HOP_SEC));
  const frameRateHz = sr / hop;
  const numFrames = Math.max(0, Math.floor((x.length - FFT_SIZE) / hop) + 1);

  const binHz = sr / FFT_SIZE;
  const bandBins = (lo: number, hi: number): [number, number] => [
    Math.max(1, Math.round(lo / binHz)),
    Math.min(FFT_SIZE / 2 - 1, Math.round(hi / binHz)),
  ];
  const bins = {
    low: bandBins(...BAND_EDGES_HZ.low),
    lowMid: bandBins(...BAND_EDGES_HZ.lowMid),
    mid: bandBins(...BAND_EDGES_HZ.mid),
    high: bandBins(...BAND_EDGES_HZ.high),
  };
  const bassLo = bins.low[0];
  const bassHi = bins.lowMid[1];

  const window = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const prev = new Float32Array(FFT_SIZE / 2);
  const cur = new Float32Array(FFT_SIZE / 2);

  const flux = {
    low: new Float32Array(numFrames),
    lowMid: new Float32Array(numFrames),
    mid: new Float32Array(numFrames),
    high: new Float32Array(numFrames),
  };
  const level = {
    low: new Float32Array(numFrames),
    lowMid: new Float32Array(numFrames),
    mid: new Float32Array(numFrames),
    high: new Float32Array(numFrames),
  };
  const rms = new Float32Array(numFrames);
  const bass: Float32Array[] = new Array(numFrames);
  const names = ["low", "lowMid", "mid", "high"] as const;

  for (let t = 0; t < numFrames; t++) {
    const start = t * hop;
    let sq = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const v = x[start + i];
      sq += v * v;
      re[i] = v * window[i];
      im[i] = 0;
    }
    rms[t] = Math.sqrt(sq / FFT_SIZE);
    fft(re, im);
    for (let k = 0; k < FFT_SIZE / 2; k++) {
      // log-compressed magnitude: 100x gain keeps quiet detail audible to the flux without letting loud peaks dominate
      cur[k] = Math.log1p((100 * Math.hypot(re[k], im[k])) / (FFT_SIZE / 2));
    }
    for (const name of names) {
      const [lo, hi] = bins[name];
      let f = 0;
      let l = 0;
      for (let k = lo; k <= hi; k++) {
        const d = cur[k] - prev[k];
        if (d > 0 && t > 0) f += d;
        l += cur[k];
      }
      flux[name][t] = f;
      level[name][t] = l / (hi - lo + 1);
    }
    bass[t] = cur.slice(bassLo, bassHi + 1);
    prev.set(cur);
  }

  // Combine the bands: normalise each by its own mean so a loud hi-hat band can't swamp the kick.
  const combined = new Float32Array(numFrames);
  for (const name of names) {
    let mean = 0;
    for (let t = 0; t < numFrames; t++) mean += flux[name][t];
    mean = mean / Math.max(1, numFrames) + 1e-9;
    const w = BAND_WEIGHT[name] / mean;
    for (let t = 0; t < numFrames; t++) combined[t] += flux[name][t] * w;
  }
  const oss = normaliseOnsetStrength(combined, frameRateHz);

  // Frame t covers decimated samples [t*hop, t*hop + FFT_SIZE): centred half a window in.
  const frameOffsetSec = FFT_SIZE / 2 / sr;
  let fluxTotal = 0;
  let levelTotal = 0;
  for (let t = 1; t < numFrames; t++) {
    fluxTotal += flux.low[t] + flux.lowMid[t] + flux.mid[t] + flux.high[t];
    levelTotal += level.low[t] + level.lowMid[t] + level.mid[t] + level.high[t];
  }
  const onsetActivity = fluxTotal / (levelTotal + 1e-12);
  return { frameRateHz, numFrames, frameOffsetSec, oss, flux, level, bass, rms, onsetActivity };
}

/** Subtracts a ~1 s moving mean (removes slow loudness changes), half-wave rectifies, and scales to unit variance. */
function normaliseOnsetStrength(raw: Float32Array, rateHz: number): Float32Array {
  const n = raw.length;
  const out = new Float32Array(n);
  const half = Math.max(1, Math.round(rateHz * 0.5));
  // prefix sums for the moving mean
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + raw[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
    out[i] = Math.max(0, raw[i] - mean);
  }
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += out[i] * out[i];
  const std = Math.sqrt(sumSq / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= std;
  return out;
}

// ---------------------------------------------------------------------------
// 2. Tempo
// ---------------------------------------------------------------------------

export interface TempoEstimate {
  bpm: number;
  confidence: number;
}

/** Tempo from the autocorrelation of onset strength, with harmonic summation (a true beat period also has energy at 2x and 4x its lag) and a weak log-Gaussian prior around 120 BPM against octave errors. */
export function estimateTempoFromOnsets(oss: Float32Array, frameRateHz: number): TempoEstimate | null {
  const minLag = Math.max(2, Math.floor((60 / MAX_BPM) * frameRateHz));
  const maxLag = Math.ceil((60 / MIN_BPM) * frameRateHz);
  const n = oss.length;
  if (n < maxLag * 3) return null;

  const acfLen = Math.min(n - 1, maxLag * 4 + 2);
  const acf = new Float64Array(acfLen + 1);
  for (let lag = 0; lag <= acfLen; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += oss[i] * oss[i - lag];
    acf[lag] = sum / (n - lag); // unbiased: long lags aren't penalised for having fewer terms
  }
  if (acf[0] <= 0) return null;

  // Harmonic-summed periodicity per lag, with NO tempo prior: this decides the tempo *family* (beat, dotted beat,
  // ...) purely from the audio.
  const scores = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = acf[lag];
    if (lag * 2 <= acfLen) s += 0.5 * acf[lag * 2];
    if (lag * 4 <= acfLen) s += 0.25 * acf[lag * 4];
    scores[lag] = s;
  }
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (scores[lag] > scores[best]) best = lag;
  if (scores[best] <= 0) return null;

  // The prior then only chooses the OCTAVE of that winner (half / same / double), by raw autocorrelation evidence
  // weighted by how plausible each tempo is (log-normal around 120 BPM). A pulse every 2 beats (kick on 1 and 3)
  // or a fast track both show up as the half-tempo lag; the prior is what tips them to the faster beat. Letting
  // the prior pull the estimate to a *different* tempo family instead turned a clean 170 BPM track into 113.
  const lagToBpm = (lag: number) => (60 * frameRateHz) / lag;
  const prior = (lag: number) =>
    Math.exp(-0.5 * (Math.log2(lagToBpm(lag) / TEMPO_PRIOR_CENTER_BPM) / TEMPO_PRIOR_SIGMA_OCTAVES) ** 2);
  const nearestPeak = (target: number): number => {
    let pick = -1;
    for (let k = Math.round(target) - 1; k <= Math.round(target) + 1; k++) {
      if (k < minLag || k > maxLag) continue;
      if (pick < 0 || acf[k] > acf[pick]) pick = k;
    }
    return pick;
  };
  const familyLag = best;
  let bestWeighted = acf[familyLag] * prior(familyLag);
  for (const target of [familyLag / 2, familyLag * 2]) {
    const l = nearestPeak(target);
    if (l < 0 || lagToBpm(l) > OCTAVE_MAX_BPM) continue;
    const w = acf[l] * prior(l);
    if (w > bestWeighted) {
      bestWeighted = w;
      best = l;
    }
  }

  // Confidence: how far the winner stands above the best genuinely different (non-harmonic) tempo, on
  // prior-weighted scores so implausible tempos don't count as doubt.
  const weighted = (lag: number) => scores[lag] * prior(lag);
  const reference = Math.max(weighted(best), weighted(familyLag));

  // Parabolic refinement of the lag (the grid is 10 ms: ~1.7% BPM resolution at 120 BPM without it).
  let lagRefined = best;
  if (best > minLag && best < maxLag) {
    const a = acf[best - 1];
    const b = acf[best];
    const c = acf[best + 1];
    const denom = a - 2 * b + c;
    if (denom < 0) lagRefined = best + (0.5 * (a - c)) / denom;
  }

  let second = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (isHarmonic(lag, best)) continue;
    if (weighted(lag) > second) second = weighted(lag);
  }
  const confidence = Math.max(0, Math.min(1, 1 - second / reference));
  return { bpm: (60 * frameRateHz) / lagRefined, confidence };
}

function isHarmonic(lag: number, ref: number, tol = 0.05): boolean {
  for (const k of [1, 2, 3, 4]) {
    if (Math.abs(lag / (ref * k) - 1) <= tol) return true;
    if (Math.abs(ref / (lag * k) - 1) <= tol) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 3. Beat tracking (dynamic programming)
// ---------------------------------------------------------------------------

/** Ellis (2007): choose the beat sequence maximising onset strength at beats minus a penalty for inter-beat intervals that stray from the tempo period. Returns beat positions in (fractional) frames. */
export function trackBeatFrames(oss: Float32Array, frameRateHz: number, bpm: number): number[] {
  const n = oss.length;
  const period = (60 * frameRateHz) / bpm;
  if (n === 0 || period < 2) return [];

  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const minBack = Math.max(1, Math.round(period / 2));
  const maxBack = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bestScore = -Infinity;
    let bestPrev = -1;
    const lo = Math.max(0, t - maxBack);
    const hi = t - minBack;
    for (let p = lo; p <= hi; p++) {
      const interval = t - p;
      const penalty = -BEAT_TIGHTNESS * Math.log(interval / period) ** 2;
      const s = cum[p] + penalty;
      if (s > bestScore) {
        bestScore = s;
        bestPrev = p;
      }
    }
    if (bestPrev >= 0) {
      cum[t] = oss[t] + bestScore;
      back[t] = bestPrev;
    } else {
      cum[t] = oss[t];
    }
  }

  // Start the backtrace at the best local maximum in the last couple of beats.
  const tailStart = Math.max(0, n - Math.round(period * 2));
  let last = tailStart;
  for (let t = tailStart; t < n; t++) if (cum[t] > cum[last]) last = t;

  const frames: number[] = [];
  for (let t = last; t >= 0; t = back[t]) {
    frames.push(t);
    if (back[t] < 0) break;
  }
  frames.reverse();
  return trimWeakBeats(frames, oss);
}

/** Drops leading/trailing beats that sit on near-silence (the DP has to place beats across the whole track, including the fade-in/out). */
function trimWeakBeats(frames: number[], oss: Float32Array): number[] {
  if (frames.length < 4) return frames;
  let sq = 0;
  for (const f of frames) sq += oss[f] * oss[f];
  const threshold = 0.25 * Math.sqrt(sq / frames.length);
  let a = 0;
  let b = frames.length - 1;
  while (a < b && oss[frames[a]] < threshold) a++;
  while (b > a && oss[frames[b]] < threshold) b--;
  return frames.slice(a, b + 1);
}

/**
 * Inserts evenly spaced beats into gaps the tracker left (an interval of ~2+ beat periods): a breakdown or quiet
 * passage has no onsets for the DP to latch onto, but the music's beat grid carries on through it. Without this the
 * beat count drifts out of sync with the real bar count and every later downbeat is off by one.
 */
export function fillBeatGaps(frames: number[], periodFrames: number): number[] {
  if (frames.length < 2) return frames;
  const out: number[] = [frames[0]];
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i] - frames[i - 1];
    const missing = Math.round(gap / periodFrames) - 1;
    if (gap > 1.5 * periodFrames && missing > 0) {
      for (let k = 1; k <= missing; k++) out.push(frames[i - 1] + (gap * k) / (missing + 1));
    }
    out.push(frames[i]);
  }
  return out;
}

/**
 * Carries the beat grid back to the start of the audio and forward to its end at the tracked period. The DP only
 * places beats where it heard onsets, so a track whose intro is soft (or whose first beats were trimmed as weak) has
 * no beats there — yet the grid exists, and phrase counting needs it from bar 1. Capped so a long silent or
 * beat-less stretch doesn't fill with made-up beats.
 */
export function extendBeatGrid(frames: number[], periodFrames: number, numFrames: number, maxExtension = 64): number[] {
  if (frames.length === 0 || periodFrames < 2) return frames;
  const before: number[] = [];
  for (let k = 1, f = frames[0] - periodFrames; f >= 0 && k <= maxExtension; k++, f = frames[0] - (k + 0) * periodFrames) before.push(f);
  const after: number[] = [];
  const last = frames[frames.length - 1];
  for (let k = 1, f = last + periodFrames; f <= numFrames - 1 && k <= maxExtension; k++, f = last + (k + 0) * periodFrames) after.push(f);
  return [...before.reverse(), ...frames, ...after];
}

/** Parabolic peak interpolation on the onset strength around a frame: sub-frame beat time (frames). */
function refineFrame(oss: Float32Array, frame: number): number {
  const lo = Math.max(0, frame - 2);
  const hi = Math.min(oss.length - 1, frame + 2);
  let peak = frame;
  for (let t = lo; t <= hi; t++) if (oss[t] > oss[peak]) peak = t;
  if (peak <= 0 || peak >= oss.length - 1) return peak;
  const a = oss[peak - 1];
  const b = oss[peak];
  const c = oss[peak + 1];
  const denom = a - 2 * b + c;
  return denom < 0 ? peak + (0.5 * (a - c)) / denom : peak;
}

/**
 * 1 - coefficient of variation of the gaps between consecutive tracked beats: 1 for perfectly even beats, lower the
 * more they wobble or a wrong tempo makes the tracker wander between pulses. On real loops this separated "tempo
 * right" from "wrong" better than the autocorrelation peak ratio (AUC 0.90 vs 0.80 for the right tempo family), and
 * better than a robust (MAD) version, because the stray beats it penalises are exactly what a wrong tempo produces.
 */
export function beatRegularity(frames: number[]): number {
  if (frames.length < 4) return 0;
  const gaps = frames.slice(1).map((f, i) => f - frames[i]);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (mean <= 0) return 0;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
  return Math.max(0, 1 - sd / mean);
}

/** Maps beat regularity (empirically ~0.93 for hopeless to ~0.995 for metronomic) onto 0-1. */
export function tempoConfidenceFromRegularity(regularity: number): number {
  return Math.max(0, Math.min(1, (regularity - 0.93) / 0.065));
}

export function frameToSec(frame: number, features: Pick<SpectralFeatures, "frameRateHz" | "frameOffsetSec">): number {
  return frame / features.frameRateHz + features.frameOffsetSec + ONSET_TIMING_OFFSET_SEC;
}

// ---------------------------------------------------------------------------
// 4. Downbeats
// ---------------------------------------------------------------------------

function zScores(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n) || 1;
  return values.map((v) => (v - mean) / std);
}

export interface BarPositions {
  /** Per beat: 0 for a downbeat (beat 1 of a bar), 1-3 for the beats after it. */
  positions: number[];
  /** 0-1: how clearly one global beat phase beat the others (ignores slips). Treat < ~0.3 as a guess. */
  confidence: number;
}

/** Cost, in z-score units, of declaring that the bar line "slipped" (a bar that is not 4 beats long). */
const BAR_SLIP_PENALTY = 20;
/** z-units of bias towards "beat 1" for the first beat when the audio starts on the grid. */
const START_ON_BEAT_PRIOR = 3;
/** The first grid beat must fall within this many seconds of the start of the audio to count as "starts on a beat". */
const START_ALIGN_SEC = 0.06;

/**
 * Per-beat evidence that this beat is "beat 1". Two cues:
 *  - accent: low-band (kick/bass) onset strength at the beat — beat 1 usually carries the heaviest hit;
 *  - change: how much the bass/low-mid spectrum moves across the beat — chords and bass lines change on bar lines.
 * Four-on-the-floor kicks flatten the accent cue, which is why the change cue is there too. Both are z-scored
 * over the track, so evidence > 0 means "more downbeat-like than the average beat".
 */
export function downbeatEvidence(beatFrames: number[], features: SpectralFeatures): number[] {
  const nb = beatFrames.length;
  const bassDim = features.bass[0]?.length ?? 0;
  const vecs: Float64Array[] = [];
  for (let i = 0; i < nb; i++) {
    // mean bass spectrum between beat i and beat i+1
    const a = Math.round(beatFrames[i]);
    const b = Math.max(a + 1, Math.round(beatFrames[Math.min(nb - 1, i + 1)]));
    const v = new Float64Array(bassDim);
    let count = 0;
    for (let t = a; t < b && t < features.numFrames; t++) {
      for (let k = 0; k < bassDim; k++) v[k] += features.bass[t][k];
      count++;
    }
    if (count > 0) for (let k = 0; k < bassDim; k++) v[k] /= count;
    vecs.push(v);
  }
  const accent: number[] = [];
  const change: number[] = [];
  for (let i = 0; i < nb; i++) {
    const f = Math.round(beatFrames[i]);
    let m = 0;
    for (let t = Math.max(0, f - 2); t <= Math.min(features.numFrames - 1, f + 2); t++) m = Math.max(m, features.flux.low[t]);
    accent.push(m);
    let d = 0;
    if (i > 0) for (let k = 0; k < bassDim; k++) d += Math.abs(vecs[i][k] - vecs[i - 1][k]);
    change.push(d);
  }
  const za = zScores(accent);
  const zc = zScores(change);
  return za.map((v, i) => v + 1.5 * zc[i]); // change is the more reliable bar-line cue on four-on-the-floor material
}

/**
 * Bar position of every beat, decoded with Viterbi over 4 states (beat 1-4 of the bar). Bar positions normally
 * advance 1 -> 2 -> 3 -> 4 -> 1; any other transition (a "slip") costs BAR_SLIP_PENALTY. That makes the bar grid
 * self-correcting: if the beat tracker drops or doubles a beat, the bar line re-anchors where the evidence moves
 * instead of leaving every later bar off by one — which a single global "every 4th beat" phase cannot do.
 */
export function estimateBarPositions(
  beatFrames: number[],
  features: SpectralFeatures,
  options: { startsOnBeat?: boolean } = {}
): BarPositions {
  const nb = beatFrames.length;
  if (nb < 8) return { positions: beatFrames.map((_, i) => i % 4), confidence: 0 };

  const evidence = downbeatEvidence(beatFrames, features);
  // emission: a beat labelled "downbeat" earns its evidence; labelled anything else it earns a third of the opposite
  const emit = (i: number, state: number) => (state === 0 ? evidence[i] : -evidence[i] / 3);

  const score = new Float64Array(nb * 4);
  const from = new Int8Array(nb * 4);
  // Prior: audio that begins exactly on a beat (a sample-aligned loop, a DJ edit) almost always begins on bar 1.
  // It only tips the balance when the evidence is thin (short material, flat four-on-the-floor accents).
  for (let st = 0; st < 4; st++) score[st] = emit(0, st) + (options.startsOnBeat && st === 0 ? START_ON_BEAT_PRIOR : 0);
  for (let i = 1; i < nb; i++) {
    for (let st = 0; st < 4; st++) {
      let best = -Infinity;
      let bestFrom = 0;
      for (let prev = 0; prev < 4; prev++) {
        const cost = st === (prev + 1) % 4 ? 0 : BAR_SLIP_PENALTY;
        const v = score[(i - 1) * 4 + prev] - cost;
        if (v > best) {
          best = v;
          bestFrom = prev;
        }
      }
      score[i * 4 + st] = best + emit(i, st);
      from[i * 4 + st] = bestFrom;
    }
  }
  let st = 0;
  for (let k = 1; k < 4; k++) if (score[(nb - 1) * 4 + k] > score[(nb - 1) * 4 + st]) st = k;
  const positions = new Array<number>(nb);
  for (let i = nb - 1; i >= 0; i--) {
    positions[i] = st;
    st = from[i * 4 + st];
  }

  // confidence: margin between the best and second-best single global phase (slip-free), per bar of evidence
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let i = 1; i < nb; i++) {
    sums[i % 4] += evidence[i];
    counts[i % 4]++;
  }
  const means = sums.map((v, p) => (counts[p] > 0 ? v / counts[p] : -Infinity));
  const order = [0, 1, 2, 3].sort((a, b) => means[b] - means[a]);
  const confidence = Math.max(0, Math.min(1, (means[order[0]] - means[order[1]]) / 1.0));
  return { positions, confidence };
}

// ---------------------------------------------------------------------------
// 5. Bars, phrases, sections
// ---------------------------------------------------------------------------

interface BarFeatures {
  /** z-scored [low, lowMid, mid, high, fluxDensity] per bar */
  vectors: number[][];
  /** mean linear RMS per bar */
  rms: number[];
}

function computeBarFeatures(barStartFrames: number[], endFrame: number, f: SpectralFeatures): BarFeatures {
  const raw: number[][] = [];
  const rms: number[] = [];
  for (let j = 0; j < barStartFrames.length; j++) {
    const a = Math.round(barStartFrames[j]);
    const b = Math.min(f.numFrames, Math.round(j + 1 < barStartFrames.length ? barStartFrames[j + 1] : endFrame));
    const v = [0, 0, 0, 0, 0];
    let r = 0;
    let c = 0;
    for (let t = a; t < b; t++) {
      v[0] += f.level.low[t];
      v[1] += f.level.lowMid[t];
      v[2] += f.level.mid[t];
      v[3] += f.level.high[t];
      v[4] += f.oss[t];
      r += f.rms[t];
      c++;
    }
    if (c > 0) for (let d = 0; d < 5; d++) v[d] /= c;
    raw.push(v);
    rms.push(c > 0 ? r / c : 0);
  }
  const vectors = raw.map(() => new Array<number>(5).fill(0));
  for (let d = 0; d < 5; d++) {
    const z = zScores(raw.map((v) => v[d]));
    for (let j = 0; j < raw.length; j++) vectors[j][d] = z[j];
  }
  return { vectors, rms };
}

/** Novelty at each bar boundary j: distance between the mean feature vector of the `w` bars after it and the `w` bars before it. */
function barNovelty(vectors: number[][], w: number): number[] {
  const nBars = vectors.length;
  const nov = new Array<number>(nBars).fill(0);
  const mean = (a: number, b: number): number[] => {
    const m = [0, 0, 0, 0, 0];
    for (let j = a; j < b; j++) for (let d = 0; d < 5; d++) m[d] += vectors[j][d];
    for (let d = 0; d < 5; d++) m[d] /= Math.max(1, b - a);
    return m;
  };
  for (let j = 2; j < nBars - 1; j++) {
    const before = mean(Math.max(0, j - w), j);
    const after = mean(j, Math.min(nBars, j + w));
    let d2 = 0;
    for (let d = 0; d < 5; d++) d2 += (after[d] - before[d]) ** 2;
    nov[j] = Math.sqrt(d2);
  }
  return nov;
}

function bestPhase(nov: number[], period: number, candidates: number[]): { phase: number; margin: number } {
  const means = candidates.map((p) => {
    let s = 0;
    let c = 0;
    for (let j = p; j < nov.length; j += period) {
      if (j < 2) continue; // bar 0/1 have no history to be "new" against
      s += nov[j];
      c++;
    }
    return c > 0 ? s / c : -Infinity;
  });
  const order = means.map((_, i) => i).sort((a, b) => means[b] - means[a]);
  const top = means[order[0]];
  const second = means.length > 1 ? means[order[1]] : 0;
  const scale = Math.max(1e-6, Math.abs(top));
  return { phase: candidates[order[0]], margin: Math.max(0, Math.min(1, (top - second) / scale)) };
}

function detectSections(
  nov: number[],
  rms: number[],
  barTimes: number[],
  durationSec: number
): SongSection[] {
  const nBars = barTimes.length;
  if (nBars < 8) return [];

  const mean = nov.reduce((s, v) => s + v, 0) / nov.length;
  const std = Math.sqrt(nov.reduce((s, v) => s + (v - mean) ** 2, 0) / nov.length) || 1;
  const threshold = mean + 0.75 * std;

  // peak picking with a minimum spacing of 4 bars
  const peaks: number[] = [];
  for (let j = 2; j < nBars - 2; j++) {
    if (nov[j] < threshold || nov[j] < nov[j - 1] || nov[j] < nov[j + 1]) continue;
    if (peaks.length > 0 && j - peaks[peaks.length - 1] < 4) {
      if (nov[j] > nov[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = j;
      continue;
    }
    peaks.push(j);
  }

  const starts = [0, ...peaks];
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.9)] || 1;
  const raw = starts.map((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1] : nBars;
    let r = 0;
    for (let j = s; j < e; j++) r += rms[j];
    return { startBar: s, endBar: e, energy: Math.min(1, r / Math.max(1, e - s) / loud) };
  });
  const energies = raw.map((s) => s.energy).sort((a, b) => a - b);
  const median = energies[Math.floor(energies.length / 2)] || 1;

  return raw.map((s, i) => {
    const startSec = i === 0 ? 0 : barTimes[s.startBar];
    const endSec = s.endBar >= nBars ? durationSec : barTimes[s.endBar];
    const prev = i > 0 ? raw[i - 1].energy : null;
    const next = i + 1 < raw.length ? raw[i + 1] : null;
    let label: SongSectionLabel = "body";
    if (i === 0 && s.energy < 0.8 * median) label = "intro";
    else if (i === raw.length - 1 && raw.length > 1 && s.energy < 0.8 * median) label = "outro";
    else if (s.energy < 0.55 * median) label = "breakdown";
    else if (prev !== null && s.energy > 1.1 * median && prev < 0.8 * s.energy) label = "drop";
    else if (next && next.energy > 1.25 * s.energy && s.energy >= 0.55 * median) label = "build";
    const strength = i === 0 ? 1 : Math.min(1, Math.max(0, (nov[s.startBar] - mean) / (3 * std)));
    return { startSec, endSec, label, energy: s.energy, confidence: strength };
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Builds a song map from mono samples. Null when the audio is too short or no steady tempo can be found. `minDurationSec` is overridable for testing on short loops. */
export function buildSongMap(
  samples: Float32Array,
  sampleRate: number,
  durationSec: number,
  options: { minDurationSec?: number } = {}
): SongMap | null {
  if (durationSec < (options.minDurationSec ?? MIN_DURATION_SEC) || samples.length < sampleRate * 4) return null;

  const features = computeSpectralFeatures(samples, sampleRate);
  if (features.onsetActivity < MIN_ONSET_ACTIVITY) return null;
  const tempo = estimateTempoFromOnsets(features.oss, features.frameRateHz);
  // A low tempoConfidence is NOT a reason to discard the map: it is carried in the output, and isPhraseGridTrustworthy
  // is the gate callers use. Only "no tempo at all" returns null.
  if (!tempo) return null;

  const beatFramesRaw = trackBeatFrames(features.oss, features.frameRateHz, tempo.bpm);
  if (beatFramesRaw.length < 4) return null;
  const periodFrames = (60 * features.frameRateHz) / tempo.bpm;
  const tracked = fillBeatGaps(beatFramesRaw.map((f) => refineFrame(features.oss, f)), periodFrames);
  const beatFrames = extendBeatGrid(tracked, periodFrames, features.numFrames);
  const beats = beatFrames.map((f) => r3(frameToSec(f, features)));

  // mean tempo implied by the tracked beats (tracks drift the tempo estimate alone can't see)
  const bpm = (60 * (beats.length - 1)) / (beats[beats.length - 1] - beats[0]);

  const startsOnBeat = frameToSec(beatFrames[0], features) <= START_ALIGN_SEC;
  const { positions, confidence: downbeatConfidence } = estimateBarPositions(beatFrames, features, { startsOnBeat });
  const downbeatFrames: number[] = [];
  let phase = -1;
  positions.forEach((pos, i) => {
    if (pos !== 0) return;
    if (phase < 0) phase = i;
    downbeatFrames.push(beatFrames[i]);
  });
  if (phase < 0) phase = 0;
  const downbeats = downbeatFrames.map((f) => r3(frameToSec(f, features)));

  const bar = computeBarFeatures(downbeatFrames, features.numFrames, features);
  const nov8 = barNovelty(bar.vectors, 4);
  const p8 = bestPhase(nov8, 8, [0, 1, 2, 3, 4, 5, 6, 7]);
  const p16 = bestPhase(nov8, 16, [p8.phase, p8.phase + 8]);
  const p32 = bestPhase(nov8, 32, [p16.phase, p16.phase + 16]);
  const at = (phase0: number, period: number): number[] => {
    const out: number[] = [];
    for (let j = phase0; j < downbeats.length; j += period) out.push(downbeats[j]);
    return out;
  };

  const sections = detectSections(nov8, bar.rms, downbeats, durationSec).map((s) => ({
    ...s,
    startSec: r3(s.startSec),
    endSec: r3(s.endSec),
    energy: r3(s.energy),
    confidence: r3(s.confidence),
  }));

  return {
    version: SONG_MAP_VERSION,
    durationSec: r3(durationSec),
    bpm: r3(bpm),
    tempoConfidence: r3(tempoConfidenceFromRegularity(beatRegularity(beatFramesRaw))),
    beatsPerBar: 4,
    beats,
    downbeatPhase: phase,
    downbeatConfidence: r3(downbeatConfidence),
    downbeats,
    phrases: {
      bars8: at(p8.phase, 8),
      bars16: at(p16.phase, 16),
      bars32: at(p32.phase, 32),
      confidence: r3(p8.margin),
    },
    sections,
  };
}

// ---------------------------------------------------------------------------
// Using a song map
// ---------------------------------------------------------------------------

/** The phrase boundary (8-, 16- or 32-bar) closest to `timeSec`; null when the map has none. */
export function nearestPhraseBoundary(map: SongMap, timeSec: number, phraseBars: 8 | 16 | 32 = 8): number | null {
  const list = phraseBars === 32 ? map.phrases.bars32 : phraseBars === 16 ? map.phrases.bars16 : map.phrases.bars8;
  if (list.length === 0) return null;
  let best = list[0];
  for (const t of list) if (Math.abs(t - timeSec) < Math.abs(best - timeSec)) best = t;
  return best;
}

/** The first phrase boundary at or after `timeSec`; null when there is none. */
export function nextPhraseBoundary(map: SongMap, timeSec: number, phraseBars: 8 | 16 | 32 = 8): number | null {
  const list = phraseBars === 32 ? map.phrases.bars32 : phraseBars === 16 ? map.phrases.bars16 : map.phrases.bars8;
  for (const t of list) if (t >= timeSec - 1e-6) return t;
  return null;
}

/** True when the map's downbeats and phrases are trustworthy enough to align a mix to. */
export function isPhraseGridTrustworthy(map: SongMap | null | undefined): map is SongMap {
  return !!map && map.tempoConfidence >= 0.3 && map.downbeatConfidence >= 0.3 && map.downbeats.length >= 8;
}
