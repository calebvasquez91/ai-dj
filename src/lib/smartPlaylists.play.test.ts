import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/lib/store";
import { smartPlaylists, SMART_MIN_GENRE_TRACKS } from "@/lib/smartPlaylists";
import type { GenreTag, Track } from "@/types/music";

// Every "Made by your DJ" card plays its list with playTrackList (components/SmartPlaylists.tsx). This plays the first song of each one
// and checks what the player is handed: that song as the current track, playing, with a stream address and the rest of the list queued.

const tag = (genre: string, source: GenreTag["source"]): GenreTag => ({ genre, source, confidence: 0.8, updatedAt: 1 });
const GENRES = ["Hip-Hop", "Pop", "R&B", "Country", "Electronic", "Rock", "Alternative", "Disco", "Funk", "Soul"];
const library: Track[] = GENRES.flatMap((genre, g) =>
  Array.from({ length: SMART_MIN_GENRE_TRACKS + 3 }, (_, i) => {
    const id = `${genre}-${i}`;
    return {
      id,
      title: id,
      artist: `artist ${g}-${i % 4}`,
      durationSec: 200,
      addedAt: 0,
      source: "local",
      sourceUrl: `https://store.example/${id}.mp3`,
      genreTags: [tag(genre, "musicbrainz"), tag(genre, "lastfm")],
      genreStatus: "auto",
    } as Track;
  }),
);

const initial = useStore.getState();
beforeEach(() => useStore.setState(initial, true));

describe("Made by your DJ: playing the first song of every card", () => {
  const lists = smartPlaylists(library);
  const byId = new Map(library.map((t) => [t.id, t]));

  it("proposes a card for each genre", () => {
    expect(lists.map((l) => l.genre).sort()).toEqual([...GENRES].sort());
  });

  for (const list of lists) {
    it(`${list.title}: every id is a real song, and playing it hands the player the first song with a stream address and the rest queued`, () => {
      const tracks = list.trackIds.map((id) => byId.get(id));
      expect(tracks.every((t) => t != null), "every id resolves to a library song").toBe(true);
      const playable = tracks as Track[];

      useStore.getState().playTrackList(playable, 0);
      const s = useStore.getState();
      expect(s.currentTrack?.id).toBe(playable[0].id);
      expect(s.isPlaying).toBe(true);
      expect(s.currentTrack?.source === "local" && s.currentTrack.sourceUrl).toBeTruthy();
      expect(s.queue.map((t) => t.id)).toEqual(playable.slice(1).map((t) => t.id));
    });
  }
});
