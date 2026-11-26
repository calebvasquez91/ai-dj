/**
 * The energy plan for a curated playlist: a rough 0-1 energy for each track, a target curve for the arc the request wants
 * (build, steady, peak, wind-down, wave), and an ordering that follows the curve, preferring a small tempo jump between
 * neighbours. Local arithmetic only; the model never touches this. Pure.
 *
 * A track's energy comes from what is known about it: the loudness of its waveform (compared with the other candidates, so
 * "loud" means loud for this library), its tempo, and failing both, a prior for its genre. The numbers are a plain heuristic,
 * not a measurement.
 */
import { bestTempoRatio } from "@/lib/tempoRatio";
import { genreFlowDistance } from "@/lib/genreTransitions";
import { camelotCompatibility } from "@/lib/camelot";
import type { EnergyArc } from "@/lib/curate/profiles";

/** What is known about a track for energy purposes. */
export interface EnergyInput {
  id: string;
  /** Mean waveform level 0-1 (lib/track-sequencing.ts's meanEnergy), or null. */
  loudness: number | null;
  bpm: number | null;
  /** The track's best genre, for the prior. */
  genre?: string;
}

/** A rough energy for a genre with nothing else to go on. */
const GENRE_PRIOR: Readonly<Record<string, number>> = {
  Metal: 0.9, Punk: 0.85, Electronic: 0.75, "Hip-Hop": 0.7, Latin: 0.7, Rock: 0.7, Disco: 0.7, Funk: 0.7, Afrobeats: 0.7, "Reggae/Dancehall": 0.65, Pop: 0.65, "R&B": 0.5, Soul: 0.5,
  Country: 0.5, Alternative: 0.6, World: 0.55, Gospel: 0.5, Blues: 0.4, Folk: 0.35, Jazz: 0.35, Soundtrack: 0.4, Holiday: 0.5, "Children's": 0.5, "Easy Listening": 0.2, Classical: 0.25, "Spoken Word": 0.1,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Tempo as an energy: 70 BPM is slow, 180 is fast. */
const bpmEnergy = (bpm: number) => clamp01((bpm - 70) / 110);

/** 0-1 energy for each input: loudness by rank among the inputs, blended with tempo; the genre prior (or 0.5) when neither is known. */
export function estimateEnergies(inputs: readonly EnergyInput[]): Map<string, number> {
  const loud = inputs.filter((i) => i.loudness != null && i.loudness > 0).map((i) => i.loudness as number).sort((a, b) => a - b);
  const rank = (v: number) => {
    if (loud.length < 2) return 0.5;
    let below = 0;
    for (const x of loud) if (x < v) below++;
    return below / (loud.length - 1);
  };
  const out = new Map<string, number>();
  for (const i of inputs) {
    const hasLoud = i.loudness != null && i.loudness > 0;
    const hasBpm = i.bpm != null && i.bpm > 0;
    let energy: number;
    if (hasLoud && hasBpm) energy = 0.6 * rank(i.loudness as number) + 0.4 * bpmEnergy(i.bpm as number);
    else if (hasLoud) energy = rank(i.loudness as number);
    else if (hasBpm) energy = bpmEnergy(i.bpm as number);
    else energy = (i.genre && GENRE_PRIOR[i.genre]) || 0.5;
    out.set(i.id, clamp01(energy));
  }
  return out;
}

/** The energy the playlist should have at each of `n` positions for the arc. */
export function arcTargets(arc: EnergyArc, n: number): number[] {
  if (n <= 0) return [];
  const at = (i: number) => (n === 1 ? 0.5 : i / (n - 1));
  return Array.from({ length: n }, (_, i) => {
    const t = at(i);
    switch (arc) {
      case "build":
        return 0.3 + 0.65 * t;
      case "steady":
        return 0.6;
      case "peak":
        return 0.4 + 0.55 * Math.sin(Math.PI * t) ** 1.2 + 0.05 * (1 - t);
      case "wind-down":
        return 0.9 - 0.65 * t;
      case "wave":
        return 0.55 + 0.3 * Math.sin(2.5 * 2 * Math.PI * t * 0.5 + Math.PI / 6);
    }
  }).map(clamp01);
}

export interface OrderInput {
  id: string;
  energy: number;
  bpm: number | null;
  /** The track's top-level genre label; only read when a genre weight is passed to orderByEnergyArc. */
  genre?: string | null;
  /** The track's Camelot code ("8A"); only read when a key weight is passed to orderByEnergyArc. */
  camelot?: string | null;
}

/** How much a tempo jump between neighbours counts against a track next to its energy miss. */
const TEMPO_WEIGHT = 0.12;

/**
 * The key weight the curator passes to orderByEnergyArc: how much a key clash between neighbours counts against a track next to its energy miss, smaller than a
 * tempo jump so the energy arc still comes first. Both the uploaded-song playlists and the song-list suggestions use it.
 */
export const ARC_KEY_WEIGHT = 0.08;

/**
 * What two neighbours' keys cost, in units of the key weight: a clash 1, the same key -0.5 and a relative or adjacent key -0.25 (a reward, so two songs whose keys fit are
 * kept together rather than split up by an unkeyed song, which would also avoid a clash), and 0 when either key is unknown (nothing to prefer).
 */
function keyJump(a: OrderInput | undefined, b: OrderInput | undefined): number {
  if (!a?.camelot || !b?.camelot) return 0;
  const fit = camelotCompatibility(a.camelot, b.camelot);
  return fit === 0 ? 1 : -fit / 4;
}

function tempoJump(a: OrderInput | undefined, b: OrderInput | undefined): number {
  if (!a?.bpm || !b?.bpm) return 0;
  return Math.min(1, Math.abs(bestTempoRatio(a.bpm, b.bpm) - 1) / 0.3);
}

function planCost(order: readonly OrderInput[], targets: readonly number[], genreWeight: number, keyWeight: number): number {
  let cost = 0;
  for (let i = 0; i < order.length; i++) {
    cost += Math.abs(order[i].energy - targets[i]);
    if (i > 0) {
      cost += TEMPO_WEIGHT * tempoJump(order[i - 1], order[i]);
      if (genreWeight > 0) cost += genreWeight * genreFlowDistance(order[i - 1].genre, order[i].genre);
      if (keyWeight > 0) cost += keyWeight * keyJump(order[i - 1], order[i]);
    }
  }
  return cost;
}

/**
 * Puts the tracks in the order that follows the arc. First the best match for the energy alone: with the tracks sorted by
 * energy and the positions sorted by target, pairing them rank for rank minimises the total miss (so a build really ends on
 * the loudest tracks, which a position-by-position pick would have used up early). Then a few passes of swapping nearby
 * tracks where that smooths the tempo (octave-aware, so 70 -> 140 is no jump) for little energy cost. O(n^2) at worst:
 * playlists are tens of tracks. A non-zero `seed` shuffles near-equal energies so "Regenerate" can give another order. A non-zero `genreWeight`
 * (genre-aware transitions on) adds a small cost for a genre jump between neighbours, so same-genre songs cluster when the energy scores are close.
 * A non-zero `keyWeight` adds a second phase for Camelot keys (a clash between neighbours costs `keyWeight`; the same key earns half of it back and a relative or adjacent
 * key a quarter; nothing when either key is unknown): after the order above is made, extra swaps are kept where they lower the key cost and the whole plan cost, and,
 * on a build or wind-down arc, add no step the wrong way. So the key never undoes the energy line, and with no key known, or with 0 for the key weight (the default),
 * the order is exactly what it was.
 */
export function orderByEnergyArc(items: readonly OrderInput[], arc: EnergyArc, seed = 0, genreWeight = 0, keyWeight = 0): OrderInput[] {
  const n = items.length;
  const targets = arcTargets(arc, n);
  let rng = seed >>> 0;
  const jitter = () => {
    if (seed === 0) return 0;
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return (rng / 0xffffffff) * 0.06;
  };
  const byEnergy = items.map((item, index) => ({ item, key: item.energy + jitter(), index })).sort((x, y) => x.key - y.key || x.index - y.index);
  const positionsByTarget = targets.map((t, position) => ({ position, t })).sort((x, y) => x.t - y.t || x.position - y.position);
  const order: OrderInput[] = new Array<OrderInput>(n);
  positionsByTarget.forEach(({ position }, rank) => {
    order[position] = byEnergy[rank].item;
  });
  // Phase 1: the order without any key: exactly the order this function has always made (energy, tempo and, when asked, genre).
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < Math.min(n, i + 4); j++) {
        const before = planCost(order, targets, genreWeight, 0);
        [order[i], order[j]] = [order[j], order[i]];
        if (planCost(order, targets, genreWeight, 0) < before - 1e-9) improved = true;
        else [order[i], order[j]] = [order[j], order[i]];
      }
    }
    if (!improved) break;
  }
  // Phase 2: only when keys count. Extra swaps that the key made worthwhile: the key cost must fall and the whole plan cost (with the key) must fall, and on a rising (build)
  // or falling (wind-down) arc the swap must not add a step the wrong way. So the key can only move songs whose energy and tempo cost allows it, never undo the energy line,
  // and with no key known nothing happens here at all.
  if (keyWeight > 0) {
    const monotone = arc === "build" || arc === "wind-down";
    const dips = () => {
      let count = 0;
      for (let k = 1; k < n; k++) if (arc === "build" ? order[k].energy < order[k - 1].energy - 1e-9 : order[k].energy > order[k - 1].energy + 1e-9) count++;
      return count;
    };
    const keyCost = () => {
      let cost = 0;
      for (let k = 1; k < n; k++) cost += keyJump(order[k - 1], order[k]);
      return cost;
    };
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < Math.min(n, i + 4); j++) {
          const totalBefore = planCost(order, targets, genreWeight, keyWeight);
          const keyBefore = keyCost();
          const dipsBefore = monotone ? dips() : 0;
          [order[i], order[j]] = [order[j], order[i]];
          const keep = keyCost() < keyBefore - 1e-9 && planCost(order, targets, genreWeight, keyWeight) < totalBefore - 1e-9 && (!monotone || dips() <= dipsBefore);
          if (keep) improved = true;
          else [order[i], order[j]] = [order[j], order[i]];
        }
      }
      if (!improved) break;
    }
  }
  return order;
}

/** How far a played order is from the arc, 0 (on it) to 1: for tests and for telling the person how well it fit. */
export function arcFit(energies: readonly number[], arc: EnergyArc): number {
  if (energies.length === 0) return 0;
  const targets = arcTargets(arc, energies.length);
  return energies.reduce((sum, e, i) => sum + Math.abs(e - targets[i]), 0) / energies.length;
}
