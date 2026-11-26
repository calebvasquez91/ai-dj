/**
 * Choosing the tracks for a curated playlist, entirely on local data: which library tracks fit a CurationSpec, how well, and
 * how many of them make the length asked for. No model is involved here; this is filtering and arithmetic, so the same
 * library and the same request always give the same candidates (a `seed` only breaks near-ties, for "Regenerate").
 *
 * A track is a candidate only if it matches what the request insists on: the genre (or subgenre) when one was named, the
 * era when one was named (a track with a known year outside it is out; an unknown year is allowed, with a lower score and
 * counted so the preview can say so), and a tempo window when one was named. Moods and an occasion's tempo are preferences,
 * not requirements. When there are too few candidates the answer is a shortfall with what relaxing each condition would
 * add: the playlist is never padded with tracks of the wrong genre.
 */
import { GENRES } from "@/lib/genres";
import { genresOfTrack } from "@/lib/genreLibrary";
import { bestTempoRatio } from "@/lib/tempoRatio";
import { eligibleTracks, explicitStatusOf, type EligibleResult } from "@/lib/curate/eligibility";
import { DEFAULT_TARGET_MINUTES, type CurationSpec } from "@/lib/curate/spec";
import { PROFILES, type EventProfile } from "@/lib/curate/profiles";
import { moodEnergyTarget, proxyEnergy } from "@/lib/curate/moodEnergy";
import type { Track } from "@/types/music";

/** A track below this combined score is not a match. */
export const MIN_MATCH_SCORE = 0.3;
const MAX_CANDIDATES = 300;
/** A shortfall is reported when the matching tracks cover less than this share of the length asked for. */
export const SHORTFALL_RATIO = 0.9;

const WEIGHTS = { genre: 0.5, mood: 0.2, era: 0.15, bpm: 0.15, energy: 0.2 } as const;
/** How far (0-1) a song's rough energy may be from what the request's moods ask for before it counts as no fit at all. */
const ENERGY_FIT_SPAN = 0.5;

export interface TrackFacts {
  bpm: number | null;
}

export interface ScoredTrack {
  track: Track;
  score: number;
  bpm: number | null;
  yearUnknown: boolean;
}

/** Whether the request is for Halloween music (so Halloween tracks may be used). A request for "holiday" music in general is not: Halloween stays in Spooky Music. */
export function wantsHalloween(spec: CurationSpec): boolean {
  return spec.subgenres.includes("Halloween");
}

export function profileOf(spec: CurationSpec): EventProfile | null {
  return spec.profile ? PROFILES[spec.profile] : null;
}

/** Whether `bpm` is in the window, counting a half or double tempo as in it (a 70 BPM song feels like 140). */
function bpmFit(bpm: number, range: { min: number; max: number }): number {
  const candidates = [bpm, bpm * 2, bpm / 2];
  if (candidates.some((b) => b >= range.min && b <= range.max)) return 1;
  const edge = bpm < range.min ? range.min : range.max;
  const off = Math.abs(bestTempoRatio(bpm, edge) - 1);
  return off <= 0.08 ? 0.5 : off <= 0.2 ? 0.2 : 0;
}

/**
 * How well a track's genres fit what the spec names, 0 (not at all) to 1. A genre named on its own takes in the whole genre; a
 * subgenre named narrows its parent: "hip hop" with "trap" wants trap, not every Hip-Hop track (a model's reading of "trap
 * bangers" names both levels). A parent genre with none of its subgenres named stays wide. Search uses the same rule.
 */
export function genreFit(track: Pick<Track, "genreTags" | "genre" | "subgenres">, spec: CurationSpec): number {
  let best = 0;
  for (const g of genresOfTrack(track)) {
    const subMatches = g.subgenres.filter((s) => spec.subgenres.includes(s.subgenre));
    const narrowed = GENRES.find((x) => x.label === g.genre)?.subgenres.some((s) => spec.subgenres.includes(s.label)) ?? false;
    const wanted = subMatches.length > 0 || (spec.genres.includes(g.genre) && !narrowed);
    if (!wanted) continue;
    best = Math.max(best, Math.min(1, g.confidence + (subMatches.length > 0 ? 0.1 : 0)));
  }
  return best;
}

