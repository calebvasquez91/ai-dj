import { describe, expect, it } from "vitest";
import { createParticle, particleAlpha, particleBudget, PARTICLES_LOW_END, PARTICLES_NORMAL, stepParticle } from "./holidayParticles";

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("particleBudget", () => {
  it("turns the particles off when the system asks for reduced motion", () => {
    expect(particleBudget({ reduceMotion: true })).toBe(0);
    expect(particleBudget({ reduceMotion: true, cores: 16, memoryGb: 32 })).toBe(0);
  });
  it("runs a light effect normally and an even lighter one on a weak device", () => {
    expect(particleBudget({ reduceMotion: false, cores: 8, memoryGb: 8 })).toBe(PARTICLES_NORMAL);
    expect(particleBudget({ reduceMotion: false })).toBe(PARTICLES_NORMAL);
    expect(particleBudget({ reduceMotion: false, cores: 4 })).toBe(PARTICLES_LOW_END);
    expect(particleBudget({ reduceMotion: false, memoryGb: 2 })).toBe(PARTICLES_LOW_END);
    expect(PARTICLES_LOW_END).toBeLessThan(PARTICLES_NORMAL);
    expect(PARTICLES_NORMAL).toBeLessThanOrEqual(24);
  });
});

describe("createParticle", () => {
  it("falling ones start above the screen and move down; rising ones start below and move up", () => {
    const fall = createParticle("fall", 400, 300, 3, seq(0.5), false);
    expect(fall.y).toBeLessThan(0);
    expect(fall.vy).toBeGreaterThan(0);
    const rise = createParticle("rise", 400, 300, 3, seq(0.5), false);
    expect(rise.y).toBeGreaterThan(300);
    expect(rise.vy).toBeLessThan(0);
  });
  it("are spread over the screen to begin with when staggered", () => {
    const p = createParticle("fall", 400, 300, 3, seq(0.5), true);
    expect(p.y).toBeCloseTo(150);
  });
  it("picks one of the theme's colours", () => {
    for (let i = 0; i < 20; i++) expect(createParticle("drift", 100, 100, 3, Math.random).color).toBeLessThan(3);
  });
  it("starts a burst from one point, spreading out", () => {
    const p = createParticle("burst", 400, 300, 3, seq(0.5), false);
    expect([p.x, p.y]).toEqual([p.originX, p.originY]);
    expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(0);
  });
});

describe("stepParticle", () => {
  it("moves a particle by its speed", () => {
    const p = { ...createParticle("fall", 400, 300, 3, seq(0.5), true), x: 100, y: 100, vx: 10, vy: 20 };
    const next = stepParticle(p, 0.5, "fall", 400, 300, 3);
    expect(next.x).toBeCloseTo(105);
    expect(next.y).toBeCloseTo(110);
  });
  it("sends a fallen one back to the top, so the count never changes", () => {
    const p = { ...createParticle("fall", 400, 300, 3, seq(0.5), true), y: 400, vy: 30 };
    expect(stepParticle(p, 0.1, "fall", 400, 300, 3, seq(0.5)).y).toBeLessThan(0);
  });
  it("sends a risen one back to the bottom", () => {
    const p = { ...createParticle("rise", 400, 300, 3, seq(0.5), true), y: -50, vy: -30 };
    expect(stepParticle(p, 0.1, "rise", 400, 300, 3, seq(0.5)).y).toBeGreaterThan(300);
  });
  it("starts a burst again when its life is up, and fades it out meanwhile", () => {
    const p = createParticle("burst", 400, 300, 3, seq(0.5), false);
    expect(particleAlpha(p, "burst")).toBe(1);
    const old = stepParticle(p, p.life / 2, "burst", 400, 300, 3);
    expect(particleAlpha(old, "burst")).toBeCloseTo(0.5);
    expect(stepParticle(p, p.life + 0.1, "burst", 400, 300, 3, seq(0.5)).age).toBe(0);
  });
  it("keeps drifting ones on screen by turning them round at the edge", () => {
    const p = { ...createParticle("drift", 100, 100, 3, seq(0.5), true), x: 99, y: 50, vx: 20, vy: 0 };
    expect(stepParticle(p, 0.2, "drift", 100, 100, 3).vx).toBeLessThan(0);
  });
});

describe("particleAlpha", () => {
  it("is a gentle constant for everything but a burst", () => {
    expect(particleAlpha(createParticle("fall", 10, 10, 1), "fall")).toBeLessThan(1);
  });
});
