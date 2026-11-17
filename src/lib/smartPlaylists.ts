/**
 * "Auto genre playlists": playlists the DJ proposes from the library's classified genres (one per genre, and one per genre
 * and mood such as "Late-night Hip-Hop"). They are worked out from the library each time it is shown, so they refresh by
 * themselves as new tracks are classified; nothing is stored. A person can play one, or freeze it: that saves its current
 * tracks as a normal playlist, which is theirs to edit from then on. Pure.
 *
 * The same rules as any curated playlist apply (src/lib/curate/eligibility.ts): Do-Not-Play tracks and Halloween music are
 * left out, Halloween music staying in Spooky Music.
 */
import { genresOfTrack } from "@/lib/genreLibrary";
import { eligibleTracks } from "@/lib/curate/eligibility";
import type { Track } from "@/types/music";

export interface SmartPlaylist {
  /** Stable for the same genre and mood, so a card keeps its place as the library grows. */
  id: string;
  title: string;
  genre: string;
  mood?: string;
  trackIds: string[];
  /** Always true: lets the app mark these as the DJ's, not the person's. */
  smart: true;
}

export const SMART_MIN_GENRE_TRACKS = 8;
export const SMART_MIN_MOOD_TRACKS = 6;
export const SMART_MAX_PLAYLISTS = 12;

const MOOD_WORDS: Record<string, string> = {
  "late-night": "Late-night",
  "road-trip": "Road-trip",
  dinner: "Dinner",
  focus: "Focus",
  sleep: "Sleep",
  summer: "Summer",
  nostalgic: "Throwback",
};

const moodWord = (mood: string) => MOOD_WORDS[mood] ?? mood.charAt(0).toUpperCase() + mood.slice(1);

export function smartPlaylists(library: readonly Track[], limit = SMART_MAX_PLAYLISTS): SmartPlaylist[] {
  const { tracks } = eligibleTracks(library, { explicitPolicy: "any", allowHalloween: false });
  const byGenre = new Map<string, { track: Track; confidence: number }[]>();
  const byGenreMood = new Map<string, { track: Track; confidence: number }[]>();
  for (const track of tracks) {
    for (const g of genresOfTrack(track)) {
      byGenre.set(g.genre, [...(byGenre.get(g.genre) ?? []), { track, confidence: g.confidence }]);
      for (const mood of track.moods ?? []) {
        const key = `${g.genre}\u0000${mood}`;
        byGenreMood.set(key, [...(byGenreMood.get(key) ?? []), { track, confidence: g.confidence }]);
      }
    }
  }
  const best = (rows: { track: Track; confidence: number }[]) => rows.sort((a, b) => b.confidence - a.confidence || a.track.title.localeCompare(b.track.title)).map((r) => r.track.id);
  const out: SmartPlaylist[] = [];
  for (const [genre, rows] of byGenre) {
    if (rows.length >= SMART_MIN_GENRE_TRACKS) out.push({ id: `smart:${genre}`, title: genre, genre, trackIds: best(rows), smart: true });
  }
  for (const [key, rows] of byGenreMood) {
    const [genre, mood] = key.split("\u0000");
    // A mood list that is the whole genre adds nothing: only those that narrow it are worth a card.
    if (rows.length >= SMART_MIN_MOOD_TRACKS && rows.length < (byGenre.get(genre)?.length ?? 0)) {
      out.push({ id: `smart:${genre}:${mood}`, title: `${moodWord(mood)} ${genre}`, genre, mood, trackIds: best(rows), smart: true });
    }
  }
  return out.sort((a, b) => b.trackIds.length - a.trackIds.length || a.title.localeCompare(b.title)).slice(0, limit);
}
