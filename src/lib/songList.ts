/**
 * The owner's song list as suggestions in Create with DJ: songs the person wants but has not uploaded, that fit a request. The list has 342 rows (lib/djLibrary.ts reads
 * them); this turns them into one entry per song, leaves out the ones that are already uploaded, scores the rest against a request with the same rules the
 * curator uses for the uploaded library (curate/select.ts scoreTrack: genre, mood, era, tempo, event profile), and puts the best in the order the playlist's energy
 * should run, preferring a small tempo step and a compatible Camelot key between neighbours when both are known. Pure.
 *
 * What it will not do: it never claims a song is clean (the list's "not explicit" is an estimate, so a clean-only request leaves out only the songs the list
 * marks explicit), and it never reads a mood from a playlist name unless the song's own words gave none (djLibrary.libraryMoods).
 */
import { normalize } from "@/lib/genres";
import { MIN_MATCH_SCORE, scoreTrack } from "@/lib/curate/select";
import { ARC_KEY_WEIGHT, orderByEnergyArc } from "@/lib/curate/energyArc";
import { ENERGY_MISS_LIMIT, ENERGY_WEIGHT, MOOD_ENERGY, moodEnergyTarget } from "@/lib/curate/moodEnergy";
import type { EnergyArc } from "@/lib/curate/profiles";
import type { CurationSpec } from "@/lib/curate/spec";
import { artistKeys, buildLibraryIndex, libraryMoods, matchLibrary, titleKey, variantTokens, type LibraryRow } from "@/lib/djLibrary";
import type { Track } from "@/types/music";

/** One song of the list: its rows merged (a song filed under several playlists is one song). */
export interface ListSong {
  /** Title and main artist with the noise taken out: what makes two rows the same song. */
  key: string;
  title: string;
  artist: string;
  playlists: string[];
  /** The ids of the list rows it came from. */
  rowIds: string[];
  genre: string;
  subGenre: string;
  year: number | null;
  bpm: number | null;
  camelot: string | null;
  /** 1-10, the average of its rows. */
  energy: number | null;
  /** Canonical mood ids (lib/moodTags.ts). */
  moods: string[];
  explicit: boolean | null;
}

/** A suggestion shown to the person. */
export interface ListSuggestion {
  key: string;
  title: string;
  artist: string;
  playlists: string[];
  genre: string | null;
  year: number | null;
  bpm: number | null;
  camelot: string | null;
  energy: number | null;
  moods: string[];
  /** 0-1, how well it fits the request, after the energy preference; never below MIN_MATCH_SCORE (curate/select.ts), the bar an uploaded song has to reach. */
  score: number;
}

/** The most suggestions shown for one request. */
export const MAX_LIST_SUGGESTIONS = 12;


// Re-exported: the mood-to-energy table lives in curate/moodEnergy.ts, where the curator's own scoring uses it too.
export { ENERGY_MISS_LIMIT, ENERGY_WEIGHT, MOOD_ENERGY, moodEnergyTarget };

const first = <T>(values: readonly (T | null)[]): T | null => values.find((v): v is T => v != null) ?? null;

