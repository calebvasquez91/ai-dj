/**
 * The owner's own song list (data/dj-library.jsonl: one JSON object per song, with a mood list, a year and the playlist it was filed under) matched to the
 * songs that are actually uploaded, so Vibe Code has moods to work with. Pure: reading the file and the database, and the report, are in
 * scripts/match-dj-library.ts.
 *
 * What it will and will not do:
 *  - It FILLS GAPS only. A song's moods are written only when it has none, its year only when it has none. It never replaces a genre, a BPM, a key, an
 *    explicit mark or anything a source or a person set. The list's BPM, key and energy are the list's own estimates (it says so itself), and the app's own
 *    analysis is better; the 1-10 energy has no place to live (the curator works energy out from loudness and tempo).
 *  - A song matches on its title and its main artist, both compared with the noise taken out (accents, case, punctuation, "(Clean)", "(Quick Hit Dirty)", "feat. ...").
 *    A version that changes the song (a remix, a cover, a mashup, a live or acoustic take, a slowed or sped-up one) is not matched to the original, because
 *    its mood may differ; a clean, dirty, radio, intro or extended edit is the same song and is matched.
 *  - A mood word is kept only when it maps onto the app's own mood list (lib/moodTags.ts); the rest are dropped. The playlist the owner filed the song under
 *    adds one more, after the song's own.
 */
import { normalizeMood } from "@/lib/moodTags";
import { MAX_MOODS_KEPT } from "@/lib/genre/stored";

export interface LibraryRow {
  id: string;
  playlist: string;
  title: string;
  artist: string;
  /** The song's own mood words, as the list wrote them. */
  moods: string[];
  year: number | null;
  /** 1-10. Kept for the report only: it has no column to go into. */
  energy: number | null;
}

/** What a playlist name says about its songs, canonical mood ids (lib/moodTags.ts). Only used after a song's own moods, to fill up to the cap. */
export const PLAYLIST_MOODS: Readonly<Record<string, readonly string[]>> = {
  "Get You Pumped": ["energetic"],
  "Parties & BBQ": ["party"],
  Workouts: ["workout"],
  "Sad & Mellow": ["sad"],
  "Car Tunes": ["road-trip"],
  Childhood: ["nostalgic"],
  "Lovey Dovey": ["romantic"],
  "Vibes & Wine Down": ["chill"],
};

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const asYear = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1900 && v <= 2100 ? v : null);
const asEnergy = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10 ? v : null);

