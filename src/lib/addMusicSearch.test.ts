import { describe, expect, it } from "vitest";
import { RECENT_LIMIT, searchForAddMusic, type TrackFacts } from "./addMusicSearch";
import type { Track } from "@/types/music";

function track(id: string, title: string, artist: string, extra: Partial<Track> = {}): Track {
  return { id, title, artist, source: "local", sourceUrl: `/t/${id}`, durationSec: 200, addedAt: 0, ...extra } as Track;
}

const none: TrackFacts = { bpm: null, key: null };
const noFacts = () => none;
const base = { playlistTrackIds: new Set<string>(), spookyPlaylist: false, facts: noFacts };

describe("searchForAddMusic", () => {
  const library = [
    track("1", "Midnight City", "M83"),
    track("2", "Move Ya Body", "Nina Sky"),
    track("3", "Monster Mash", "Bobby Pickett", { tags: ["Halloween"] }),
    track("4", "Café del Mar", "Energy 52"),
  ];

  it("matches title and artist, any case, partial words", () => {
    expect(searchForAddMusic({ ...base, library, query: "mid" }).map((r) => r.track.id)).toEqual(["1"]);
    expect(searchForAddMusic({ ...base, library, query: "NINA" }).map((r) => r.track.id)).toEqual(["2"]);
  });

  it("ignores accents", () => {
    expect(searchForAddMusic({ ...base, library, query: "cafe" }).map((r) => r.track.id)).toEqual(["4"]);
  });

  it("needs every typed word to match something", () => {
    expect(searchForAddMusic({ ...base, library, query: "move nina" }).map((r) => r.track.id)).toEqual(["2"]);
    expect(searchForAddMusic({ ...base, library, query: "move bobby" })).toEqual([]);
  });

  it("matches tags (the library's nearest thing to a genre)", () => {
    expect(searchForAddMusic({ ...base, library, query: "halloween" }).map((r) => r.track.id)).toEqual(["3"]);
  });

  it("matches BPM and key", () => {
    const facts = (t: Track): TrackFacts => (t.id === "1" ? { bpm: 128.2, key: "8A" } : none);
    expect(searchForAddMusic({ ...base, library, facts, query: "128" }).map((r) => r.track.id)).toEqual(["1"]);
    expect(searchForAddMusic({ ...base, library, facts, query: "8a" }).map((r) => r.track.id)).toEqual(["1"]);
  });

  it("leaves out tracks already in the playlist, except ones just added", () => {
    const playlistTrackIds = new Set(["1", "2"]);
    expect(searchForAddMusic({ ...base, library, playlistTrackIds, query: "mo" }).map((r) => r.track.id)).toEqual(["3"]);
    const shown = searchForAddMusic({ ...base, library, playlistTrackIds, keepIds: new Set(["2"]), query: "move" });
    expect(shown.map((r) => r.track.id)).toEqual(["2"]);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchForAddMusic({ ...base, library, query: "zzzz" })).toEqual([]);
  });

  it("with no query lists the most recently added tracks, newest first, at most ten", () => {
    const many = Array.from({ length: 14 }, (_, i) => track(String(i), `Song ${i}`, "A", { addedAt: i }));
    const recent = searchForAddMusic({ ...base, library: many, query: "  " });
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0].track.id).toBe("13");
    expect(recent[RECENT_LIMIT - 1].track.id).toBe("4");
  });

  it("lists Spooky-tagged tracks first in Spooky Music only", () => {
    const lib = [track("a", "Alpha Song", "X"), track("b", "Alpha Ghost", "X", { tags: ["spooky"] })];
    expect(searchForAddMusic({ ...base, library: lib, query: "alpha", spookyPlaylist: true }).map((r) => r.track.id)).toEqual(["b", "a"]);
    expect(searchForAddMusic({ ...base, library: lib, query: "alpha", spookyPlaylist: false }).map((r) => r.track.id)).toEqual(["a", "b"]);
  });

  it("flags the Spooky tracks and passes tempo and key through", () => {
    const facts = () => ({ bpm: 90, key: "5A" });
    const [r] = searchForAddMusic({ ...base, library: [track("x", "Eerie Tune", "Y", { tags: ["eerie"] })], facts, query: "eerie" });
    expect(r).toMatchObject({ spooky: true, bpm: 90, key: "5A" });
  });
});
