/**
 * What a playlist request asks for, as data (a CurationSpec), and the two ways of getting there from a sentence: the model
 * (src/lib/curate/llmSpec.ts) and a local reading of the words (parseRequestLocally), which is also the fallback when the
 * model is off or fails. Whatever produced a spec, validateSpec checks it against the genre taxonomy: every genre and
 * subgenre is on it, an unknown word is mapped to the nearest node by alias or dropped (and noted), and a request that
 * says nothing the system can use gets one clarifying question instead of a guess. Pure.
 */
import { GENRES, findNode, normalize } from "@/lib/genres";
import { isMoodId, normalizeMood } from "@/lib/moodTags";
import { isEnergyArc, isProfileId, profileFromText, type EnergyArc, type ProfileId } from "@/lib/curate/profiles";

export type ExplicitPolicy = "any" | "clean-only";

export interface CurationSpec {
  /** Top-level genre labels (the taxonomy's). */
  genres: string[];
  /** Subgenre labels (the taxonomy's); each belongs to one of `genres` or stands alone (it implies its parent). */
  subgenres: string[];
  /** Canonical mood ids. */
  moods: string[];
  eraRange?: { from: number; to: number };
  bpmRange?: { min: number; max: number };
  energyArc?: EnergyArc;
  explicitPolicy?: ExplicitPolicy;
  targetLengthMinutes?: number;
  profile?: ProfileId;
}

export interface SpecResult {
  spec: CurationSpec;
  /** One question to ask the person when the request names nothing usable; null otherwise. */
  clarification: string | null;
  /** Things that were dropped or mapped, in words, for the preview ("\"dubstepish\" became Dubstep"). */
  notes: string[];
}

export const MAX_TARGET_MINUTES = 600;
export const DEFAULT_TARGET_MINUTES = 45;
const THIS_YEAR = new Date().getFullYear();

export const CLARIFYING_QUESTION = "What kind of music should it be? Name a genre (like Hip-Hop or House), a feel (like chill or workout), or a decade.";

const clampYear = (n: number) => Math.min(THIS_YEAR + 1, Math.max(1900, Math.round(n)));

function cleanEra(raw: unknown): CurationSpec["eraRange"] {
  const r = raw as { from?: unknown; to?: unknown } | null | undefined;
  if (!r || typeof r.from !== "number" || typeof r.to !== "number" || !Number.isFinite(r.from) || !Number.isFinite(r.to)) return undefined;
  const from = clampYear(Math.min(r.from, r.to));
  const to = clampYear(Math.max(r.from, r.to));
  return { from, to };
}

function cleanBpm(raw: unknown): CurationSpec["bpmRange"] {
  const r = raw as { min?: unknown; max?: unknown } | null | undefined;
  if (!r || typeof r.min !== "number" || typeof r.max !== "number" || !Number.isFinite(r.min) || !Number.isFinite(r.max)) return undefined;
  const min = Math.max(40, Math.min(r.min, r.max));
  const max = Math.min(240, Math.max(r.min, r.max));
  return max - min >= 5 ? { min: Math.round(min), max: Math.round(max) } : undefined;
}

/** The genre that holds a subgenre label (the first, if a label were ever shared). */
function parentOf(subgenre: string): string | null {
  return GENRES.find((g) => g.subgenres.some((s) => s.label === subgenre))?.label ?? null;
}

/** Checks a spec from anywhere (the model, a client, the local reader) against the taxonomy and the limits. Never throws. */
export function validateSpec(raw: unknown): SpecResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const notes: string[] = [];
  const genres: string[] = [];
  const subgenres: string[] = [];
  const moods: string[] = [];
  const addGenre = (g: string) => genres.includes(g) || genres.push(g);
  const addSub = (s: string) => subgenres.includes(s) || subgenres.push(s);

  const words = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 12) : []);
  for (const word of words(r.genres)) {
    const exact = findNode(word);
    const node = exact ?? normalize(word);
    if (!node) {
      notes.push(`Ignored "${word}": not a genre I know.`);
      continue;
    }
    if (!exact || node.genre !== word) notes.push(`"${word}" became ${node.subgenre ? `${node.genre} · ${node.subgenre}` : node.genre}.`);
    addGenre(node.genre);
    if (node.subgenre) addSub(node.subgenre);
  }
  for (const word of words(r.subgenres)) {
    const parent = parentOf(word);
    if (parent) {
      addSub(word);
      continue;
    }
    const node = normalize(word);
    if (node?.subgenre) {
      notes.push(`"${word}" became ${node.genre} · ${node.subgenre}.`);
      addSub(node.subgenre);
    } else if (node) {
      notes.push(`"${word}" became ${node.genre}.`);
      addGenre(node.genre);
    } else {
      notes.push(`Ignored "${word}": not a subgenre I know.`);
    }
  }
  for (const word of words(r.moods)) {
    const mood = isMoodId(word) ? word : normalizeMood(word);
    if (mood) {
      if (!moods.includes(mood)) moods.push(mood);
    } else {
      notes.push(`Ignored "${word}": not a mood I know.`);
    }
  }

  const spec: CurationSpec = { genres, subgenres, moods };
  const era = cleanEra(r.eraRange);
  if (era) spec.eraRange = era;
  const bpm = cleanBpm(r.bpmRange);
  if (bpm) spec.bpmRange = bpm;
  if (isEnergyArc(r.energyArc)) spec.energyArc = r.energyArc;
  if (r.explicitPolicy === "any" || r.explicitPolicy === "clean-only") spec.explicitPolicy = r.explicitPolicy;
  if (typeof r.targetLengthMinutes === "number" && Number.isFinite(r.targetLengthMinutes) && r.targetLengthMinutes >= 5) {
    spec.targetLengthMinutes = Math.min(MAX_TARGET_MINUTES, Math.round(r.targetLengthMinutes));
  }
  if (isProfileId(r.profile)) spec.profile = r.profile;

  // A request with nothing the system can match on (no genre, mood, era, tempo or occasion) gets one question, not a guess.
  const usable = genres.length + subgenres.length + moods.length > 0 || spec.eraRange || spec.bpmRange || spec.profile;
  const clarification = typeof r.clarification === "string" && r.clarification.trim() && !usable ? r.clarification.trim().slice(0, 300) : usable ? null : CLARIFYING_QUESTION;
  return { spec, clarification, notes };
}