/** The rows of a JSON Lines file. A blank line is ignored; a line that is not an object with an id, title and artist is counted in `skipped`, never thrown. */
export function parseLibraryJsonl(text: string): { rows: LibraryRow[]; skipped: number } {
  const rows: LibraryRow[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = asString(o.id);
    const title = asString(o.title);
    const artist = asString(o.artist);
    if (!id || !title || !artist) {
      skipped++;
      continue;
    }
    rows.push({
      id,
      playlist: asString(o.playlist),
      title,
      artist,
      moods: asString(o.moods).split(",").map((m) => m.trim()).filter(Boolean),
      year: asYear(o.year),
      energy: asEnergy(o.energy),
    });
  }
  return { rows, skipped };
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const alnum = (s: string) => fold(s).replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

/** A title with the noise taken out: brackets and what is in them, a trailing " - Radio Edit" style tail, and "feat. ..." */
export function titleKey(title: string): string {
  return alnum(
    fold(title)
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(/\s[-–—]\s.*$/, " ")
      .replace(/\b(?:feat|ft|featuring)\b.*$/, " ")
  );
}

/** The song's artists, each with the noise taken out, main artist first. "Unknown Artist" and empty names are dropped. */
export function artistKeys(artist: string): string[] {
  return fold(artist)
    .split(/\s*(?:,|&|\band\b|\bx\b|\bwith\b|\b(?:ft|feat|featuring)\b\.?)\s*/)
    .map(alnum)
    .filter((a) => a !== "" && a !== "unknownartist");
}

const VARIANT_PATTERNS: readonly [RegExp, string][] = [
  [/\b(?:remix|rmx|re-?work|flip|vip)\b/, "remix"],
  [/\bmash-?up\b/, "mashup"],
  [/\bbootleg\b/, "bootleg"],
  [/\bcover\b/, "cover"],
  [/\blive\b/, "live"],
  [/\bacoustic\b/, "acoustic"],
  [/\b(?:slowed|sped up|speed up|nightcore)\b/, "altered-speed"],
  [/\bkaraoke\b/, "karaoke"],
  [/\breimagined\b/, "reimagined"],
];

/** The ways a title says "not the original recording". A clean, dirty, radio, intro, extended, instrumental or short edit is not one of them. */
export function variantTokens(title: string): Set<string> {
  const low = fold(title);
  const out = new Set<string>();
  for (const [re, token] of VARIANT_PATTERNS) if (re.test(low)) out.add(token);
  return out;
}

export type LibraryIndex = Map<string, LibraryRow[]>;

/** The rows by title key. A placeholder or album entry with nothing left of its title is not indexed. */
export function buildLibraryIndex(rows: readonly LibraryRow[]): LibraryIndex {
  const index: LibraryIndex = new Map();
  for (const row of rows) {
    const key = titleKey(row.title);
    if (!key) continue;
    index.set(key, [...(index.get(key) ?? []), row]);
  }
  return index;
}

/** The library rows that are this uploaded song: same title, the row's main artist among the song's artists, and no version the row does not have. */
export function matchLibrary(track: { title: string; artist: string }, index: LibraryIndex): LibraryRow[] {
  const candidates = index.get(titleKey(track.title));
  if (!candidates) return [];
  const artists = artistKeys(track.artist);
  const variants = variantTokens(track.title);
  return candidates.filter((row) => {
    const main = artistKeys(row.artist)[0];
    if (!main || !artists.includes(main)) return false;
    const rowVariants = variantTokens(row.title);
    for (const v of variants) if (!rowVariants.has(v)) return false;
    return true;
  });
}

/** The canonical moods for a song from every row that names it (the same song can sit in several playlists): the songs' own words first, then the playlists', at most MAX_MOODS_KEPT. */
export function libraryMoods(rows: readonly LibraryRow[]): string[] {
  const out: string[] = [];
  const add = (mood: string | null | undefined) => {
    if (mood && !out.includes(mood) && out.length < MAX_MOODS_KEPT) out.push(mood);
  };
  for (const row of rows) for (const word of row.moods) add(normalizeMood(word));
  for (const row of rows) for (const mood of PLAYLIST_MOODS[row.playlist] ?? []) add(mood);
  return out;
}

export interface StoredFacts {
  moods: readonly string[];
  year: number | null;
}

export interface Fill {
  /** The moods to write, only when the song has none today. */
  moods?: string[];
  /** The year to write, only when the song has none today. */
  year?: number;
}

/** What to fill in for one matched song, given what it has now. Empty when there is nothing to add. */
export function planFill(current: StoredFacts, rows: readonly LibraryRow[]): Fill {
  const fill: Fill = {};
  if (current.moods.length === 0) {
    const moods = libraryMoods(rows);
    if (moods.length > 0) fill.moods = moods;
  }
  if (current.year == null) {
    const year = rows.map((r) => r.year).find((y): y is number => y != null);
    if (year != null) fill.year = year;
  }
  return fill;
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * One idempotent UPDATE per song for TrackGenre. Moods are written only while the row's moods are still '[]' and the year only while it is null, so running the file
 * twice, or after a re-classify has filled them, changes nothing. A mood that is not a canonical id never reaches SQL.
 */
export function fillStatement(trackId: string, fill: Fill): string | null {
  const sets: string[] = [];
  if (fill.moods && fill.moods.length > 0) {
    const json = JSON.stringify(fill.moods.filter((m) => normalizeMood(m) === m));
    if (json !== "[]") sets.push(`"moodsJson" = CASE WHEN "moodsJson" = '[]' THEN ${sqlText(json)} ELSE "moodsJson" END`);
  }
  if (fill.year != null && Number.isInteger(fill.year)) sets.push(`"year" = COALESCE("year", ${fill.year})`);
  if (sets.length === 0) return null;
  return `UPDATE "TrackGenre" SET ${sets.join(", ")} WHERE "trackId" = ${sqlText(trackId)};`;
}
