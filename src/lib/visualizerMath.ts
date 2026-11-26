/**
 * The maths of the Now Playing visualizer, kept apart from the canvas so it can be tested: smoothing the loudness, finding beats in it, a palette that blends
 * between a theme's colours, and the curves themselves. The look is inspired by the iTunes visualizers: glowing ribbons that loop and weave around the centre
 * (a harmonograph: sums of sine waves, mirrored round the middle like a kaleidoscope), leaving fading trails, with a ring that bursts out on each beat.
 * Everything here is a pure function of its inputs (the clock and the level are passed in), so the same song moment always draws the same picture.
 */

export type Rgb = [number, number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** "#rrggbb" or "#rgb" to [r, g, b]; anything else is mid grey (a bad theme colour must never throw). */
export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** A colour along a palette: u = 0 is the first colour, u = 1 the last, blended in between. Out-of-range u is clamped. */
export function paletteAt(palette: readonly Rgb[], u: number): Rgb {
  if (palette.length === 0) return [255, 255, 255];
  if (palette.length === 1) return palette[0];
  const pos = clamp01(u) * (palette.length - 1);
  const i = Math.min(palette.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = palette[i], b = palette[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

/** A palette that loops: u wraps round, so a slowly turning u cycles through every colour and back without a jump. */
export function paletteLoop(palette: readonly Rgb[], u: number): Rgb {
  if (palette.length < 2) return paletteAt(palette, 0);
  const looped = [...palette, palette[0]];
  const w = ((u % 1) + 1) % 1;
  return paletteAt(looped, w);
}

export const rgba = (c: Rgb, alpha: number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(alpha).toFixed(3)})`;

/** Eases the level towards a new reading: quick to rise (a hit shows at once), slow to fall (it decays like a phosphor, not a flicker). */
export function smoothLevel(prev: number, next: number, attack = 0.55, release = 0.1): number {
  const target = clamp01(next);
  return prev + (target - prev) * (target > prev ? attack : release);
}

export interface BeatState {
  /** Recent levels, newest last. */
  history: number[];
  /** When the last beat fired (ms), for the cool-down. */
  lastBeatMs: number;
}

export const EMPTY_BEAT: BeatState = { history: [], lastBeatMs: -Infinity };

/** How many recent readings the beat finder compares against, how much louder than their average a reading must be, and the shortest gap between two beats. */
export const BEAT_WINDOW = 24;
export const BEAT_MARGIN = 0.12;
export const BEAT_MIN_GAP_MS = 220;
/** A reading this quiet is never a beat (silence is not a hit). */
export const BEAT_FLOOR = 0.08;

/** Feeds one level reading in; says whether it is a beat (a sudden rise above the recent average, not too soon after the last one). */
export function stepBeat(state: BeatState, level: number, nowMs: number): { state: BeatState; beat: boolean } {
  const history = [...state.history, level].slice(-BEAT_WINDOW);
  const past = history.slice(0, -1);
  const avg = past.length > 0 ? past.reduce((a, b) => a + b, 0) / past.length : level;
  const beat = past.length >= 6 && level > BEAT_FLOOR && level - avg > BEAT_MARGIN && nowMs - state.lastBeatMs >= BEAT_MIN_GAP_MS;
  return { state: { history, lastBeatMs: beat ? nowMs : state.lastBeatMs }, beat };
}

/**
 * One point of a ribbon, in a -1..1 box. Two sine waves per axis whose frequencies are small whole-number ratios (so the curve closes into a pretty loop) and whose
 * phases drift with `timeSec` (so the loop slowly turns inside out); `amount` (0-1, the loudness) swells the whole figure.
 */
export function ribbonPoint(u: number, timeSec: number, ribbon: number, amount: number): [number, number] {
  const t = u * Math.PI * 2;
  const k = ribbon + 1;
  const drift = timeSec * (0.18 + 0.05 * k);
  const swell = 0.28 + 0.72 * clamp01(amount);
  const x = 0.62 * Math.sin(t * (2 + k) + drift * (1 + 0.3 * k)) + 0.38 * Math.sin(t * (3 + 2 * k) - drift * 1.7);
  const y = 0.62 * Math.cos(t * (3 + k) - drift * (1.2 + 0.2 * k)) + 0.38 * Math.cos(t * (2 + 2 * k) + drift * 1.3);
  return [x * swell, y * swell];
}

/** Rotates a point around the centre: the kaleidoscope's mirrored copies are the same ribbon turned by 2π·k/n. */
export function rotatePoint(p: [number, number], angle: number): [number, number] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/**
 * A loudness-driven stand-in for a spectrum: `count` values 0-1 that share the level between them, each swaying at its own pace, so the spokes of the figure dance
 * in time with the music without needing a full frequency analysis. The lower bands are given more weight, as in music.
 */
export function bandLevels(level: number, timeSec: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const weight = 1 - 0.55 * (i / Math.max(1, count - 1));
    const sway = 0.5 + 0.5 * Math.sin(timeSec * (1.3 + (i % 7) * 0.37) + i * 1.9);
    out.push(clamp01(level * weight * (0.35 + 0.65 * sway)));
  }
  return out;
}

export interface Ring {
  /** When it was born, ms. */
  bornMs: number;
  /** 0-1: how hard the beat hit. */
  strength: number;
}

export const RING_LIFE_MS = 900;
export const MAX_RINGS = 6;

/** Adds a ring for a beat, dropping the oldest when there are too many, and removes the ones that have faded out. */
export function stepRings(rings: readonly Ring[], nowMs: number, beat: { strength: number } | null): Ring[] {
  const alive = rings.filter((r) => nowMs - r.bornMs < RING_LIFE_MS);
  if (beat) alive.push({ bornMs: nowMs, strength: clamp01(beat.strength) });
  return alive.slice(-MAX_RINGS);
}

/** A ring's radius (as a share of the figure's radius, 0.15 to 1.15) and its opacity (fading to nothing) at this moment. */
export function ringShape(ring: Ring, nowMs: number): { radius: number; alpha: number } {
  const age = clamp01((nowMs - ring.bornMs) / RING_LIFE_MS);
  const ease = 1 - (1 - age) * (1 - age);
  return { radius: 0.15 + 1.0 * ease, alpha: (1 - age) * (0.25 + 0.5 * ring.strength) };
}

/** The figure's radius for a canvas of this size: it stays inside the panel, with room at the edges, and never exceeds the short side. */
export function figureRadius(width: number, height: number): number {
  return Math.max(0, Math.min(width, height) * 0.46);
}
