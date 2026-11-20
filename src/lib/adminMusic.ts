// The Music catalog the admin edits (app/(app)/admin/music): how a search box becomes a database query, how a song is shaped into a table row,
// which songs count as "missing info", and what an edit may change. Pure (no database calls), so it is all unit-tested; the routes under
// app/api/admin/music do the reading and writing.
import type { Prisma } from "@/generated/prisma/client";
import { camelotForKey } from "@/lib/audio-analysis-core";
import { cleanTags, cleanText, MAX_TEXT_LENGTH } from "@/lib/apiValidation";

export const PAGE_SIZES = [25, 50, 100, 250] as const;
export const DEFAULT_PAGE_SIZE = 50;
export const SORT_KEYS = ["artist", "title", "genre", "plays", "bpm", "key", "added"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

/** The words that stand in for a name nobody filled in. A song called one of these is as good as unnamed. */
const PLACEHOLDER_NAMES = ["unknown", "unknown artist", "untitled", "untitled track", "n/a", "na", "-"];
export const MIN_BPM = 40;
export const MAX_BPM = 300;
const MAX_SEARCH_WORDS = 6;

export type MissingField = "artist" | "title" | "genre";

export type MusicQuery = { q: string; page: number; pageSize: number; sort: SortKey; dir: SortDir; missing: boolean };

function intParam(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** The catalog's query from the URL's search parameters: everything is clamped to something the database can be asked, nothing is trusted. */
export function parseMusicQuery(params: URLSearchParams): MusicQuery {
  const size = intParam(params.get("pageSize"), DEFAULT_PAGE_SIZE);
  const sort = params.get("sort") as SortKey | null;
  return {
    q: cleanText(params.get("q"), 120),
    page: Math.min(intParam(params.get("page"), 1), 100_000),
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
    sort: sort && (SORT_KEYS as readonly string[]).includes(sort) ? sort : "artist",
    dir: params.get("dir") === "desc" ? "desc" : "asc",
    missing: params.get("missing") === "1",
  };
}

/** True for a name that is empty, only spaces, or a placeholder such as "Unknown Artist". */
export function isMissingText(value: string | null | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "" || PLACEHOLDER_NAMES.includes(v);
}

/** Which of artist, song name and genre a song lacks (the three the admin is asked to fill in). */
export function missingFields(song: { artist: string | null; title: string | null; genre: string | null | undefined }): MissingField[] {
  const out: MissingField[] = [];
  if (isMissingText(song.artist)) out.push("artist");
  if (isMissingText(song.title)) out.push("title");
  if (!song.genre || !song.genre.trim()) out.push("genre");
  return out;
}

const insensitive = "insensitive" as const;

function placeholderClauses(field: "artist" | "title"): Prisma.TrackWhereInput[] {
  return ["", ...PLACEHOLDER_NAMES].map((p) => ({ [field]: { equals: p, mode: insensitive } }) as Prisma.TrackWhereInput);
}

export const missingArtistWhere: Prisma.TrackWhereInput = { OR: placeholderClauses("artist") };
export const missingTitleWhere: Prisma.TrackWhereInput = { OR: placeholderClauses("title") };
export const missingGenreWhere: Prisma.TrackWhereInput = { OR: [{ genreInfo: { is: null } }, { genreInfo: { is: { OR: [{ genre: null }, { genre: "" }] } } }] };
export const missingAnyWhere: Prisma.TrackWhereInput = { OR: [missingArtistWhere, missingTitleWhere, missingGenreWhere] };

/**
 * The database filter for the search box. Every word has to match something about the song (so "daddy yankee 95" narrows rather than widens):
 * its artist, name, genre or subgenre, a tag, its key, or, for a number, its BPM to within half a beat.
 */
export function musicWhere(q: string, missing: boolean): Prisma.TrackWhereInput {
  const words = q.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_WORDS);
  const and: Prisma.TrackWhereInput[] = words.map((word) => {
    const n = Number(word);
    const options: Prisma.TrackWhereInput[] = [
      { artist: { contains: word, mode: insensitive } },
      { title: { contains: word, mode: insensitive } },
      { tagsJson: { contains: word, mode: insensitive } },
      { key: { contains: word, mode: insensitive } },
      { camelotKey: { equals: word, mode: insensitive } },
      { genreInfo: { is: { OR: [{ genre: { contains: word, mode: insensitive } }, { subgenresJson: { contains: word, mode: insensitive } }] } } },
    ];
    if (Number.isFinite(n) && n >= MIN_BPM && n <= MAX_BPM) options.push({ bpm: { gte: n - 0.5, lte: n + 0.5 } });
    return { OR: options };
  });
  if (missing) and.push(missingAnyWhere);
  return and.length > 0 ? { AND: and } : {};
}

/** The sort the table asked for, with the song's id as the tie-break so pages never repeat or skip a song. Songs with no BPM or key go last. */
export function musicOrderBy(sort: SortKey, dir: SortDir): Prisma.TrackOrderByWithRelationInput[] {
  const tie: Prisma.TrackOrderByWithRelationInput = { id: "asc" };
  switch (sort) {
    case "artist":
      return [{ artist: dir }, { title: "asc" }, tie];
    case "title":
      return [{ title: dir }, { artist: "asc" }, tie];
    case "genre":
      return [{ genreInfo: { genre: { sort: dir, nulls: "last" } } }, { artist: "asc" }, tie];
    case "plays":
      return [{ playEvents: { _count: dir } }, { artist: "asc" }, tie];
    case "bpm":
      return [{ bpm: { sort: dir, nulls: "last" } }, { artist: "asc" }, tie];
    case "key":
      return [{ camelotKey: { sort: dir, nulls: "last" } }, { artist: "asc" }, tie];
    case "added":
      return [{ createdAt: dir }, tie];
  }
}

/** What the catalog reads for each song. */
export const MUSIC_SELECT = {
  id: true,
  artist: true,
  title: true,
  bpm: true,
  key: true,
  camelotKey: true,
  tagsJson: true,
  durationSec: true,
  createdAt: true,
  genreInfo: { select: { genre: true, status: true, subgenresJson: true } },
  _count: { select: { playEvents: true } },
} satisfies Prisma.TrackSelect;

export type MusicSongRow = Prisma.TrackGetPayload<{ select: typeof MUSIC_SELECT }>;

/** One line of the table, as the page receives it. */
export type MusicRow = {
  id: string;
  artist: string;
  title: string;
  genre: string | null;
  subgenres: string[];
  /** "auto" | "needs-review" | "confirmed" for a classified song, null when it has no classification yet. */
  genreStatus: string | null;
  plays: number;
  bpm: number | null;
  key: string | null;
  camelot: string | null;
  tags: string[];
  durationSec: number;
  addedAt: string;
  missing: MissingField[];
};

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function toMusicRow(song: MusicSongRow): MusicRow {
  const genre = song.genreInfo?.genre?.trim() || null;
  return {
    id: song.id,
    artist: song.artist,
    title: song.title,
    genre,
    subgenres: parseStringArray(song.genreInfo?.subgenresJson),
    genreStatus: song.genreInfo?.status ?? null,
    plays: song._count.playEvents,
    bpm: song.bpm,
    key: song.key,
    camelot: song.camelotKey,
    tags: parseStringArray(song.tagsJson),
    durationSec: song.durationSec,
    addedAt: song.createdAt.toISOString(),
    missing: missingFields({ artist: song.artist, title: song.title, genre }),
  };
}

// --- Editing -------------------------------------------------------------------------------------------------------------------

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NATURAL_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * A key typed by the admin, as the app stores it: `{ key: "A minor", camelotKey: "8A" }`. Accepts a Camelot code ("8A"), a name ("A minor",
 * "F# major", "Db min") or the short form ("Am", "C#m", "Bb"; no mode means major). Null when it is none of those.
 */
export function parseKeyInput(input: string): { key: string; camelotKey: string } | null {
  const text = input.trim();
  const camelot = text.match(/^(1[0-2]|[1-9])\s*([ab])$/i);
  if (camelot) {
    const wanted = `${camelot[1]}${camelot[2].toUpperCase()}`;
    for (const mode of ["minor", "major"]) {
      for (const pitch of PITCH_CLASSES) {
        const key = `${pitch} ${mode}`;
        if (camelotForKey(key) === wanted) return { key, camelotKey: wanted };
      }
    }
    return null;
  }
  const named = text.match(/^([A-Ga-g])\s*([#♯b♭]?)\s*(major|maj|minor|min|m)?$/i);
  if (!named) return null;
  const letter = named[1].toUpperCase();
  const accidental = named[2];
  const shift = accidental === "#" || accidental === "♯" ? 1 : accidental === "b" || accidental === "♭" ? -1 : 0;
  const semitone = (NATURAL_SEMITONE[letter] + shift + 12) % 12;
  const mode = /^m(in(or)?)?$/i.test(named[3] ?? "") ? "minor" : "major";
  const key = `${PITCH_CLASSES[semitone]} ${mode}`;
  const camelotKey = camelotForKey(key);
  return camelotKey ? { key, camelotKey } : null;
}

/** The columns an edit sets, ready for `prisma.track.update`. */
export type MusicEdit = {
  artist?: string;
  title?: string;
  bpm?: number | null;
  key?: string | null;
  camelotKey?: string | null;
  tagsJson?: string | null;
};

export type MusicEditResult = { ok: true; data: MusicEdit } | { ok: false; error: string };

/** Checks an edit from the catalog. Names cannot be blanked (a nameless song is the problem being fixed); BPM and key can be cleared with null. */
export function parseMusicEdit(body: unknown): MusicEditResult {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request body." };
  const b = body as Record<string, unknown>;
  const data: MusicEdit = {};

  for (const field of ["artist", "title"] as const) {
    if (!(field in b)) continue;
    const text = cleanText(b[field], MAX_TEXT_LENGTH);
    if (!text) return { ok: false, error: `${field === "artist" ? "Artist" : "Song name"} can't be empty.` };
    data[field] = text;
  }

  if ("bpm" in b) {
    if (b.bpm === null) {
      data.bpm = null;
    } else if (typeof b.bpm === "number" && Number.isFinite(b.bpm) && b.bpm >= MIN_BPM && b.bpm <= MAX_BPM) {
      data.bpm = Math.round(b.bpm * 100) / 100;
    } else {
      return { ok: false, error: `BPM must be a number from ${MIN_BPM} to ${MAX_BPM}.` };
    }
  }

  if ("key" in b) {
    if (b.key === null || (typeof b.key === "string" && b.key.trim() === "")) {
      data.key = null;
      data.camelotKey = null;
    } else {
      const parsed = typeof b.key === "string" ? parseKeyInput(b.key) : null;
      if (!parsed) return { ok: false, error: 'Key must look like "A minor", "F# major", "Am" or a Camelot code such as "8A".' };
      data.key = parsed.key;
      data.camelotKey = parsed.camelotKey;
    }
  }

  if ("tags" in b) {
    if (!Array.isArray(b.tags)) return { ok: false, error: "Tags must be a list." };
    const tags = cleanTags(b.tags);
    data.tagsJson = tags.length > 0 ? JSON.stringify(tags) : null;
  }

  if (Object.keys(data).length === 0) return { ok: false, error: "Nothing to change." };
  return { ok: true, data };
}

/** The tags box's text ("halloween, spooky") as a list. */
export function splitTagInput(text: string): string[] {
  return text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
}
