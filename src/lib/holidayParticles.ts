// The motion of a holiday theme's particles, kept out of the component so it can be tested: how many to draw (none when the system asks for reduced
// motion, fewer on a weak device), where each starts, and how it moves each frame. The component (components/HolidayParticles.tsx) only draws them.
import type { ParticleMotion } from "@/lib/holidayThemes";

/** Particles on screen at once: a light effect, well under what a phone can draw without noticing. */
export const PARTICLES_NORMAL = 18;
export const PARTICLES_LOW_END = 8;
/** The effect is drawn at most this many times a second. */
export const PARTICLE_FPS = 30;

/** How many particles to run: none when reduced motion is on, fewer on a weak device (few cores or little memory). */
export function particleBudget(args: { reduceMotion: boolean; cores?: number | null; memoryGb?: number | null }): number {
  if (args.reduceMotion) return 0;
  const weak = (args.cores != null && args.cores <= 4) || (args.memoryGb != null && args.memoryGb <= 4);
  return weak ? PARTICLES_LOW_END : PARTICLES_NORMAL;
}

export interface Particle {
  x: number;
  y: number;
  /** Pixels per second. */
  vx: number;
  vy: number;
  size: number;
  /** Radians, for the shapes that turn. */
  angle: number;
  spin: number;
  /** Index into the theme's colours. */
  color: number;
  /** Seconds lived and seconds it lives (burst particles fade out over this; others only use it to start staggered). */
  age: number;
  life: number;
  /** Where a burst started. */
  originX: number;
  originY: number;
}

/** `rand` is injectable so the tests are not random. */
export function createParticle(motion: ParticleMotion, width: number, height: number, colors: number, rand: () => number = Math.random, staggered = true): Particle {
  const size = 6 + rand() * 8;
  const base = { size, angle: rand() * Math.PI * 2, spin: (rand() - 0.5) * 1.6, color: Math.floor(rand() * colors), age: 0, life: 1.6 + rand() * 1.2, originX: 0, originY: 0 };
  switch (motion) {
    case "fall": {
      const y = staggered ? rand() * height : -size;
      return { ...base, x: rand() * width, y, vx: (rand() - 0.5) * 24, vy: 22 + rand() * 30 };
    }
    case "rise": {
      const y = staggered ? rand() * height : height + size;
      return { ...base, x: rand() * width, y, vx: (rand() - 0.5) * 18, vy: -(20 + rand() * 28) };
    }
    case "drift":
      return { ...base, x: rand() * width, y: rand() * height, vx: (rand() - 0.5) * 20, vy: (rand() - 0.5) * 20 };
    case "burst": {
      const x = width * (0.15 + rand() * 0.7);
      const y = height * (0.1 + rand() * 0.5);
      const speed = 40 + rand() * 60;
      return { ...base, size: 2 + rand() * 2, x, y, originX: x, originY: y, vx: Math.cos(base.angle) * speed, vy: Math.sin(base.angle) * speed, age: staggered ? rand() * base.life : 0 };
    }
  }
}

/** Moves a particle on by `dt` seconds. One that has left the screen (or, for a burst, run its life) starts again at its beginning, so the count stays the same. */
export function stepParticle(p: Particle, dt: number, motion: ParticleMotion, width: number, height: number, colors: number, rand: () => number = Math.random): Particle {
  const next: Particle = { ...p, x: p.x + p.vx * dt, y: p.y + p.vy * dt, angle: p.angle + p.spin * dt, age: p.age + dt };
  if (motion === "burst") {
    return next.age >= next.life ? createParticle(motion, width, height, colors, rand, false) : next;
  }
  if (motion === "drift") {
    // bounce softly off the edges so they stay in view
    if (next.x < 0 || next.x > width) next.vx = -next.vx;
    if (next.y < 0 || next.y > height) next.vy = -next.vy;
    return next;
  }
  const gone = motion === "fall" ? next.y > height + next.size : next.y < -next.size;
  return gone ? createParticle(motion, width, height, colors, rand, false) : next;
}

/** How visible a burst particle is: full at first, gone by the end of its life. Other motions stay at a gentle constant. */
export function particleAlpha(p: Particle, motion: ParticleMotion): number {
  if (motion === "burst") return Math.max(0, 1 - p.age / p.life);
  return 0.55;
}
