/**
 * Event profiles for AI playlist curation: what kind of occasion a request is for, and so how its energy should move and
 * which tempo range fits. This app has DJ set modes (club, wedding, party, chill, open-format: lib/mix-engine.ts's DjSetMode)
 * that shape the transitions; a profile maps a request onto one of them and adds the energy arc and tempo window the playlist
 * itself needs. Pure.
 */
import type { DjSetMode } from "@/lib/mix-engine";

export type EnergyArc = "build" | "steady" | "peak" | "wind-down" | "wave";
export const ENERGY_ARCS: readonly EnergyArc[] = ["build", "steady", "peak", "wind-down", "wave"];

export type ProfileId = "workout" | "dinner" | "party" | "wedding" | "club" | "chill" | "focus" | "road-trip" | "open";

export interface EventProfile {
  id: ProfileId;
  label: string;
  djMode: DjSetMode;
  energyArc: EnergyArc;
  /** A tempo window that suits it (soft: it ranks tracks, it does not exclude them unless the request asks for a tempo). */
  bpmRange?: { min: number; max: number };
  /** Words in a request that pick this profile. */
  keywords: string[];
}

export const PROFILES: Readonly<Record<ProfileId, EventProfile>> = {
  workout: { id: "workout", label: "Workout", djMode: "party", energyArc: "build", bpmRange: { min: 110, max: 175 }, keywords: ["workout", "work out", "gym", "exercise", "running", "run", "cardio", "training", "lifting", "fitness"] },
  dinner: { id: "dinner", label: "Dinner party", djMode: "chill", energyArc: "steady", bpmRange: { min: 60, max: 115 }, keywords: ["dinner", "dinner party", "cocktail", "cocktails", "brunch", "dining"] },
  party: { id: "party", label: "Party", djMode: "party", energyArc: "peak", bpmRange: { min: 100, max: 135 }, keywords: ["party", "house party", "pregame", "pre game", "bbq", "cookout", "birthday"] },
  wedding: { id: "wedding", label: "Wedding", djMode: "wedding", energyArc: "wave", keywords: ["wedding", "reception"] },
  club: { id: "club", label: "Club night", djMode: "club", energyArc: "build", bpmRange: { min: 118, max: 140 }, keywords: ["club", "clubbing", "dance floor", "dancefloor", "rave"] },
  chill: { id: "chill", label: "Chill", djMode: "chill", energyArc: "wind-down", bpmRange: { min: 55, max: 110 }, keywords: ["chill", "relax", "relaxing", "mellow", "unwind", "late night", "late-night", "sleep", "wind down"] },
  focus: { id: "focus", label: "Focus", djMode: "chill", energyArc: "steady", bpmRange: { min: 60, max: 120 }, keywords: ["study", "studying", "focus", "work", "working", "reading", "concentrate"] },
  "road-trip": { id: "road-trip", label: "Road trip", djMode: "open-format", energyArc: "wave", keywords: ["road trip", "roadtrip", "drive", "driving", "commute", "car"] },
  open: { id: "open", label: "Anything goes", djMode: "open-format", energyArc: "wave", keywords: [] },
};

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === "string" && value in PROFILES;
}

export function isEnergyArc(value: unknown): value is EnergyArc {
  return typeof value === "string" && (ENERGY_ARCS as readonly string[]).includes(value);
}

function firstProfileIn(text: string): ProfileId | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9 -]+/g, " ").replace(/\s+/g, " ")} `;
  let best: { id: ProfileId; at: number } | null = null;
  for (const profile of Object.values(PROFILES)) {
    for (const k of [...profile.keywords].sort((a, b) => b.length - a.length)) {
      const at = lower.indexOf(` ${k} `);
      if (at >= 0 && (!best || at < best.at)) best = { id: profile.id, at };
    }
  }
  return best?.id ?? null;
}

/**
 * The occasion a request is for. What follows "for a ..." names it ("late-night chill house for a dinner party" is a dinner
 * party, not a chill night); without one, the occasion word named earliest. Null when the words point at none.
 */
export function profileFromText(text: string): ProfileId | null {
  const forPhrase = /\bfor\s+(?:a|an|the|my|our|some)?\s*(.+)$/i.exec(text);
  return (forPhrase ? firstProfileIn(forPhrase[1]) : null) ?? firstProfileIn(text);
}
