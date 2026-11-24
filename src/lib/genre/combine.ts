/**
 * Turning every source's tags for a track into its genres: weighted agreement, the final list, and whether a person should
 * look at it. Pure (it imports only the taxonomy), so the browser's review screen and the server's pipeline resolve a
 * track the same way.
 *
 * A track's stored tags are the raw answers, one per source and genre, plus any `manual` tag. They are combined here:
 *  - A genre two or more independent sources agree on gains confidence (noisy-or: 0.6 and 0.6 make 0.84); a lone tag keeps
 *    its own, so a lone low-confidence tag stays low. Sources are weighted by how much to trust them (SOURCE_WEIGHT).
 *  - A subgenre tag also counts, a little less, for its parent genre; but a subgenre sure enough to be kept keeps its parent too
 *    (a track cannot be sure it is Nu Disco and unsure it is Disco), so one clean file tag that names a subgenre is enough.
 *  - The LLM is not independent (it was shown the other sources), so it never compounds with them: it counts as one more
 *    vote at 0.85 of its own confidence, taking the larger of that and the independent agreement.
 *  - A `manual` tag wins outright: the track resolves to what a person set and nothing a source says moves it.
 */
import { findNode } from "@/lib/genres";
import type { GenreStatus, GenreTag, GenreTagSource } from "@/types/music";

/** How far a source's own confidence is trusted when combining (MusicBrainz is curated; a file's tag is whatever someone typed). */
export const SOURCE_WEIGHT: Readonly<Record<Exclude<GenreTagSource, "manual" | "llm">, number>> = {
  musicbrainz: 1,
  "file-tags": 0.9,
  lastfm: 0.9,
  "audio-classifier": 0.8,
};
export const LLM_WEIGHT = 0.85;
/** A subgenre tag counts for its parent genre at this fraction. */
export const SUBGENRE_TO_GENRE = 0.9;
/** No combination is ever more sure than this: two sources agreeing is strong, not certain. */
export const COMBINED_CAP = 0.95;
/** A genre must reach this to be one of the track's genres (and the best one must, or the track needs review). */
export const KEEP_CONFIDENCE = 0.5;
/** A source's genre counts in a conflict check only if it is at least this sure. */
export const CONFLICT_MIN_CONFIDENCE = 0.4;
/** Confident enough to stop asking more sources. */
export const EARLY_STOP_CONFIDENCE = 0.8;

export interface ResolvedGenre {
  genre: string;
  /** The confidence of the genre as a whole (all its subgenre evidence included). */
  confidence: number;
  /** Subgenres of this genre that reach KEEP_CONFIDENCE, best first. */
  subgenres: { subgenre: string; confidence: number }[];
  /** The sources that support it. */
  sources: GenreTagSource[];
}

export interface Resolution {
  /** Genres at or above KEEP_CONFIDENCE, best first. Empty when nothing reaches it. */
  genres: ResolvedGenre[];
  /** Every genre any source named, best first, including those below KEEP_CONFIDENCE (what a review can still offer). */
  candidates: ResolvedGenre[];
  /** The best confidence of any genre, kept or not (0 with no tags). */
  best: number;
  /** The top two sources name different genres. */
  conflict: boolean;
  /** The status the tags call for, ignoring a person's earlier confirmation (see statusFor). */
  autoStatus: Exclude<GenreStatus, "confirmed">;
  /** A person set the genres. */
  manual: boolean;
}

const noisyOr = (values: readonly number[]) => 1 - values.reduce((p, v) => p * (1 - Math.max(0, Math.min(1, v))), 1);
const onTaxonomy = (t: GenreTag) => t.confidence > 0 && findNode(t.genre, t.subgenre) != null;

/** What each source voted for one genre or subgenre: its best confidence for it, after weighting. */
type Votes = Map<GenreTagSource, number>;
const vote = (map: Map<string, Votes>, key: string, source: GenreTagSource, value: number) => {
  const votes = map.get(key) ?? new Map<GenreTagSource, number>();
  votes.set(source, Math.max(votes.get(source) ?? 0, value));
  map.set(key, votes);
};

/** The independent sources' votes agree by noisy-or; the LLM's vote does not compound with them. */
function confidenceOf(votes: Votes): number {
  const independent = [...votes].filter(([source]) => source !== "llm").map(([, v]) => v);
  return Math.min(COMBINED_CAP, Math.max(noisyOr(independent), votes.get("llm") ?? 0));
}

