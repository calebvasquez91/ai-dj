"use client";

import { useEffect, useRef } from "react";
import type { HolidayTheme, ParticleShape } from "@/lib/holidayThemes";
import { createParticle, PARTICLE_FPS, particleAlpha, particleBudget, stepParticle, type Particle } from "@/lib/holidayParticles";

/** Draws one particle's shape at the origin of the (already moved and turned) canvas. */
function drawShape(ctx: CanvasRenderingContext2D, shape: ParticleShape, size: number) {
  const r = size / 2;
  switch (shape) {
    case "snowflake":
    case "star": {
      const points = shape === "snowflake" ? 6 : 4;
      ctx.beginPath();
      for (let i = 0; i < points; i++) {
        const a = (Math.PI * 2 * i) / points;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return;
    }
    case "heart":
      ctx.beginPath();
      ctx.moveTo(0, r * 0.6);
      ctx.bezierCurveTo(-r * 1.4, -r * 0.2, -r * 0.6, -r * 1.1, 0, -r * 0.35);
      ctx.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.4, -r * 0.2, 0, r * 0.6);
      ctx.fill();
      return;
    case "confetti":
      ctx.fillRect(-r, -r / 3, size, size / 3);
      return;
    case "shamrock":
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI * 2 * i) / 3 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    case "egg":
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.7, r, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "firework":
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1.2, size / 2), 0, Math.PI * 2);
      ctx.fill();
      return;
    case "leaf":
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.55, r, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "diya":
      ctx.beginPath();
      ctx.ellipse(0, r * 0.2, r * 0.9, r * 0.45, 0, 0, Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.3, r * 0.22, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "lantern":
      ctx.beginPath();
      ctx.roundRect(-r * 0.6, -r * 0.8, r * 1.2, r * 1.6, r * 0.4);
      ctx.fill();
      return;
  }
}

/**
 * The light particle effect of a holiday theme: a few shapes falling, rising, drifting or bursting over the page, drawn on one canvas behind
 * the controls (it never takes a touch or a click). It is held to a small budget: none at all when the system asks for reduced motion, fewer
 * on a weak device, 30 frames a second at most, and it stops while the page is hidden.
 */
export function HolidayParticles({ theme }: { theme: HolidayTheme }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const motion = theme.particles.motion;
    const colors = theme.particles.colors;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const count = particleBudget({
      reduceMotion: reduce.matches,
      cores: navigator.hardwareConcurrency,
      memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    });
    if (count === 0) return; // reduced motion: no particles at all

    let width = 0;
    let height = 0;
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    let particles: Particle[] = Array.from({ length: count }, () => createParticle(motion, width, height, colors.length));
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = (now - last) / 1000;
      if (dt < 1 / PARTICLE_FPS) return; // at most 30 frames a second
      last = now;
      if (document.visibilityState !== "visible") return;
      particles = particles.map((p) => stepParticle(p, Math.min(dt, 0.1), motion, width, height, colors.length));
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = particleAlpha(p, motion);
        ctx.fillStyle = colors[p.color];
        ctx.strokeStyle = colors[p.color];
        drawShape(ctx, theme.particles.shape, p.size);
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(frame);

    // If the person turns reduced motion on while this is showing, the particles go.
    const onReduceChange = () => {
      if (reduce.matches) {
        cancelAnimationFrame(raf);
        ctx.clearRect(0, 0, width, height);
      }
    };
    reduce.addEventListener("change", onReduceChange);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      reduce.removeEventListener("change", onReduceChange);
    };
  }, [theme]);

  return <canvas ref={ref} aria-hidden="true" data-holiday-particles={theme.id} className="pointer-events-none fixed inset-0 z-[5] h-full w-full" />;
}
