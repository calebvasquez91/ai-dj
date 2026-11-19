// The colours of the deck's waveform. By default the app's own accent colours (violet to cyan). When the playing song has a cover, colours drawn
// from the cover instead, adjusted so they read on the dark surface (WCAG AA, 4.5:1). A playlist with a holiday theme overrides both. Spooky Music
// has its own look and is decided before any of this (the deck keeps its spooky classes). Pure; the browser side reads the cover's pixels
// (components/useWaveformColors.ts) and hands them to paletteFromPixels.
import { activeHolidayTheme } from "@/lib/holidayThemes";

export interface WaveformColors {
  /** Bottom of each played bar. */
  from: string;
  /** Top of each played bar. */
  to: string;
}

/** The app's own accent tokens: the default, used for any song without a usable cover. */
export const DEFAULT_WAVEFORM: WaveformColors = { from: "var(--accent-teal)", to: "var(--accent-purple)" };

/** The dark surface the waveform sits on, for contrast. */
export const WAVEFORM_BACKGROUND = "#0b0b14";
/** WCAG AA for normal text; the waveform is held to it too. */
export const AA_RATIO = 4.5;

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of two colours, 1 to 21. */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const ra = typeof a === "string" ? hexToRgb(a) : a;
  const rb = typeof b === "string" ? hexToRgb(b) : b;
  if (!ra || !rb) return 1;
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour mixed towards white until it has the contrast against the background (keeping its hue as far as possible). */
export function ensureContrast(color: Rgb, background: Rgb | string = WAVEFORM_BACKGROUND, ratio = AA_RATIO): Rgb {
  let current = color;
  for (let step = 0; step < 40 && contrastRatio(current, background) < ratio; step++) {
    current = current.map((v) => v + (255 - v) * 0.08) as Rgb;
  }
  return current;
}

function saturation([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Two colours for a waveform from a cover's pixels (RGBA, as a canvas gives them): the two most common colours that are colourful enough and
 * not too dark or too light, far enough apart to read as two, each lifted to AA contrast. Null when the cover has no usable colour (a grey or
 * near-black picture): the default colours are used then.
 */
export function paletteFromPixels(pixels: ArrayLike<number>, background: Rgb | string = WAVEFORM_BACKGROUND): WaveformColors | null {
  const buckets = new Map<number, { rgb: [number, number, number]; count: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue; // see-through pixels carry no colour
    const rgb: Rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const key = ((rgb[0] >> 5) << 6) | ((rgb[1] >> 5) << 3) | (rgb[2] >> 5);
    const b = buckets.get(key);
    if (b) {
      b.rgb[0] += rgb[0];
      b.rgb[1] += rgb[1];
      b.rgb[2] += rgb[2];
      b.count++;
    } else buckets.set(key, { rgb: [...rgb], count: 1 });
  }
  const candidates = [...buckets.values()]
    .map((b) => ({ rgb: b.rgb.map((v) => v / b.count) as Rgb, count: b.count }))
    .filter((c) => saturation(c.rgb) >= 0.25 && luminance(c.rgb) >= 0.02 && luminance(c.rgb) <= 0.85)
    .sort((a, b) => b.count * (1 + saturation(b.rgb)) - a.count * (1 + saturation(a.rgb)));
  if (candidates.length === 0) return null;
  const first = candidates[0].rgb;
  const second = candidates.find((c) => c.rgb.reduce((d, v, i) => d + Math.abs(v - first[i]), 0) > 120)?.rgb ?? first;
  return { from: rgbToHex(ensureContrast(first, background)), to: rgbToHex(ensureContrast(second, background)) };
}

/**
 * Which colours the waveform uses: the holiday theme of the playing playlist when it has one (never for a system playlist), else the cover's
 * palette when the song has a cover and one was found, else the app's own colours.
 */
export function waveformColors(args: {
  playlist?: { holidayTheme?: string | null; theme?: string | null } | null;
  coverPalette?: WaveformColors | null;
}): WaveformColors {
  const holiday = activeHolidayTheme(args.playlist);
  if (holiday) return holiday.waveform;
  return args.coverPalette ?? DEFAULT_WAVEFORM;
}

// ---- remembering a cover's palette ---------------------------------------------------------------------------------------------------

export const PALETTE_CACHE_KEY = "ai-dj:cover-palettes";
const PALETTE_CACHE_LIMIT = 300;

type PaletteCache = Record<string, WaveformColors | null>;

/** A cover's remembered palette: undefined when it has not been worked out, null when it was and had no usable colour. */
export function loadPalette(storage: Pick<Storage, "getItem"> | null | undefined, trackId: string): WaveformColors | null | undefined {
  try {
    const cache = JSON.parse(storage?.getItem(PALETTE_CACHE_KEY) ?? "{}") as PaletteCache;
    return Object.prototype.hasOwnProperty.call(cache, trackId) ? cache[trackId] : undefined;
  } catch {
    return undefined;
  }
}

export function savePalette(storage: Pick<Storage, "getItem" | "setItem"> | null | undefined, trackId: string, palette: WaveformColors | null): void {
  try {
    const cache = JSON.parse(storage?.getItem(PALETTE_CACHE_KEY) ?? "{}") as PaletteCache;
    cache[trackId] = palette;
    const keys = Object.keys(cache);
    for (const old of keys.slice(0, Math.max(0, keys.length - PALETTE_CACHE_LIMIT))) delete cache[old];
    storage?.setItem(PALETTE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage full or blocked: the palette is just worked out again next time
  }
}