/** The list as one entry per song. Rows are the same song when their title and main artist are the same once the noise is taken out. */
export function dedupeSongs(rows: readonly LibraryRow[]): ListSong[] {
  const groups = new Map<string, LibraryRow[]>();
  for (const row of rows) {
    const title = titleKey(row.title);
    const main = artistKeys(row.artist)[0] ?? "";
    if (!title) continue; // a placeholder ("(Any Masego song)") or album entry names no song
    // A remix, cover, live take and so on is a different recording from the original (matchLibrary treats it so), so it is a different song here too.
    const version = [...variantTokens(row.title)].sort().join("+");
    const key = `${title}|${main}${version ? `|${version}` : ""}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const energies = group.map((r) => r.energy).filter((e): e is number => e != null);
    const years = group.map((r) => r.year).filter((y): y is number => y != null);
    return {
      key,
      title: group[0].title,
      artist: group[0].artist,
      playlists: [...new Set(group.map((r) => r.playlist).filter(Boolean))],
      rowIds: group.map((r) => r.id),
      genre: first(group.map((r) => r.genre || null)) ?? "",
      subGenre: first(group.map((r) => r.subGenre || null)) ?? "",
      year: years.length > 0 ? Math.min(...years) : null,
      bpm: first(group.map((r) => r.bpm)),
      camelot: first(group.map((r) => r.camelot)),
      energy: energies.length > 0 ? Math.round((energies.reduce((s, e) => s + e, 0) / energies.length) * 10) / 10 : null,
      moods: libraryMoods(group),
      explicit: group.some((r) => r.explicit === true) ? true : group.some((r) => r.explicit === false) ? false : null,
    };
  });
}

/** The songs of the list that are already uploaded: a song is owned when any of its rows matches an uploaded track (same rules as the mood fill: lib/djLibrary.ts matchLibrary). */
export function ownedSongKeys(rows: readonly LibraryRow[], songs: readonly ListSong[], tracks: readonly { title: string; artist: string }[]): Set<string> {
  const index = buildLibraryIndex(rows);
  const ownedRows = new Set<string>();
  for (const track of tracks) for (const hit of matchLibrary(track, index)) ownedRows.add(hit.id);
  return new Set(songs.filter((s) => s.rowIds.some((id) => ownedRows.has(id))).map((s) => s.key));
}

/** What a song looks like to the curator's scoring: the genre wording mapped onto the taxonomy (the subgenre first, else the genre), the canonical moods, the year. */
function asTrack(song: ListSong): Track {
  const node = normalize(song.subGenre) ?? normalize(song.genre);
  return {
    id: song.key,
    title: song.title,
    artist: song.artist,
    durationSec: 0,
    addedAt: 0,
    source: "local",
    sourceUrl: "",
    genreTags: [],
    ...(node ? { genre: node.genre, subgenres: node.subgenre ? [node.subgenre] : [] } : {}),
    moods: song.moods,
    ...(song.year != null ? { year: song.year } : {}),
  } as Track;
}

/** Whether a request names anything to score against; with nothing, every song would fit equally and a suggestion would mean nothing. */
function hasConstraint(spec: CurationSpec): boolean {
  return spec.genres.length > 0 || spec.subgenres.length > 0 || spec.moods.length > 0 || spec.eraRange != null || spec.bpmRange != null || spec.profile != null;
}

export interface SuggestArgs {
  spec: CurationSpec;
  songs: readonly ListSong[];
  /** Keys of the songs already uploaded (ownedSongKeys). */
  owned: ReadonlySet<string>;
  arc: EnergyArc;
  /** Changes which near-equal songs come out, for "Regenerate"; 0 is the stable order. */
  seed?: number;
  limit?: number;
}

/** The songs of the list, not uploaded, that fit the request best, in the order the playlist's energy should run. */
export function suggestFromList({ spec, songs, owned, arc, seed = 0, limit = MAX_LIST_SUGGESTIONS }: SuggestArgs): ListSuggestion[] {
  if (!hasConstraint(spec)) return [];
  const energyTarget = moodEnergyTarget(spec.moods);
  const scored: { song: ListSong; score: number }[] = [];
  for (const song of songs) {
    if (owned.has(song.key)) continue;
    if (spec.explicitPolicy === "clean-only" && song.explicit === true) continue;
    const result = scoreTrack(asTrack(song), song.bpm, spec, { useEnergy: false });
    if (!result || result.score < MIN_MATCH_SCORE) continue;
    let score = result.score;
    // A song with no energy in the list is not marked down for it: there is nothing to compare.
    if (energyTarget != null && song.energy != null) {
      const miss = Math.abs(song.energy / 10 - energyTarget);
      if (miss > ENERGY_MISS_LIMIT) continue;
      score *= 1 - ENERGY_WEIGHT * miss;
    }
    // Every suggestion reaches the same bar an uploaded song has to: the energy preference can lower a song's score below it, and then it is not suggested.
    if (score < MIN_MATCH_SCORE) continue;
    scored.push({ song, score });
  }
  // Best fit first; a seed only reorders songs whose scores are close (the same jitter idea as select.ts), and the key is the final tie-break so the order is repeatable.
  const jitter = (key: string) => {
    if (seed === 0) return 0;
    let h = seed >>> 0;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h ^ key.charCodeAt(i), 16777619) + 0x9e3779b9) >>> 0;
    return (h / 0xffffffff) * 0.08;
  };
  scored.sort((a, b) => b.score + jitter(b.song.key) - (a.score + jitter(a.song.key)) || (a.song.key < b.song.key ? -1 : 1));
  const top = scored.slice(0, Math.max(0, limit));
  const byKey = new Map(top.map((t) => [t.song.key, t]));
  const ordered = orderByEnergyArc(
    top.map(({ song }) => ({ id: song.key, energy: Math.min(1, Math.max(0, (song.energy ?? 5) / 10)), bpm: song.bpm, camelot: song.camelot, genre: normalize(song.subGenre)?.genre ?? normalize(song.genre)?.genre ?? null })),
    arc,
    seed,
    0,
    ARC_KEY_WEIGHT
  );
  return ordered.map((o) => {
    const { song, score } = byKey.get(o.id)!;
    return {
      key: song.key,
      title: song.title,
      artist: song.artist,
      playlists: song.playlists,
      genre: song.subGenre || song.genre || null,
      year: song.year,
      bpm: song.bpm,
      camelot: song.camelot,
      energy: song.energy,
      moods: song.moods,
      score,
    };
  });
}
