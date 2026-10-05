/**
 * Synthetic songs with exact ground truth, for testing and measuring the
 * song map (song-map.ts). Not shipped behaviour: only song-map.test.ts and
 * the evaluation scripts import this.
 *
 * Each song is 4/4 with kick/snare/hat/bass/pad/lead layers switched on and
 * off per section, so bar-level energy and spectrum change at known phrase
 * boundaries. Tempo can drift sinusoidally and the music can start after a
 * silent lead-in, to exercise the beat tracker and the downbeat logic.
 */

export interface SynthSection {
  bars: number;
  layers: ("kick" | "snare" | "hat" | "bass" | "pad" | "lead")[];
  /** Overall level multiplier, default 1. */
  gain?: number;
}

export interface SynthOptions {
  bpm: number;
  sections: SynthSection[];
  sampleRate?: number;
  /** Seconds of silence before bar 1. */
  leadInSec?: number;
  /** "four": kick on every beat; "one-three": kick on beats 1 and 3 only. */
  kickPattern?: "four" | "one-three";
  /** Tempo modulation depth as a fraction (0.02 = ±2%), period 40 s. */
  driftFraction?: number;
  /** White-noise floor amplitude. */
  noise?: number;
  seed?: number;
}

export interface SynthTruth {
  beats: number[];
  downbeats: number[];
  /** Start of every 8-bar group counted from bar 1. */
  phrases8: number[];
  /** Section start times (excluding the very first). */
  sectionStarts: number[];
  durationSec: number;
}