const DECADE = /\b(?:(early|mid|late)\s+)?((?:19|20)?\d0)'?s\b/;
const YEAR_SPAN = /\b(?:from\s+)?((?:19|20)\d{2})\s*(?:-|–|to|until|through)\s*((?:19|20)\d{2})\b/;

function decadeRange(text: string): CurationSpec["eraRange"] {
  const span = YEAR_SPAN.exec(text);
  if (span) return cleanEra({ from: Number(span[1]), to: Number(span[2]) });
  const d = DECADE.exec(text);
  if (!d) return undefined;
  let start = Number(d[2]);
  if (start < 100) start += start >= 30 ? 1900 : 2000;
  if (start % 10 !== 0 || start < 1900 || start > 2020) return undefined;
  const part = d[1];
  if (part === "early") return { from: start, to: start + 3 };
  if (part === "mid") return { from: start + 3, to: start + 6 };
  if (part === "late") return { from: start + 6, to: start + 9 };
  return { from: start, to: start + 9 };
}

function lengthMinutes(text: string): number | undefined {
  const m = /\b(\d+(?:\.\d+)?|an?|one|two|three)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b/.exec(text);
  if (!m) return undefined;
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
  const n = words[m[1]] ?? Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return /^h/.test(m[2]) ? Math.round(n * 60) : Math.round(n);
}

/** Splits into words keeping "r&b", "hip-hop" and "lo-fi" whole. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9&'À-ɏ/+-]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

/** Words that are genre or mood aliases but, in a sentence, are ordinary words (so not read as a genre). */
const FILLER = new Set(["for", "a", "an", "the", "and", "or", "of", "with", "to", "my", "me", "some", "that", "is", "in", "on", "at", "it", "i", "want", "make", "create", "build", "give", "playlist", "songs", "song", "music", "tracks", "mix", "only", "just", "no", "not", "hits", "classic", "heavy", "alternative", "dance", "club", "hard", "raw", "blue", "love", "easy", "smooth", "work", "drive", "car", "night", "fun", "bright", "run", "good", "great", "best", "new", "old", "time"]);

/**
 * A plain reading of a request, for when the model is off or fails: genres and subgenres by alias (the longest phrase wins),
 * moods, a decade or year span, a length, "clean only", a tempo window, and the occasion's profile. It is deliberately
 * simple; a phrase it cannot place is left out and the model path is the better reader.
 */
export function parseRequestLocally(text: string): SpecResult {
  const lower = text.toLowerCase();
  const tokens = wordsOf(lower);
  const genres: string[] = [];
  const subgenres: string[] = [];
  const moods: string[] = [];
  const used = new Array<boolean>(tokens.length).fill(false);

  for (let size = 3; size >= 1; size--) {
    for (let i = 0; i + size <= tokens.length; i++) {
      if (used.slice(i, i + size).some(Boolean)) continue;
      const phrase = tokens.slice(i, i + size).join(" ");
      if (size === 1 && FILLER.has(phrase)) continue;
      if (/^\d+s?$/.test(phrase) || /^(19|20)\d{2}$/.test(phrase)) continue;
      const node = normalize(phrase);
      if (node) {
        if (!genres.includes(node.genre)) genres.push(node.genre);
        if (node.subgenre && !subgenres.includes(node.subgenre)) subgenres.push(node.subgenre);
        for (let k = i; k < i + size; k++) used[k] = true;
        continue;
      }
      const mood = normalizeMood(phrase);
      if (mood) {
        if (!moods.includes(mood)) moods.push(mood);
        for (let k = i; k < i + size; k++) used[k] = true;
      }
    }
  }

  const raw: Record<string, unknown> = { genres, subgenres, moods };
  const era = decadeRange(lower);
  if (era) raw.eraRange = era;
  const bpm = /\b(\d{2,3})\s*(?:-|–|to)\s*(\d{2,3})\s*bpm\b/.exec(lower);
  if (bpm) raw.bpmRange = { min: Number(bpm[1]), max: Number(bpm[2]) };
  if (/\b(clean( only| versions?)?|no explicit|not explicit|radio[- ]?friendly|family[- ]?friendly|kid[- ]?(?:safe|friendly)|safe for work|censored)\b/.test(lower)) raw.explicitPolicy = "clean-only";
  const minutes = lengthMinutes(lower);
  if (minutes) raw.targetLengthMinutes = minutes;
  const profile = profileFromText(lower);
  if (profile) raw.profile = profile;
  return validateSpec(raw);
}
