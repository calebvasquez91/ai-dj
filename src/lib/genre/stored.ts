/**
 * A track's stored genre record, and the pure rules for changing it: merging a pipeline run into it, and a person's own
 * edits. Manual tags are the one thing a run never touches. Everything here is a plain function over plain data, so the
 * server's routes and the tests use the same rules.
 */
import { findNode } from "@/lib/genres";
import { summarizeGenreTags } from "@/lib/genreTags";
import { resolveGenreTags, statusFor } from "@/lib/genre/combine";
import type { GenreStatus, GenreTag, GenreTagSource } from "@/types/music";

export interface StoredGenre {
  /** Every source's raw tags, plus any manual ones. See combine.ts for how they add up. */
  tags: GenreTag[];
  status: GenreStatus;
  /** The summary derived from the tags (kept so the library can be filtered without resolving every track). */
  genre?: string;
  subgenres: string[];
  moods: string[];
  /** Facts the sources found about the track, kept next to its genres. */
  year?: number;
  explicit?: "explicit" | "clean";
  updatedAt: number;
}

export const MAX_MOODS_KEPT = 5;
export const AUTO_SOURCES: readonly Exclude<GenreTagSource, "manual">[] = ["file-tags", "musicbrainz", "lastfm", "audio-classifier", "llm"];

/** Rebuilds the derived fields (status and summary) from the tags. `current` is the status before, so a confirmation survives. */
export function finalizeStored(
  tags: GenreTag[],
  moods: string[],
  current: GenreStatus | undefined,
  at: number,
  facts: { year?: number | null; explicit?: "explicit" | "clean" | null } = {}
): StoredGenre {
  const summary = summarizeGenreTags(tags);
  return {
    tags,
    status: statusFor(tags, current),
    genre: summary.genre,
    subgenres: summary.subgenres,
    moods: moods.slice(0, MAX_MOODS_KEPT),
    ...(facts.year ? { year: facts.year } : {}),
    ...(facts.explicit ? { explicit: facts.explicit } : {}),
    updatedAt: at,
  };
}

/**
 * What a re-run may do to what is already stored: add and refresh the sources' tags, never touch a person's. A source that
 * answered this time replaces its old tags; one that gave nothing (down, rate limited, not configured) keeps what it said
 * before, so a bad day for an API never erases a good answer. Moods are the union, newest first.
 */
export function mergeRun(existing: StoredGenre | null, run: { tags: GenreTag[]; moods: string[]; year?: number | null; explicit?: "explicit" | "clean" | null }, at: number): StoredGenre {
  const manual = (existing?.tags ?? []).filter((t) => t.source === "manual");
  const kept: GenreTag[] = [];
  for (const source of AUTO_SOURCES) {
    const fresh = run.tags.filter((t) => t.source === source);
    kept.push(...(fresh.length > 0 ? fresh : (existing?.tags ?? []).filter((t) => t.source === source)));
  }
  const moods = [...new Set([...run.moods, ...(existing?.moods ?? [])])];
  return finalizeStored([...manual, ...kept], moods, existing?.status, at, { year: run.year ?? existing?.year, explicit: run.explicit ?? existing?.explicit });
}

export interface GenrePick {
  genre: string;
  subgenre?: string;
}

/** The picks that are on the taxonomy, without repeats. */
export function validPicks(picks: readonly GenrePick[]): GenrePick[] {
  const out: GenrePick[] = [];
  for (const p of picks) {
    const node = findNode(p.genre, p.subgenre ?? null);
    if (!node) continue;
    if (out.some((o) => o.genre === node.genre && (o.subgenre ?? "") === (node.subgenre ?? ""))) continue;
    out.push(node);
  }
  return out;
}

/**
 * A person's own genres for a track: source "manual", confidence 1, status "confirmed". They replace any earlier manual
 * tags and are never removed by a re-run. The other sources' tags stay, so the review screen can still show what they said.
 * Returns null when none of the picks is on the taxonomy.
 */
export function applyManualGenres(existing: StoredGenre | null, picks: readonly GenrePick[], at: number): StoredGenre | null {
  const valid = validPicks(picks);
  if (valid.length === 0) return null;
  const others = (existing?.tags ?? []).filter((t) => t.source !== "manual");
  const manual: GenreTag[] = valid.map((p) => ({ genre: p.genre, ...(p.subgenre ? { subgenre: p.subgenre } : {}), source: "manual", confidence: 1, updatedAt: at }));
  return finalizeStored([...manual, ...others], existing?.moods ?? [], "confirmed", at, { year: existing?.year, explicit: existing?.explicit });
}

/** Takes back a person's genres: the track goes back to what its sources say, and to review if they are unsure. */
export function clearManualGenres(existing: StoredGenre, at: number): StoredGenre {
  return finalizeStored(existing.tags.filter((t) => t.source !== "manual"), existing.moods, "auto", at, { year: existing.year, explicit: existing.explicit });
}

/** The tags worth showing a person as suggestions: the sources' own (not manual), best first, one per source and genre. */
export function suggestionsFrom(tags: readonly GenreTag[]): GenreTag[] {
  const best = new Map<string, GenreTag>();
  for (const t of tags) {
    if (t.source === "manual") continue;
    const key = `${t.source}\u0000${t.genre}\u0000${t.subgenre ?? ""}`;
    const have = best.get(key);
    if (!have || t.confidence > have.confidence) best.set(key, t);
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}

/** The best genre the sources offer (with its best subgenre), if it is at least `minConfidence` sure: what "accept" takes. */
export function bestCandidate(tags: readonly GenreTag[], minConfidence: number): GenrePick | null {
  const top = resolveGenreTags(tags.filter((t) => t.source !== "manual")).candidates[0];
  if (!top || top.confidence < minConfidence) return null;
  const subgenre = top.subgenres[0]?.subgenre;
  return { genre: top.genre, ...(subgenre ? { subgenre } : {}) };
}

/**
 * "Accept all above 0.4": a track still waiting for review whose best candidate is at least `minConfidence` sure gets that
 * candidate as a person's own genre. Returns null (nothing to change) for a confirmed track or one with no such candidate.
 */
export function acceptBest(stored: StoredGenre, minConfidence: number, at: number): StoredGenre | null {
  if (stored.status === "confirmed") return null;
  const pick = bestCandidate(stored.tags, minConfidence);
  return pick ? applyManualGenres(stored, [pick], at) : null;
}

/** "Confirm selected": the genres the track shows now (its kept genres, else its best candidate) become a person's own. */
export function confirmCurrent(stored: StoredGenre, at: number): StoredGenre | null {
  if (stored.status === "confirmed") return null;
  const resolution = resolveGenreTags(stored.tags);
  const picks: GenrePick[] = resolution.genres.slice(0, 3).map((g) => ({ genre: g.genre, ...(g.subgenres[0] ? { subgenre: g.subgenres[0].subgenre } : {}) }));
  const fallback = picks.length === 0 ? bestCandidate(stored.tags, 0.01) : null;
  return applyManualGenres(stored, fallback ? [fallback] : picks, at);
}
