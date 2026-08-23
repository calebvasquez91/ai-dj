import { djs, type DjEntry } from "@/data/djs";
import { genreFamilies, techniques, type GenreFamily, type Technique } from "@/data/styles";
import { chooseTransition } from "@/lib/mix-engine";
import type { TransitionEntry } from "@/data/transitions";

export interface StyleAdvice {
  genre: GenreFamily;
  technique: Technique;
  djs: DjEntry[];
  transition: TransitionEntry;
  rationale: string;
}

function findDjsByGenre(genreId: string, count: number): DjEntry[] {
  return djs.filter((dj) => dj.genres.includes(genreId)).slice(0, count);
}

function scoreGenreMatch(genre: GenreFamily, input: string): number {
  const needle = input.toLowerCase();
  let score = 0;
  if (genre.name.toLowerCase() === needle || genre.id === needle) score += 10;
  if (genre.name.toLowerCase().includes(needle) || needle.includes(genre.name.toLowerCase())) score += 5;
  if (genre.subgenres.some((s) => s.toLowerCase() === needle)) score += 8;
  if (genre.subgenres.some((s) => s.toLowerCase().includes(needle) || needle.includes(s.toLowerCase()))) score += 3;
  score += genre.moodKeywords.filter((k) => needle.includes(k) || k.includes(needle)).length * 2;
  return score;
}

/**
 * Resolves a free-text mood/genre/occasion input to the best-matching
 * genre family. Falls back to House — the broadest, most crowd-friendly
 * default — when nothing matches well.
 */
export function resolveGenreFamily(input: string): GenreFamily {
  if (!input.trim()) {
    return genreFamilies.find((g) => g.id === "house")!;
  }
  let best = genreFamilies[0];
  let bestScore = -1;
  for (const genre of genreFamilies) {
    const score = scoreGenreMatch(genre, input);
    if (score > bestScore) {
      bestScore = score;
      best = genre;
    }
  }
  return bestScore > 0 ? best : genreFamilies.find((g) => g.id === "house")!;
}

export function getTechniqueById(id: string): Technique {
  const technique = techniques.find((t) => t.id === id);
  if (!technique) throw new Error(`Unknown technique id: ${id}`);
  return technique;
}

/**
 * The "style advisor" — takes a loose mood/genre/occasion string and
 * returns a recommended genre, mixing technique, a handful of reference
 * DJs, and a short one-line rationale. Intentionally simple: a lookup
 * over the genre/technique/DJ data, not a real AI recommendation.
 */
export function adviseStyle(input: string, djCount = 3): StyleAdvice {
  const genre = resolveGenreFamily(input);
  const technique = getTechniqueById(genre.representativeTechnique);

  const genreDjs = findDjsByGenre(genre.id, djCount);
  const fallbackDjs = genre.exampleDjs
    .map((name) => djs.find((dj) => dj.name === name))
    .filter((dj): dj is DjEntry => Boolean(dj));
  const combined = [...genreDjs, ...fallbackDjs.filter((dj) => !genreDjs.includes(dj))];
  const chosenDjs = combined.slice(0, djCount);

  // Neutral BPM-delta/tempo-sync assumptions here since this is a genre-level
  // recommendation, not a concrete pair of analyzed tracks (that's mix-engine's job).
  const transition = chooseTransition({
    bpmDelta: 0,
    tempoSync: true,
    genreHint: genre.id,
    personaDjNames: genre.exampleDjs,
  });

  const djNames = chosenDjs.map((dj) => dj.name).join(", ");
  const rationale = chosenDjs.length
    ? `Channel ${djNames}'s ${genre.name} energy with ${technique.name} to keep transitions ${
        genre.id === "techno" || genre.id === "hardstyle" ? "locked in and relentless" : "smooth and musical"
      }, mixing in with a ${transition.name.toLowerCase()}.`
    : `Lean into ${genre.name} using ${technique.name} for the transitions, mixing in with a ${transition.name.toLowerCase()}.`;

  return { genre, technique, djs: chosenDjs, transition, rationale };
}
