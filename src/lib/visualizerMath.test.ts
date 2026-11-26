import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BEAT_MIN_GAP_MS,
  EMPTY_BEAT,
  MAX_RINGS,
  RING_LIFE_MS,
  bandLevels,
  figureRadius,
  paletteAt,
  paletteLoop,
  parseHex,
  rgba,
  ribbonPoint,
  ringShape,
  rotatePoint,
  smoothLevel,
  stepBeat,
  stepRings,
  type BeatState,
} from "./visualizerMath";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

describe("colours", () => {
  it("reads 3- and 6-digit hex, and never throws on a bad colour", () => {
    expect(parseHex("#ff6b00")).toEqual([255, 107, 0]);
    expect(parseHex("#f60")).toEqual([255, 102, 0]);
    expect(parseHex("ff6b00")).toEqual([255, 107, 0]);
    expect(parseHex("oklch(0.7 0.1 200)")).toEqual([128, 128, 128]);
    expect(parseHex("")).toEqual([128, 128, 128]);
  });

  it("blends along a palette and clamps outside it", () => {
    const p = [parseHex("#000000"), parseHex("#ffffff")];
    expect(paletteAt(p, 0)).toEqual([0, 0, 0]);
    expect(paletteAt(p, 1)).toEqual([255, 255, 255]);
    expect(paletteAt(p, 0.5)).toEqual([128, 128, 128]);
    expect(paletteAt(p, -3)).toEqual([0, 0, 0]);
    expect(paletteAt(p, 9)).toEqual([255, 255, 255]);
    expect(paletteAt([], 0.5)).toEqual([255, 255, 255]);
    expect(paletteAt([[1, 2, 3]], 0.7)).toEqual([1, 2, 3]);
  });

  it("loops: the end joins the start with no jump, and negative or large u wraps", () => {
    const p = [parseHex("#ff0000"), parseHex("#00ff00"), parseHex("#0000ff")];
    expect(paletteLoop(p, 0)).toEqual(paletteLoop(p, 1));
    expect(paletteLoop(p, 0.25)).toEqual(paletteLoop(p, 3.25));
    expect(paletteLoop(p, -0.75)).toEqual(paletteLoop(p, 0.25));
    expect(rgba([1, 2, 3], 2)).toBe("rgba(1,2,3,1.000)");
    expect(rgba([1, 2, 3], -1)).toBe("rgba(1,2,3,0.000)");
  });
});

describe("the level", () => {
  it("rises fast and falls slowly, and stays between 0 and 1", () => {
    const up = smoothLevel(0, 1);
    const down = smoothLevel(1, 0);
    expect(up).toBeGreaterThan(0.5);
    expect(1 - down).toBeLessThan(0.2);
    expect(smoothLevel(0.5, 9)).toBeLessThanOrEqual(1);
    expect(smoothLevel(0.5, -9)).toBeGreaterThanOrEqual(0);
  });
});

describe("finding beats", () => {
  const feed = (levels: number[], gapMs = 100) => {
    let state: BeatState = EMPTY_BEAT;
    const beats: number[] = [];
    levels.forEach((l, i) => {
      const r = stepBeat(state, l, i * gapMs);
      state = r.state;
      if (r.beat) beats.push(i);
    });
    return beats;
  };

  it("fires on a sudden rise above the recent level, not on a steady loud passage or on silence", () => {
    expect(feed([...Array(12).fill(0.2), 0.7])).toEqual([12]);
    expect(feed(Array(30).fill(0.8))).toEqual([]);
    expect(feed(Array(30).fill(0))).toEqual([]);
  });

  it("waits for some history before it believes anything", () => {
    expect(feed([0.1, 0.9, 0.1])).toEqual([]);
  });

  it("does not fire twice within the minimum gap, but does again after it", () => {
    const steady = Array(10).fill(0.2);
    expect(feed([...steady, 0.8, 0.2, 0.8], 50)).toEqual([10]); // 100 ms apart: too soon
    expect(BEAT_MIN_GAP_MS).toBeGreaterThan(100);
    expect(feed([...steady, 0.8, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.8], 100)).toEqual([10, 17]);
  });
});

describe("the ribbons", () => {
  it("stay inside the -1..1 box, however loud and whatever the time", () => {
    for (const ribbon of [0, 1, 2]) for (const amount of [0, 0.5, 1, 7]) for (const t of [0, 3.3, 120.5]) for (let i = 0; i <= 20; i++) {
      const [x, y] = ribbonPoint(i / 20, t, ribbon, amount);
      expect(Math.abs(x)).toBeLessThanOrEqual(1);
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
    }
  });

  it("close into a loop, swell with the loudness, and differ from one ribbon to the next", () => {
    const [x0, y0] = ribbonPoint(0, 5, 0, 0.5);
    const [x1, y1] = ribbonPoint(1, 5, 0, 0.5);
    expect(x1).toBeCloseTo(x0, 6);
    expect(y1).toBeCloseTo(y0, 6);
    const size = (amount: number) => Math.max(...Array.from({ length: 50 }, (_, i) => Math.hypot(...ribbonPoint(i / 50, 2, 1, amount))));
    expect(size(1)).toBeGreaterThan(size(0.1) * 1.5);
    expect(ribbonPoint(0.3, 1, 0, 0.5)).not.toEqual(ribbonPoint(0.3, 1, 1, 0.5));
  });

  it("are deterministic: the same moment draws the same picture", () => {
    expect(ribbonPoint(0.37, 12.5, 2, 0.6)).toEqual(ribbonPoint(0.37, 12.5, 2, 0.6));
  });

  it("rotate a point round the centre without changing its distance from it", () => {
    const [x, y] = rotatePoint([0.6, 0.2], (2 * Math.PI) / 3);
    expect(Math.hypot(x, y)).toBeCloseTo(Math.hypot(0.6, 0.2), 9);
    const full = rotatePoint([0.6, 0.2], 2 * Math.PI);
    expect(full[0]).toBeCloseTo(0.6, 9);
    expect(full[1]).toBeCloseTo(0.2, 9);
  });
});

