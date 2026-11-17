/**
 * FileTagProvider: the genre tags written inside the audio file itself (ID3, Vorbis, MP4), collapsed onto the taxonomy.
 * The reading is injected (fileTagReader.ts reads a real file), so the rules here are plain functions that tests drive
 * with strings.
 *
 * Confidence: a clean single match is 0.6. A tag that lists several genres is less sure of any one of them (0.45 for two,
 * 0.4 for three, 0.3 for more), a bare ID3 number is 0.5, and any tag the taxonomy could not place caps what is left at 0.5.
 * Nothing from a file's own tags goes above 0.6: they are whatever the last person or tool to touch the file typed.
 */
import { normalizeMany, type GenreNode } from "@/lib/genres";
import type { GenreTag } from "@/types/music";
import { EMPTY_RESULT, type GenreProvider, type ProviderInput, type ProviderResult } from "@/lib/genre/types";

export interface RawFileTags {
  /** Every value of the file's genre field, as written (a field can hold several). */
  genres: string[];
  album?: string | null;
  year?: number | null;
  /** The file's content advisory (iTunes advisory tag): explicit, clean, or absent. */
  explicit?: "explicit" | "clean" | null;
}

export const FILE_TAG_CLEAN_CONFIDENCE = 0.6;

/**
 * The content advisory in a file's native tags: the iTunes advisory (an MP4 `rtng` atom: 1 or 4 explicit, 2 clean; an ID3
 * `TXXX:ITUNESADVISORY` frame or a Vorbis `ITUNESADVISORY` / `ADVISORY` field: "1" explicit, "2" clean, or the words).
 * Anything else, including "0" (no advisory), is unknown: the file did not say.
 */
export function advisoryFromNative(native: Readonly<Record<string, readonly { id: string; value: unknown }[]>> | undefined): "explicit" | "clean" | null {
  for (const tags of Object.values(native ?? {})) {
    for (const t of tags) {
      const id = t.id.toLowerCase();
      if (id !== "rtng" && !id.endsWith("itunesadvisory") && id !== "advisory") continue;
      const v = String(t.value).trim().toLowerCase();
      if (v === "1" || v === "4" || v === "explicit") return "explicit";
      if (v === "2" || v === "clean") return "clean";
    }
  }
  return null;
}

export function genreTagsFromFileTags(rawGenres: readonly string[], at: number): GenreTag[] {
  const nodes: GenreNode[] = [];
  const seen = new Set<string>();
  let unplaced = 0;
  let onlyNumeric = true;
  for (const raw of rawGenres) {
    const found = normalizeMany(raw);
    if (found.length === 0) {
      if (raw.trim() !== "") unplaced++;
      continue;
    }
    if (!/^\s*[([]?\s*\d{1,3}\s*[)\]]?\s*$/.test(raw)) onlyNumeric = false;
    for (const n of found) {
      const id = `${n.genre}/${n.subgenre ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      nodes.push(n);
    }
  }
  if (nodes.length === 0) return [];
  let confidence = nodes.length === 1 ? FILE_TAG_CLEAN_CONFIDENCE : nodes.length === 2 ? 0.45 : nodes.length === 3 ? 0.4 : 0.3;
  if (nodes.length === 1 && onlyNumeric) confidence = 0.5;
  if (unplaced > 0) confidence = Math.min(confidence, 0.5);
  return nodes.map((n) => ({ genre: n.genre, ...(n.subgenre ? { subgenre: n.subgenre } : {}), source: "file-tags" as const, confidence, updatedAt: at }));
}

export interface FileTagProviderOptions {
  readTags: (input: ProviderInput) => Promise<RawFileTags | null>;
  now?: () => number;
}

export function createFileTagProvider({ readTags, now = Date.now }: FileTagProviderOptions): GenreProvider {
  return {
    id: "file-tags",
    async classify(input: ProviderInput): Promise<ProviderResult> {
      if (input.source !== "local" || !input.storageKey) return { ...EMPTY_RESULT, note: "no audio file to read" };
      let raw: RawFileTags | null;
      try {
        raw = await readTags(input);
      } catch (err) {
        return { ...EMPTY_RESULT, note: `could not read the file's tags (${err instanceof Error ? err.message : "error"})` };
      }
      if (!raw) return { ...EMPTY_RESULT, note: "the file has no readable tags" };
      const meta = { album: raw.album ?? null, year: raw.year ?? null, explicit: raw.explicit ?? null };
      const tags = genreTagsFromFileTags(raw.genres, now());
      return { tags, moods: [], meta, note: tags.length === 0 ? (raw.genres.length === 0 ? "no genre tag in the file" : "the genre tag names nothing on the taxonomy") : undefined };
    },
  };
}