export const DEFAULT_SECTIONS: SynthSection[] = [
  { bars: 8, layers: ["hat", "pad"], gain: 0.7 }, // intro: no kick
  { bars: 16, layers: ["kick", "hat", "bass", "pad"] },
  { bars: 16, layers: ["kick", "snare", "hat", "bass", "pad", "lead"], gain: 1.15 }, // drop
  { bars: 8, layers: ["pad"], gain: 0.6 }, // breakdown
  { bars: 16, layers: ["kick", "snare", "hat", "bass", "pad", "lead"], gain: 1.15 },
  { bars: 8, layers: ["kick", "hat"], gain: 0.7 }, // outro
];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function renderSynthSong(opts: SynthOptions): { samples: Float32Array; sampleRate: number; truth: SynthTruth } {
  const sr = opts.sampleRate ?? 44100;
  const rand = rng(opts.seed ?? 1);
  const lead = opts.leadInSec ?? 0;
  const drift = opts.driftFraction ?? 0;
  const totalBars = opts.sections.reduce((s, x) => s + x.bars, 0);
  const totalBeats = totalBars * 4;

  // beat times with a drifting tempo: integrate the beat period
  const beatTimes: number[] = [];
  let t = lead;
  for (let k = 0; k < totalBeats; k++) {
    beatTimes.push(t);
    const bpmNow = opts.bpm * (1 + drift * Math.sin((2 * Math.PI * (t - lead)) / 40));
    t += 60 / bpmNow;
  }
  const durationSec = t + 1.5;
  const samples = new Float32Array(Math.ceil(durationSec * sr));

  const add = (startSec: number, gen: (tSec: number) => number, lenSec: number, amp: number) => {
    const s0 = Math.floor(startSec * sr);
    const n = Math.min(samples.length - s0, Math.floor(lenSec * sr));
    for (let i = 0; i < n; i++) samples[s0 + i] += amp * gen(i / sr);
  };
  const noise = () => rand() * 2 - 1;

  // section lookup per bar
  const barSection: SynthSection[] = [];
  for (const sec of opts.sections) for (let b = 0; b < sec.bars; b++) barSection.push(sec);

  const notes = [0, 5, 3, 7]; // bass root cycle (semitones above A1) — one note per bar, so bar lines carry a bass change
  const chords = [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [196, 246.94, 293.66],
    [220, 277.18, 329.63],
  ];

  for (let k = 0; k < totalBeats; k++) {
    const bar = Math.floor(k / 4);
    const beatInBar = k % 4;
    const sec = barSection[bar];
    const g = sec.gain ?? 1;
    const t0 = beatTimes[k];
    const beatLen = (beatTimes[k + 1] ?? t0 + 0.5) - t0;
    const has = (l: SynthSection["layers"][number]) => sec.layers.includes(l);

    if (has("kick") && (opts.kickPattern !== "one-three" || beatInBar % 2 === 0)) {
      add(t0, (x) => Math.sin(2 * Math.PI * (45 * x + 75 * (1 - Math.exp(-x * 30)) / 30)) * Math.exp(-x * 14), 0.3, 0.9 * g);
    }
    if (has("snare") && beatInBar % 2 === 1) {
      add(t0, (x) => (noise() * 0.7 + Math.sin(2 * Math.PI * 190 * x) * 0.5) * Math.exp(-x * 28), 0.2, 0.5 * g);
    }
    if (has("hat")) {
      for (const off of [0, 0.5]) {
        add(t0 + off * beatLen, (x) => (noise() - noise()) * Math.exp(-x * 90), 0.06, 0.18 * g);
      }
    }
    if (has("bass") && beatInBar === 0) {
      const f = 55 * Math.pow(2, notes[bar % 4] / 12);
      add(t0, (x) => (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(2 * Math.PI * 2 * f * x)) * Math.exp(-x * 2.2), beatLen * 3.6, 0.5 * g);
    }
    if (has("lead") && beatInBar !== 3) {
      const f = 440 * Math.pow(2, notes[(bar + beatInBar) % 4] / 12);
      add(t0, (x) => Math.sign(Math.sin(2 * Math.PI * f * x)) * 0.5 * Math.exp(-x * 5), beatLen * 0.9, 0.16 * g);
    }
    if (has("pad") && beatInBar === 0 && bar % 2 === 0) {
      const chord = chords[Math.floor(bar / 2) % 4];
      add(t0, (x) => chord.reduce((s, f) => s + Math.sin(2 * Math.PI * f * x), 0) / 3 * Math.min(1, x * 4) * Math.min(1, (beatLen * 8 - x) * 4), beatLen * 8, 0.18 * g);
    }
  }

  if (opts.noise) for (let i = 0; i < samples.length; i++) samples[i] += (rand() * 2 - 1) * opts.noise;
  // keep inside [-1, 1] with headroom, like a mastered file
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0.95) for (let i = 0; i < samples.length; i++) samples[i] *= 0.95 / peak;

  const downbeats = beatTimes.filter((_, i) => i % 4 === 0);
  const phrases8 = downbeats.filter((_, i) => i % 8 === 0);
  const sectionStarts: number[] = [];
  let acc = 0;
  for (const sec of opts.sections) {
    if (acc > 0) sectionStarts.push(downbeats[acc]);
    acc += sec.bars;
  }
  return { samples, sampleRate: sr, truth: { beats: beatTimes, downbeats, phrases8, sectionStarts, durationSec } };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** F-measure of estimated vs true event times within ±tolSec (each true event matches at most one estimate). */
export function fMeasure(est: number[], truth: number[], tolSec: number): { f: number; precision: number; recall: number; medianErrMs: number; medianSignedErrMs: number } {
  const used = new Set<number>();
  const errs: number[] = [];
  let hits = 0;
  for (const e of est) {
    let bestJ = -1;
    let bestD = Infinity;
    for (let j = 0; j < truth.length; j++) {
      const d = Math.abs(truth[j] - e);
      if (d < bestD && !used.has(j)) {
        bestD = d;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestD <= tolSec) {
      used.add(bestJ);
      hits++;
      errs.push(e - truth[bestJ]);
    }
  }
  const precision = est.length ? hits / est.length : 0;
  const recall = truth.length ? hits / truth.length : 0;
  const f = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const sorted = errs.map(Math.abs).sort((a, b) => a - b);
  const signed = [...errs].sort((a, b) => a - b);
  return {
    f,
    precision,
    recall,
    medianErrMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] * 1000 : NaN,
    medianSignedErrMs: signed.length ? signed[Math.floor(signed.length / 2)] * 1000 : NaN,
  };
}