/** The score of one track for a spec, or null when it fails something the request insists on. */
export function scoreTrack(track: Track, bpm: number | null, spec: CurationSpec, options: { useEnergy?: boolean } = {}): { score: number; yearUnknown: boolean } | null {
  const profile = profileOf(spec);
  const parts: { weight: number; value: number }[] = [];
  let yearUnknown = false;
  // Whether this song's tempo already counted (a tempo the request named, or the occasion's tempo window): the energy fit then leaves the tempo out and goes by genre, so
  // the tempo is not counted twice.
  let tempoScored = false;

  const wantsGenre = spec.genres.length > 0 || spec.subgenres.length > 0;
  if (wantsGenre) {
    const best = genreFit(track, spec);
    if (best === 0) return null;
    parts.push({ weight: WEIGHTS.genre, value: best });
  }

  if (spec.moods.length > 0) {
    const have = track.moods ?? [];
    const value = have.length === 0 ? 0.3 : spec.moods.filter((m) => have.includes(m)).length / spec.moods.length;
    parts.push({ weight: WEIGHTS.mood, value });
  }

  if (spec.eraRange) {
    if (track.year == null) {
      yearUnknown = true;
      parts.push({ weight: WEIGHTS.era, value: 0.35 });
    } else if (track.year >= spec.eraRange.from && track.year <= spec.eraRange.to) {
      parts.push({ weight: WEIGHTS.era, value: 1 });
    } else if (track.year >= spec.eraRange.from - 2 && track.year <= spec.eraRange.to + 2) {
      parts.push({ weight: WEIGHTS.era, value: 0.4 });
    } else {
      return null;
    }
  }

  if (spec.bpmRange) {
    if (bpm == null) parts.push({ weight: WEIGHTS.bpm, value: 0.35 });
    else {
      const fit = bpmFit(bpm, spec.bpmRange);
      if (fit === 0) return null;
      parts.push({ weight: WEIGHTS.bpm, value: fit });
      tempoScored = true;
    }
  } else if (profile?.bpmRange) {
    parts.push({ weight: WEIGHTS.bpm, value: bpm == null ? 0.5 : bpmFit(bpm, profile.bpmRange) });
    if (bpm != null) tempoScored = true;
  }

  // A mood that implies an energy (pump up: high, rainy day: low) prefers songs whose rough energy fits: from the tempo when it is known, else the genre. A song with neither is
  // neutral, not marked down. (The song-list suggestions turn this off: they have the list's own energy and apply it themselves.)
  const energyTarget = options.useEnergy === false ? null : moodEnergyTarget(spec.moods);
  if (energyTarget != null) {
    const rough = proxyEnergy(tempoScored ? null : bpm, genresOfTrack(track)[0]?.genre);
    parts.push({ weight: WEIGHTS.energy, value: rough == null ? 0.5 : Math.max(0, 1 - Math.abs(rough - energyTarget) / ENERGY_FIT_SPAN) });
  }

  if (parts.length === 0) return { score: 0.5 + (track.playPreference === "must" ? 0.05 : 0), yearUnknown };
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const score = parts.reduce((s, p) => s + p.weight * p.value, 0) / total + (track.playPreference === "must" ? 0.05 : 0);
  return score >= MIN_MATCH_SCORE ? { score, yearUnknown } : null;
}

export interface Selection {
  /** The tracks chosen for the length asked for, best match first (not yet in play order). */
  chosen: ScoredTrack[];
  /** Every track that matched, best first. */
  candidates: ScoredTrack[];
  eligible: EligibleResult;
  targetSec: number;
  /** Runtime of all the candidates together. */
  availableSec: number;
  unknownYear: number;
  unknownRating: number;
}

/** A small, repeatable jitter for a track and seed, so near-equal tracks swap places between regenerations but never within one. */
function tieBreak(id: string, seed: number): number {
  if (seed === 0) return 0;
  let h = seed >>> 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h ^ id.charCodeAt(i), 16777619) + 0x9e3779b9) >>> 0;
  return (h / 0xffffffff) * 0.08;
}

