import { describe, expect, it } from "vitest";
import {
  AA_RATIO,
  contrastRatio,
  DEFAULT_WAVEFORM,
  ensureContrast,
  hexToRgb,
  loadPalette,
  paletteFromPixels,
  PALETTE_CACHE_KEY,
  rgbToHex,
  savePalette,
  waveformColors,
  WAVEFORM_BACKGROUND,
} from "./waveformColors";

/** RGBA pixels filled with the given colours in proportion. */
function pixels(parts: [number, number, number, number][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [r, g, b, count] of parts) for (let i = 0; i < count; i++) out.push(r, g, b, 255);
  return new Uint8ClampedArray(out);
}

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("colour maths", () => {
  it("converts hex and back, and rejects what is not a colour", () => {
    expect(hexToRgb("#ff6b00")).toEqual([255, 107, 0]);
    expect(rgbToHex([255, 107, 0])).toBe("#ff6b00");
    expect(hexToRgb("nope")).toBeNull();
  });
  it("measures WCAG contrast: black on white is 21, a colour on itself 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#336699", "#336699")).toBe(1);
  });
  it("lifts a dark colour until it reads on the dark surface, and leaves a bright one alone", () => {
    const dark = ensureContrast([20, 30, 90]);
    expect(contrastRatio(dark, WAVEFORM_BACKGROUND)).toBeGreaterThanOrEqual(AA_RATIO);
    expect(ensureContrast([255, 200, 0])).toEqual([255, 200, 0]);
  });
});

describe("paletteFromPixels (cover-art colours)", () => {
  it("takes the cover's two main colours, both readable on the dark surface (AA)", () => {
    const palette = paletteFromPixels(pixels([[200, 30, 40, 600], [20, 60, 200, 400], [10, 10, 10, 300]]))!;
    expect(palette).not.toBeNull();
    expect(palette.from).not.toBe(palette.to);
    expect(contrastRatio(palette.from, WAVEFORM_BACKGROUND)).toBeGreaterThanOrEqual(AA_RATIO);
    expect(contrastRatio(palette.to, WAVEFORM_BACKGROUND)).toBeGreaterThanOrEqual(AA_RATIO);
    // the most common colourful colour is red-ish, the next blue-ish
    const [r1, , b1] = hexToRgb(palette.from)!;
    expect(r1).toBeGreaterThan(b1);
  });
  it("uses the one colour twice for a cover with only one", () => {
    const palette = paletteFromPixels(pixels([[200, 30, 40, 800]]))!;
    expect(palette.from).toBe(palette.to);
  });
  it("says null for a grey or black cover, so the default colours are used", () => {
    expect(paletteFromPixels(pixels([[128, 128, 128, 500], [5, 5, 5, 500]]))).toBeNull();
    expect(paletteFromPixels(new Uint8ClampedArray())).toBeNull();
  });
  it("ignores see-through pixels", () => {
    expect(paletteFromPixels(new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 0]))).toBeNull();
  });
});

describe("waveformColors: which colours the deck uses", () => {
  const cover = { from: "#ff8844", to: "#44aaff" };
  it("uses the app's own colours by default", () => {
    expect(waveformColors({})).toEqual(DEFAULT_WAVEFORM);
    expect(DEFAULT_WAVEFORM).toEqual({ from: "var(--accent-teal)", to: "var(--accent-purple)" });
  });
  it("uses the cover's colours only when the song has a cover palette", () => {
    expect(waveformColors({ coverPalette: cover })).toEqual(cover);
    expect(waveformColors({ coverPalette: null })).toEqual(DEFAULT_WAVEFORM);
  });
  it("lets a holiday playlist override both", () => {
    expect(waveformColors({ playlist: { holidayTheme: "christmas" }, coverPalette: cover })).toEqual({ from: "#34d058", to: "#ff5c5c" });
    expect(waveformColors({ playlist: { holidayTheme: "valentines" } })).toEqual({ from: "#ff6fa5", to: "#ff4d6d" });
  });
  it("never lets a holiday theme onto a system playlist (Spooky Music)", () => {
    expect(waveformColors({ playlist: { holidayTheme: "christmas", theme: "spooky" }, coverPalette: cover })).toEqual(cover);
  });
});

describe("remembering a cover's palette", () => {
  it("round-trips, telling 'not worked out' from 'worked out and none'", () => {
    const storage = memory();
    expect(loadPalette(storage, "t1")).toBeUndefined();
    savePalette(storage, "t1", { from: "#ff0000", to: "#0000ff" });
    savePalette(storage, "t2", null);
    expect(loadPalette(storage, "t1")).toEqual({ from: "#ff0000", to: "#0000ff" });
    expect(loadPalette(storage, "t2")).toBeNull();
    expect(loadPalette(storage, "t3")).toBeUndefined();
  });
  it("keeps only the most recent few hundred", () => {
    const storage = memory();
    for (let i = 0; i < 320; i++) savePalette(storage, `t${i}`, { from: "#ff0000", to: "#00ff00" });
    expect(Object.keys(JSON.parse(storage.getItem(PALETTE_CACHE_KEY)!))).toHaveLength(300);
    expect(loadPalette(storage, "t0")).toBeUndefined();
    expect(loadPalette(storage, "t319")).not.toBeUndefined();
  });
  it("survives storage that is missing, corrupt or throws", () => {
    expect(loadPalette(null, "t")).toBeUndefined();
    expect(loadPalette({ getItem: () => "{{{" }, "t")).toBeUndefined();
    expect(() => savePalette({ getItem: () => null, setItem: () => { throw new Error("full"); } }, "t", null)).not.toThrow();
  });
});
