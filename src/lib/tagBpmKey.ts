// The BPM and key a song's own file tags carry (ID3 TBPM / TKEY), as they are stored in Track.tagBpm / tagKey / tagCamelotKey (prisma/tag-bpm-key.sql). Pure: it
// only judges the raw tag values the tag reader gives (music-metadata's common.bpm and common.key); reading the files and writing the rows is the backfill's job.
import { MAX_BPM, MIN_BPM, parseKeyInput } from "@/lib/adminMusic";

/** A tag BPM as a stored number: a finite value from 40 to 300 (a year, or a half-time reading such as 37, is rejected), to two decimals. Null otherwise. */
export function tagBpmFrom(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n < MIN_BPM || n > MAX_BPM) return null;
  return Math.round(n * 100) / 100;
}

/** A tag key as the app stores keys ("A minor" with its Camelot code "8A"). Accepts a name ("Am", "Bb", "F# minor") or a Camelot code; null for anything else ("All", ""). */
export function tagKeyFrom(raw: unknown): { tagKey: string; tagCamelotKey: string } | null {
  if (typeof raw !== "string") return null;
  const parsed = parseKeyInput(raw);
  return parsed ? { tagKey: parsed.key, tagCamelotKey: parsed.camelotKey } : null;
}

export type TagValues = { tagBpm: number | null; tagKey: string | null; tagCamelotKey: string | null };

/** What to store for a song from its file's raw tags. Each part is null when the file has no usable value for it. */
export function tagValuesFrom(raw: { bpm?: unknown; key?: unknown }): TagValues {
  const key = tagKeyFrom(raw.key);
  return { tagBpm: tagBpmFrom(raw.bpm), tagKey: key?.tagKey ?? null, tagCamelotKey: key?.tagCamelotKey ?? null };
}

/** True when there is anything to store. */
export function hasTagValues(v: TagValues): boolean {
  return v.tagBpm != null || v.tagKey != null;
}
