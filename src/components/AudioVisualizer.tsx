"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  EMPTY_BEAT,
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
  type Ring,
  type Rgb,
} from "@/lib/visualizerMath";

const FPS = 30;
const RIBBONS = 3;
const SYMMETRY = 3;
const POINTS = 150;
const SPOKES = 36;

/** A frame is drawn when this much of the frame time has passed, less a little slack: a 60 Hz screen's frames come about 16.7 ms apart, so a strict 33.3 ms test would sometimes skip to 50 ms (20 fps). */
const FRAME_SLACK_MS = 2;

/**
 * The Now Playing visualizer: glowing ribbons that loop and weave round the centre like an iTunes visualizer, mirrored three ways, leaving fading trails, with
 * a ring that bursts out on every beat. It reacts to the real loudness of what is playing (the deck's own meter). It is a BACKGROUND layer: it fills the Now
 * Playing panel only, sits beneath every word and image in it (the panel stacks it at a negative level), and never takes a click or a touch. It draws only while the
 * panel is open and a song is playing, kept dim and with short trails so it never washes out the words above it, at 30 frames a second at most, and stops while the page is hidden. With reduced motion on it draws one still frame.
 *
 * `palette` is the theme's colours as hex: the app's accents by default, a holiday theme's lights, or Spooky Music's orange / purple / green / red.
 */
export function AudioVisualizer({ active, palette }: { active: boolean; palette: readonly string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paletteKey = palette.join(",");
  // Follows the person's reduced-motion setting live (it can change while the page is open).
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colors: Rgb[] = paletteKey.split(",").map(parseHex);

    let width = 0;
    let height = 0;
    // Resizing a canvas clears it: with reduced motion nothing redraws it, so the still frame is drawn again from here.
    let redrawStill: () => void = () => {};
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawStill();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let level = 0;
    let beatState: BeatState = EMPTY_BEAT;
    let rings: Ring[] = [];

    /** Draws the figure for one moment. `fade` is how much of the last frame is wiped (more wipes more: shorter trails). */
    const draw = (nowMs: number, drive: number, fade: number) => {
      const timeSec = nowMs / 1000;
      const cx = width / 2;
      const cy = height / 2;
      const R = figureRadius(width, height);
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // The ribbons: each drawn twice, a wide faint stroke for the glow and a thin bright one for the line.
      for (let r = 0; r < RIBBONS; r++) {
        const c = paletteLoop(colors, timeSec * 0.035 + r / RIBBONS);
        for (let k = 0; k < SYMMETRY; k++) {
          const turn = (k * Math.PI * 2) / SYMMETRY + timeSec * 0.03;
          ctx.beginPath();
          for (let i = 0; i <= POINTS; i++) {
            const p = rotatePoint(ribbonPoint(i / POINTS, timeSec, r, drive), turn);
            const x = cx + p[0] * R;
            const y = cy + p[1] * R;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.lineWidth = 4 + drive * 4;
          ctx.strokeStyle = rgba(c, 0.025 + 0.04 * drive);
          ctx.stroke();
          ctx.lineWidth = 1 + drive * 1.2;
          ctx.strokeStyle = rgba(c, 0.14 + 0.2 * drive);
          ctx.stroke();
        }
      }

      // The spokes: a ring of short rays whose lengths follow the bands.
      const bands = bandLevels(drive, timeSec, SPOKES);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < SPOKES; i++) {
        const a = (i / SPOKES) * Math.PI * 2 + timeSec * 0.05;
        const inner = R * 0.2;
        const outer = inner + bands[i] * R * 0.32;
        ctx.strokeStyle = rgba(paletteAt(colors, i / SPOKES), 0.06 + 0.16 * bands[i]);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
        ctx.stroke();
      }

      // The beat rings.
      for (const ring of rings) {
        const s = ringShape(ring, nowMs);
        ctx.strokeStyle = rgba(paletteLoop(colors, timeSec * 0.05), s.alpha * 0.55);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, R * s.radius), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    if (reduced) {
      // One still frame, no motion: a calm figure so the panel is not bare.
      if (active) {
        redrawStill = () => draw(4000, 0.4, 1);
        redrawStill();
      }
      return () => observer.disconnect();
    }
    if (!active) {
      // Not playing, or the panel is closed: nothing runs. What is on the canvas fades out with the CSS opacity, then is cleared.
      const clear = setTimeout(() => ctx.clearRect(0, 0, width, height), 800);
      return () => {
        clearTimeout(clear);
        observer.disconnect();
      };
    }

    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / FPS - FRAME_SLACK_MS) return;
      last = now;
      if (document.visibilityState !== "visible") return;
      const meters = useStore.getState().deckMeterLevel;
      // The deck meters are already lifted (DualDeckStage stores min(1, rms * 2.5)): a second gain here pinned normal music at 1 and left the beat finder a flat line.
      const raw = Math.min(1, Math.max(meters.A, meters.B));
      level = smoothLevel(level, raw);
      const stepped = stepBeat(beatState, raw, now);
      beatState = stepped.state;
      rings = stepRings(rings, now, stepped.beat ? { strength: raw } : null);
      draw(now, level, 0.3);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [active, paletteKey, reduced]);

  return <canvas ref={ref} aria-hidden="true" data-audio-visualizer="" className={`pointer-events-none absolute inset-0 -z-10 h-full w-full transition-opacity duration-700 ${active ? "opacity-80" : "opacity-0"}`} />;
}