export function selectTracks(spec: CurationSpec, library: readonly Track[], bpmOf: (track: Track) => number | null, seed = 0): Selection {
  const eligible = eligibleTracks(library, { explicitPolicy: spec.explicitPolicy ?? "any", allowHalloween: wantsHalloween(spec) });
  const candidates: ScoredTrack[] = [];
  for (const track of eligible.tracks) {
    const bpm = bpmOf(track);
    const scored = scoreTrack(track, bpm, spec);
    if (scored) candidates.push({ track, score: scored.score, bpm, yearUnknown: scored.yearUnknown });
  }
  candidates.sort((a, b) => b.score + tieBreak(b.track.id, seed) - (a.score + tieBreak(a.track.id, seed)) || a.track.title.localeCompare(b.track.title));
  const capped = candidates.slice(0, MAX_CANDIDATES);
  const targetSec = (spec.targetLengthMinutes ?? DEFAULT_TARGET_MINUTES) * 60;
  const chosen: ScoredTrack[] = [];
  let runtime = 0;
  for (const c of capped) {
    if (runtime >= targetSec) break;
    chosen.push(c);
    runtime += c.track.durationSec || 0;
  }
  const availableSec = capped.reduce((s, c) => s + (c.track.durationSec || 0), 0);
  return {
    chosen,
    candidates: capped,
    eligible,
    targetSec,
    availableSec,
    unknownYear: chosen.filter((c) => c.yearUnknown).length,
    unknownRating: spec.explicitPolicy === "clean-only" ? chosen.filter((c) => explicitStatusOf(c.track) === "unknown").length : 0,
  };
}

export interface Relaxation {
  what: "era" | "tempo" | "subgenre" | "mood" | "clean";
  /** How many more matching tracks dropping that condition would give. */
  gain: number;
  text: string;
}

export interface Shortfall {
  have: number;
  haveSec: number;
  wantedSec: number;
  message: string;
  relaxations: Relaxation[];
}

const minutes = (sec: number) => Math.round(sec / 60);

/**
 * Whether the library cannot fill the length asked for, and if so what to say. The message names how many tracks matched and
 * what relaxing each condition of the request would add, so the person can decide: it never suggests padding with other genres.
 */
export function shortfallOf(spec: CurationSpec, library: readonly Track[], bpmOf: (track: Track) => number | null, selection: Selection): Shortfall | null {
  if (selection.availableSec >= selection.targetSec * SHORTFALL_RATIO) return null;
  const have = selection.candidates.length;
  const tries: { what: Relaxation["what"]; spec: CurationSpec; applies: boolean; label: string }[] = [
    { what: "era", spec: { ...spec, eraRange: undefined }, applies: !!spec.eraRange, label: "the era" },
    { what: "tempo", spec: { ...spec, bpmRange: undefined }, applies: !!spec.bpmRange, label: "the tempo range" },
    { what: "subgenre", spec: { ...spec, subgenres: [] }, applies: spec.subgenres.length > 0 && spec.genres.length > 0, label: "the subgenre" },
    { what: "mood", spec: { ...spec, moods: [] }, applies: spec.moods.length > 0, label: "the mood" },
    { what: "clean", spec: { ...spec, explicitPolicy: "any" }, applies: spec.explicitPolicy === "clean-only", label: "clean-only" },
  ];
  const relaxations: Relaxation[] = [];
  for (const t of tries) {
    if (!t.applies) continue;
    const gain = selectTracks(t.spec, library, bpmOf).candidates.length - have;
    if (gain > 0) relaxations.push({ what: t.what, gain, text: `Relaxing ${t.label} would add ${gain} track${gain === 1 ? "" : "s"}.` });
  }
  relaxations.sort((a, b) => b.gain - a.gain);
  const wanted = minutes(selection.targetSec);
  const what = have === 0 ? "No tracks in your library match" : `Only ${have} matching track${have === 1 ? "" : "s"} (${minutes(selection.availableSec)} min of the ${wanted} you asked for)`;
  const hint = relaxations.length > 0 ? ` ${relaxations.map((r) => r.text).join(" ")}` : " Add more music like this to your library.";
  return { have, haveSec: selection.availableSec, wantedSec: selection.targetSec, message: `${what}.${hint}`, relaxations };
}