describe("the spokes", () => {
  it("are all 0-1, silent when it is silent, and louder bands sit lower in the range", () => {
    const quiet = bandLevels(0, 3, 36);
    expect(quiet.every((v) => v === 0)).toBe(true);
    const loud = bandLevels(1, 3, 36);
    expect(loud.length).toBe(36);
    expect(loud.every((v) => v >= 0 && v <= 1)).toBe(true);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    let lowSum = 0, highSum = 0;
    for (let t = 0; t < 20; t += 0.7) {
      const b = bandLevels(1, t, 36);
      lowSum += avg(b.slice(0, 12));
      highSum += avg(b.slice(24));
    }
    expect(lowSum).toBeGreaterThan(highSum);
  });
});

describe("the beat rings", () => {
  it("are born on a beat, fade out, and are capped", () => {
    let rings = stepRings([], 0, { strength: 0.8 });
    expect(rings).toHaveLength(1);
    expect(stepRings(rings, RING_LIFE_MS - 1, null)).toHaveLength(1);
    expect(stepRings(rings, RING_LIFE_MS, null)).toHaveLength(0);
    rings = [];
    for (let i = 0; i < 20; i++) rings = stepRings(rings, i, { strength: 1 });
    expect(rings.length).toBeLessThanOrEqual(MAX_RINGS);
  });

  it("grow outwards and fade to nothing", () => {
    const ring = { bornMs: 0, strength: 1 };
    const early = ringShape(ring, 0);
    const late = ringShape(ring, RING_LIFE_MS * 0.9);
    expect(late.radius).toBeGreaterThan(early.radius);
    expect(late.alpha).toBeLessThan(early.alpha);
    expect(ringShape(ring, RING_LIFE_MS).alpha).toBe(0);
  });

  it("keep the figure inside its panel", () => {
    expect(figureRadius(400, 800)).toBeLessThanOrEqual(200);
    expect(figureRadius(1000, 300)).toBeLessThanOrEqual(150);
    expect(figureRadius(0, 0)).toBe(0);
  });
});

describe("the visualizer is only ever a background: nothing is painted over words or images", () => {
  it("the particle canvas fills its container at the back instead of covering the page", () => {
    const src = read("components/HolidayParticles.tsx");
    expect(src).toMatch(/className="pointer-events-none absolute inset-0 -z-10 h-full w-full"/);
    expect(src).not.toMatch(/fixed inset-0/);
    expect(src).not.toMatch(/z-\[5\]/);
  });

  it("the visualizer canvas sits at the back of the Now Playing panel and takes no clicks", () => {
    const src = read("components/AudioVisualizer.tsx");
    expect(src).toMatch(/pointer-events-none absolute inset-0 -z-10/);
    expect(src).not.toMatch(/\bfixed\b/);
    expect(src).not.toMatch(/(?<!-)\bz-\[?\d+/); // no positive stacking level (only the negative -z-10)
  });

  it("the page-wide wave is Spooky Music's own: it renders nothing for any other look, and the visualizer is not in the app shell", () => {
    const layout = read("app/(app)/layout.tsx");
    expect(layout).not.toMatch(/AudioVisualizer/);
    expect(read("components/MusicWaveBackground.tsx")).toMatch(/if \(!spooky\) return null;/);
    const holiday = read("components/HolidayLayer.tsx");
    expect(holiday).not.toMatch(/HolidayParticles/);
    expect(holiday).not.toMatch(/--wave-bar/);
  });

  it("the visualizer takes the deck meter as it is (no second gain) and keeps a frame limiter with slack", () => {
    const src = read("components/AudioVisualizer.tsx");
    expect(src).not.toMatch(/LEVEL_GAIN/);
    expect(src).toMatch(/1000 \/ FPS - FRAME_SLACK_MS/);
    expect(src).toMatch(/addEventListener\("change"/); // follows the reduced-motion setting live
  });

  it("the theme particles run only while the Now Playing panel is open", () => {
    expect(read("components/ThemeParticleLayer.tsx")).toMatch(/open && theme/);
    expect(read("components/NowPlayingView.tsx")).toMatch(/<ThemeParticleLayer open=\{expanded\} \/>/);
  });

  it("the Now Playing panel mounts the visualizer and the theme particles as background layers, and no emoji sit over the artwork", () => {
    const src = read("components/NowPlayingView.tsx");
    expect(src).toMatch(/<ThemeParticleLayer open=\{expanded\} \/>/);
    expect(src).toMatch(/<AudioVisualizer active=\{expanded && isPlaying/);
    expect(src).toMatch(/pointer-events-none absolute inset-0 -z-10 bg-background\/35/); // the readability scrim sits with the other background layers
    // the spooky emoji live in a -z-10 layer of the panel, not inside the artwork box
    const artworkBox = src.slice(src.indexOf('<div className="relative w-[min(100%,20rem,34dvh)] aspect-square">'));
    const artworkClose = artworkBox.slice(0, artworkBox.indexOf("</div>") + 6);
    expect(artworkClose).not.toMatch(/spooky-particle/);
  });
});