/** Combines non-manual tags. Exported for the pipeline's early-stop check. */
export function combineSourceTags(tags: readonly GenreTag[]): { genres: ResolvedGenre[]; candidates: ResolvedGenre[]; best: number; conflict: boolean } {
  const valid = tags.filter((t) => t.source !== "manual" && onTaxonomy(t));
  // Keyed by genre, and by genre + subgenre. One source can name a genre twice (a genre tag and a subgenre tag): one vote, its best.
  const genreVotes = new Map<string, Votes>();
  const subVotes = new Map<string, Votes>();
  for (const t of valid) {
    const weight = t.source === "llm" ? LLM_WEIGHT : (SOURCE_WEIGHT[t.source as keyof typeof SOURCE_WEIGHT] ?? 0.8);
    const own = Math.min(1, t.confidence * weight);
    vote(genreVotes, t.genre, t.source, t.subgenre ? own * SUBGENRE_TO_GENRE : own);
    if (t.subgenre) vote(subVotes, `${t.genre}\u0000${t.subgenre}`, t.source, own);
  }
  const genres: ResolvedGenre[] = [];
  for (const [genre, votes] of genreVotes) {
    const subgenres: { subgenre: string; confidence: number }[] = [];
    for (const [key, subVote] of subVotes) {
      const [g, subgenre] = key.split("\u0000");
      const confidence = confidenceOf(subVote);
      if (g === genre && confidence >= KEEP_CONFIDENCE) subgenres.push({ subgenre, confidence });
    }
    subgenres.sort((x, y) => y.confidence - x.confidence);
    // The parent genre is never less sure than its best kept subgenre. Without this, a lone clean file tag naming a subgenre ("House", "Nu Disco",
    // "Dance Pop": 0.6 x 0.9 = 0.54) reached its parent only at 0.54 x SUBGENRE_TO_GENRE = 0.486, just under KEEP_CONFIDENCE, so such a song never
    // resolved without the LLM (about half of the songs that had no genre).
    const confidence = Math.min(COMBINED_CAP, Math.max(confidenceOf(votes), subgenres[0]?.confidence ?? 0));
    genres.push({ genre, confidence, subgenres, sources: [...votes.keys()] });
  }
  genres.sort((x, y) => y.confidence - x.confidence);
  return { genres: genres.filter((g) => g.confidence >= KEEP_CONFIDENCE), candidates: genres, best: genres[0]?.confidence ?? 0, conflict: sourcesConflict(valid) };
}

/**
 * The top two sources (by their own best confidence) name genres with nothing in common. A source's genres are only
 * counted if it is at least CONFLICT_MIN_CONFIDENCE sure of them, so a shrug does not make a disagreement.
 */
export function sourcesConflict(tags: readonly GenreTag[]): boolean {
  const bySource = new Map<GenreTagSource, { best: number; genres: Set<string> }>();
  for (const t of tags) {
    if (t.source === "manual" || t.confidence < CONFLICT_MIN_CONFIDENCE) continue;
    const e = bySource.get(t.source) ?? { best: 0, genres: new Set<string>() };
    e.best = Math.max(e.best, t.confidence);
    e.genres.add(t.genre);
    bySource.set(t.source, e);
  }
  const top = [...bySource.values()].sort((a, b) => b.best - a.best).slice(0, 2);
  if (top.length < 2) return false;
  return ![...top[0].genres].some((g) => top[1].genres.has(g));
}

/** What a track's tags resolve to: a person's genres if they set any, else the combined sources. */
export function resolveGenreTags(tags: readonly GenreTag[] | undefined): Resolution {
  const all = tags ?? [];
  const manual = all.filter((t) => t.source === "manual" && onTaxonomy(t));
  if (manual.length > 0) {
    const byGenre = new Map<string, ResolvedGenre>();
    for (const t of [...manual].sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt)) {
      const g = byGenre.get(t.genre) ?? { genre: t.genre, confidence: 1, subgenres: [], sources: ["manual" as const] };
      if (t.subgenre && !g.subgenres.some((s) => s.subgenre === t.subgenre)) g.subgenres.push({ subgenre: t.subgenre, confidence: 1 });
      byGenre.set(t.genre, g);
    }
    const genres = [...byGenre.values()];
    return { genres, candidates: genres, best: 1, conflict: false, autoStatus: "auto", manual: true };
  }
  const { genres, candidates, best, conflict } = combineSourceTags(all);
  return { genres, candidates, best, conflict, autoStatus: best < KEEP_CONFIDENCE || conflict ? "needs-review" : "auto", manual: false };
}

/** The status to store: a person's confirmation is never taken back; otherwise what the tags call for. */
export function statusFor(tags: readonly GenreTag[] | undefined, current: GenreStatus | undefined): GenreStatus {
  if (current === "confirmed" || (tags ?? []).some((t) => t.source === "manual")) return "confirmed";
  return resolveGenreTags(tags).autoStatus;
}

/**
 * A confirmed track whose sources, taken by themselves, now point somewhere else: the re-run "flags disagreement" without
 * changing what the person set. True when the sources agree on a best genre (at least KEEP_CONFIDENCE) that is not among the
 * person's genres.
 */
export function disagreesWithManual(tags: readonly GenreTag[] | undefined): boolean {
  const manual = (tags ?? []).filter((t) => t.source === "manual");
  if (manual.length === 0) return false;
  // Only when the sources, without the person's tag, would have kept a different best genre (and settled on it: no conflict).
  const sources = combineSourceTags((tags ?? []).filter((t) => t.source !== "manual"));
  const top = sources.genres[0];
  if (!top || sources.conflict) return false;
  return !manual.some((t) => t.genre === top.genre);
}
