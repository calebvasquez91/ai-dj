/**
 * What the Home screen shows, as plain functions of the library, the play history and the playlists: the rows, the quick
 * grid, the filter chips. Pure, so the rules are tested; app/(app)/page.tsx only lays them out.
 */
import type { Mood } from "@/lib/moods";
import type { Playlist, Track } from "@/types/music";

/** Most-recently-played first, deduped by track id: `history` is append-order (oldest first). */
export function recentlyPlayed(history: readonly Track[], limit: number): Track[] {
  const seen = new Set<string>();
  const result: Track[] = [];
  for (let i = history.length - 1; i >= 0 && result.length < limit; i--) {
    const track = history[i];
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    result.push(track);
  }
  return result;
}

/** The newest additions first. */
export function recentlyAdded(library: readonly Track[], limit: number): Track[] {
  return [...library].sort((a, b) => b.addedAt - a.addedAt).slice(0, limit);
}

/** How many songs the quick-picks grid holds: three pages of 3 x 3. */
export const QUICK_PICKS_LIMIT = 27;

/** What to offer first: what was played lately, then what was added lately, with no song twice. */
export function quickPicks(library: readonly Track[], history: readonly Track[], limit = QUICK_PICKS_LIMIT): Track[] {
  const seen = new Set<string>();
  const picks: Track[] = [];
  for (const track of [...recentlyPlayed(history, limit), ...recentlyAdded(library, limit)]) {
    if (seen.has(track.id) || picks.length >= limit) continue;
    seen.add(track.id);
    picks.push(track);
  }
  return picks;
}

/**
 * Songs like the ones played lately: each library song scores a point for an artist and for every tag it shares with the
 * last twenty plays, and the highest scores come first (newest first on a tie). Songs played lately are never offered
 * back; with nothing played there is nothing to be "like", so the row is empty.
 */
export function mixedForYou(library: readonly Track[], history: readonly Track[], limit = 12): Track[] {
  const lately = recentlyPlayed(history, 20);
  if (lately.length === 0) return [];
  const artists = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const t of lately) {
    const artist = t.artist.trim().toLowerCase();
    if (artist) artists.set(artist, (artists.get(artist) ?? 0) + 1);
    for (const tag of new Set((t.tags ?? []).map((x) => x.trim().toLowerCase()))) {
      if (tag) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
  }
  const playedIds = new Set(recentlyPlayed(history, 12).map((t) => t.id));
  return library
    .filter((t) => !playedIds.has(t.id) && t.playPreference !== "do-not")
    .map((t) => {
      let score = artists.get(t.artist.trim().toLowerCase()) ?? 0;
      for (const tag of new Set((t.tags ?? []).map((x) => x.trim().toLowerCase()))) score += tags.get(tag) ?? 0;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.t.addedAt - a.t.addedAt)
    .slice(0, limit)
    .map((x) => x.t);
}

export type HomeChip = "all" | "music" | "mixes" | Mood;

export const HOME_CHIPS: readonly { id: HomeChip; label: string }[] = [
  { id: "all", label: "All" },
  { id: "music", label: "Music" },
  { id: "mixes", label: "Mixes" },
  { id: "energize", label: "Energize" },
  { id: "chill", label: "Chill" },
  { id: "workout", label: "Workout" },
  { id: "party", label: "Party" },
];

/**
 * What each chip shows: All is everything; Music is the song rows without the mixes; Mixes is the mixes and playlists
 * without the song rows; a mood keeps both but narrows the mixes to that mood and the song rows to its songs.
 */
export function chipView(chip: HomeChip): { showMixes: boolean; showMusic: boolean; mood: Mood | null } {
  if (chip === "all") return { showMixes: true, showMusic: true, mood: null };
  if (chip === "music") return { showMixes: false, showMusic: true, mood: null };
  if (chip === "mixes") return { showMixes: true, showMusic: false, mood: null };
  return { showMixes: true, showMusic: true, mood: chip };
}

/** Playlists for the quick-access grid and the playlist lists: Spooky Music pinned first, then the newest. */
export function pinnedFirst(playlists: readonly Playlist[]): Playlist[] {
  const spooky = playlists.filter((p) => p.theme === "spooky");
  const rest = playlists.filter((p) => p.theme !== "spooky").sort((a, b) => b.createdAt - a.createdAt);
  return [...spooky, ...rest];
}
