/**
 * Library groupings for the Library and Search screens: artists, liked songs, the most-used tags, and which segment of
 * the Library the URL asks for. Pure, so the rules are tested; the screens only lay them out.
 */
import type { Track } from "@/types/music";

export type LibraryView = "songs" | "artists" | "liked" | "fx";

export const LIBRARY_VIEWS: readonly { id: LibraryView; label: string }[] = [
  { id: "songs", label: "Songs" },
  { id: "artists", label: "Artists" },
  { id: "liked", label: "Liked" },
  { id: "fx", label: "FX" },
];

/** The segment named by a `?view=` value, Songs when it is missing or not one of them. */
export function parseLibraryView(value: string | null | undefined): LibraryView {
  return LIBRARY_VIEWS.some((v) => v.id === value) ? (value as LibraryView) : "songs";
}

export interface ArtistGroup {
  name: string;
  tracks: Track[];
}

const UNKNOWN_ARTIST = "Unknown artist";

/**
 * The library by artist: case and padding ignored when grouping (the first spelling seen is the one shown), songs in
 * library order within each, artists A to Z with "Unknown artist" last.
 */
export function artistsOf(tracks: readonly Track[]): ArtistGroup[] {
  const groups = new Map<string, ArtistGroup>();
  for (const track of tracks) {
    const shown = track.artist.trim() || UNKNOWN_ARTIST;
    const key = shown.toLowerCase();
    const group = groups.get(key);
    if (group) group.tracks.push(track);
    else groups.set(key, { name: shown, tracks: [track] });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.name === UNKNOWN_ARTIST) return b.name === UNKNOWN_ARTIST ? 0 : 1;
    if (b.name === UNKNOWN_ARTIST) return -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** The liked songs that are still in the library, newest like first (`likedIds` order). */
export function likedTracks(library: readonly Track[], likedIds: readonly string[]): Track[] {
  const byId = new Map(library.map((t) => [t.id, t]));
  const result: Track[] = [];
  for (const id of likedIds) {
    const track = byId.get(id);
    if (track) result.push(track);
  }
  return result;
}

/** The tags used most across the library, most used first (alphabetical on a tie), the first spelling seen shown. */
export function topTags(tracks: readonly Track[], limit = 12): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const track of tracks) {
    const seenHere = new Set<string>();
    for (const raw of track.tags ?? []) {
      const tag = raw.trim();
      const key = tag.toLowerCase();
      if (!tag || seenHere.has(key)) continue;
      seenHere.add(key);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }))
    .slice(0, limit);
}
