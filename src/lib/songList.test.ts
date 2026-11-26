import { describe, expect, it } from "vitest";
import { MAX_LIST_SUGGESTIONS, dedupeSongs, moodEnergyTarget, ownedSongKeys, suggestFromList, type ListSong } from "./songList";
import { orderByEnergyArc } from "./curate/energyArc";
import { MIN_MATCH_SCORE } from "./curate/select";
import type { LibraryRow } from "./djLibrary";
import type { CurationSpec } from "./curate/spec";

let n = 0;
const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: `T${++n}`,
  playlist: "Workouts",
  title: `Song ${n}`,
  artist: `Artist ${n}`,
  moods: [],
  year: null,
  energy: null,
  genre: "",
  subGenre: "",
  bpm: null,
  camelot: null,
  explicit: null,
  durationSec: null,
  ...over,
});
const spec = (over: Partial<CurationSpec> = {}): CurationSpec => ({ genres: [], subgenres: [], moods: [], ...over });
const songsOf = (rows: LibraryRow[]): ListSong[] => dedupeSongs(rows);
const titles = (s: { title: string }[]) => s.map((x) => x.title);

describe("one entry per song", () => {
  it("merges the rows of a song filed under several playlists, and drops placeholders", () => {
    const songs = dedupeSongs([
      row({ id: "A", title: "Yellow", artist: "Coldplay", playlist: "Sad & Mellow", energy: 5, year: 2000, moods: ["romantic"] }),
      row({ id: "B", title: "Yellow", artist: "Coldplay", playlist: "Vibes & Wine Down", energy: 6, year: 2001, bpm: 87, camelot: "1B", explicit: false }),
      row({ id: "C", title: "(Any Masego song)", artist: "Masego" }),
      row({ id: "D", title: "Zombie", artist: "The Cranberries", explicit: true }),
    ]);
    expect(songs.map((s) => s.title)).toEqual(["Yellow", "Zombie"]);
    const yellow = songs[0];
    expect(yellow.rowIds).toEqual(["A", "B"]);
    expect(yellow.playlists).toEqual(["Sad & Mellow", "Vibes & Wine Down"]);
    expect(yellow).toMatchObject({ energy: 5.5, year: 2000, bpm: 87, camelot: "1B", explicit: false });
    expect(songs[1].explicit).toBe(true);
  });

  it("keeps a remix and its original apart, as the ownership check does: owning one does not hide the other", () => {
    const rows = [row({ id: "A", title: "Die For You", artist: "The Weeknd" }), row({ id: "B", title: "Die For You (Remix)", artist: "The Weeknd" }), row({ id: "C", title: "Die For You (Clean)", artist: "The Weeknd" })];
    const songs = dedupeSongs(rows);
    expect(songs.map((s) => s.rowIds)).toEqual([["A", "C"], ["B"]]); // a clean edit is the same recording; a remix is not
    const owned = ownedSongKeys(rows, songs, [{ title: "Die For You (Quick Hit Dirty)", artist: "The Weeknd" }]);
    expect(songs.filter((s) => !owned.has(s.key)).map((s) => s.title)).toEqual(["Die For You (Remix)"]);
  });

  it("says a song is explicit when any row does", () => {
    const [song] = dedupeSongs([row({ title: "X", artist: "Y", explicit: false }), row({ title: "X", artist: "Y", explicit: true })]);
    expect(song.explicit).toBe(true);
  });
});

describe("which songs are already uploaded", () => {
  it("counts a song as owned when an uploaded edit of it matches, and not otherwise", () => {
    const rows = [row({ id: "A", title: "Passionfruit", artist: "Drake" }), row({ id: "B", title: "Zombie", artist: "The Cranberries" })];
    const songs = dedupeSongs(rows);
    const owned = ownedSongKeys(rows, songs, [{ title: "Passionfruit (Instrumental)", artist: "Drake" }, { title: "Zombie", artist: "Unknown Artist" }]);
    expect(owned.size).toBe(1);
    expect(songs.filter((s) => owned.has(s.key)).map((s) => s.title)).toEqual(["Passionfruit"]);
  });
});

describe("suggestFromList", () => {
  const none = new Set<string>();

  it("suggests nothing for a request that names nothing to score against", () => {
    expect(suggestFromList({ spec: spec(), songs: songsOf([row({ genre: "Pop" })]), owned: none, arc: "steady" })).toEqual([]);
  });

  it("leaves out songs that are already uploaded", () => {
    const songs = songsOf([row({ title: "Mine", genre: "Pop" }), row({ title: "Wanted", genre: "Pop" })]);
    const owned = new Set([songs[0].key]);
    expect(titles(suggestFromList({ spec: spec({ genres: ["Pop"] }), songs, owned, arc: "steady" }))).toEqual(["Wanted"]);
  });

  it("keeps to the genre asked for, reading the list's own wording (a subgenre, or the genre)", () => {
    const songs = songsOf([
      row({ title: "Raining Blood", genre: "Metal", subGenre: "Thrash Metal" }),
      row({ title: "Du Hast", genre: "Metal", subGenre: "Industrial Metal (Neue Deutsche Harte)" }),
      row({ title: "Blank Space", genre: "Pop", subGenre: "Synth-pop" }),
    ]);
    expect(titles(suggestFromList({ spec: spec({ genres: ["Metal"] }), songs, owned: none, arc: "steady" })).sort()).toEqual(["Du Hast", "Raining Blood"]);
  });

  it("puts a song with the mood asked for ahead of one without", () => {
    const songs = songsOf([row({ title: "Plain", genre: "Pop" }), row({ title: "Chill one", genre: "Pop", moods: ["relaxed", "smooth"] })]);
    const out = suggestFromList({ spec: spec({ genres: ["Pop"], moods: ["chill"] }), songs, owned: none, arc: "steady" });
    expect(out[0].title).toBe("Chill one");
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it("keeps to the era, allowing a song with no known year", () => {
    const songs = songsOf([
      row({ title: "Old", genre: "Rock", year: 1975 }),
      row({ title: "Ninety", genre: "Rock", year: 1994 }),
      row({ title: "Unknown", genre: "Rock", year: null }),
    ]);
    const out = suggestFromList({ spec: spec({ genres: ["Rock"], eraRange: { from: 1990, to: 1999 } }), songs, owned: none, arc: "steady" });
    expect(titles(out).sort()).toEqual(["Ninety", "Unknown"]);
  });

  it("keeps to the tempo asked for, allowing a song with no known tempo", () => {
    const songs = songsOf([row({ title: "Fast", genre: "Metal", bpm: 170 }), row({ title: "Mid", genre: "Metal", bpm: 120 }), row({ title: "Unknown", genre: "Metal" })]);
    const out = suggestFromList({ spec: spec({ genres: ["Metal"], bpmRange: { min: 110, max: 130 } }), songs, owned: none, arc: "steady" });
    expect(titles(out)).toContain("Mid");
    expect(titles(out)).toContain("Unknown");
    expect(titles(out)).not.toContain("Fast");
  });

  it("under clean-only leaves out only songs the list marks explicit: 'not explicit' is an estimate, so it is not read as clean", () => {
    const songs = songsOf([row({ title: "Rude", genre: "Hip-Hop", explicit: true }), row({ title: "Estimated", genre: "Hip-Hop", explicit: false }), row({ title: "Unmarked", genre: "Hip-Hop", explicit: null })]);
    const out = suggestFromList({ spec: spec({ genres: ["Hip-Hop"], explicitPolicy: "clean-only" }), songs, owned: none, arc: "steady" });
    expect(titles(out).sort()).toEqual(["Estimated", "Unmarked"]);
    expect(titles(suggestFromList({ spec: spec({ genres: ["Hip-Hop"] }), songs, owned: none, arc: "steady" })).length).toBe(3);
  });

  it("a workout or party request leaves out low-energy songs and ranks the high-energy ones first; a chill or sad one does the reverse", () => {
    const songs = songsOf([
      row({ title: "Ballad", genre: "R&B", energy: 3, moods: ["workout"] }),
      row({ title: "Banger", genre: "R&B", energy: 9, moods: ["workout"] }),
      row({ title: "Steady", genre: "R&B", energy: 7, moods: ["workout"] }),
      row({ title: "Unrated", genre: "R&B", energy: null, moods: ["workout"] }),
    ]);
    const workout = suggestFromList({ spec: spec({ genres: ["R&B"], moods: ["workout"] }), songs, owned: new Set(), arc: "steady" });
    expect(titles(workout)).not.toContain("Ballad");
    const byScore = [...workout].sort((a, b) => b.score - a.score).map((s) => s.title);
    expect(byScore.indexOf("Banger")).toBeLessThan(byScore.indexOf("Steady"));
    expect(titles(workout)).toContain("Unrated");

    const sad = songsOf([row({ title: "Soft", genre: "R&B", energy: 3, moods: ["heartbroken"] }), row({ title: "Loud", genre: "R&B", energy: 9, moods: ["heartbroken"] })]);
    const out = suggestFromList({ spec: spec({ genres: ["R&B"], moods: ["sad"] }), songs: sad, owned: new Set(), arc: "steady" });
    expect(titles(out)).toEqual(["Soft"]);
  });

  it("every suggestion reaches the bar an uploaded song has to, even after the energy preference lowers its score", () => {
    const songs = songsOf(Array.from({ length: 12 }, (_, i) => row({ title: `Mid ${i}`, genre: "R&B", energy: 5 + (i % 2), year: null, moods: [] })));
    const out = suggestFromList({ spec: spec({ genres: ["R&B"], moods: ["workout"], eraRange: { from: 1990, to: 1999 } }), songs, owned: new Set(), arc: "steady" });
    for (const s of out) expect(s.score).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  it("moodEnergyTarget averages the moods that imply an energy and is null when none does", () => {
    expect(moodEnergyTarget(["workout", "party"])).toBeCloseTo(0.825);
    expect(moodEnergyTarget(["chill", "workout"])).toBeCloseTo(0.575);
    expect(moodEnergyTarget(["nostalgic", "road-trip"])).toBeNull();
    expect(moodEnergyTarget([])).toBeNull();
  });

  it("orders the suggestions along the energy arc", () => {
    const songs = songsOf([row({ title: "Loud", genre: "Pop", energy: 9 }), row({ title: "Soft", genre: "Pop", energy: 3 }), row({ title: "Middle", genre: "Pop", energy: 6 })]);
    const arcOf = (arc: "build" | "wind-down") => titles(suggestFromList({ spec: spec({ genres: ["Pop"] }), songs, owned: none, arc }));
    expect(arcOf("build")).toEqual(["Soft", "Middle", "Loud"]);
    expect(arcOf("wind-down")).toEqual(["Loud", "Middle", "Soft"]);
  });

  it("shows at most the limit, best fits first", () => {
    const many = songsOf(Array.from({ length: 30 }, (_, i) => row({ title: `P${i}`, genre: "Pop", energy: 5 })));
    expect(suggestFromList({ spec: spec({ genres: ["Pop"] }), songs: many, owned: none, arc: "steady" }).length).toBe(MAX_LIST_SUGGESTIONS);
    expect(suggestFromList({ spec: spec({ genres: ["Pop"] }), songs: many, owned: none, arc: "steady", limit: 3 }).length).toBe(3);
  });

  it("gives the same suggestions every time for one seed, and a different mix for another", () => {
    const many = songsOf(Array.from({ length: 30 }, (_, i) => row({ title: `P${i}`, genre: "Pop", energy: 5 })));
    const pick = (seed: number) => titles(suggestFromList({ spec: spec({ genres: ["Pop"] }), songs: many, owned: none, arc: "steady", seed })).join(",");
    expect(pick(0)).toBe(pick(0));
    expect(pick(7)).toBe(pick(7));
    expect(pick(7)).not.toBe(pick(0));
  });

  it("keeps compatible Camelot keys next to each other when the energy is the same", () => {
    const songs = songsOf([
      row({ title: "A minor", genre: "Pop", energy: 5, camelot: "8A", bpm: 120 }),
      row({ title: "Far key", genre: "Pop", energy: 5, camelot: "3B", bpm: 120 }),
      row({ title: "C major", genre: "Pop", energy: 5, camelot: "8B", bpm: 120 }),
    ]);
    const out = titles(suggestFromList({ spec: spec({ genres: ["Pop"] }), songs, owned: none, arc: "steady" }));
    expect(Math.abs(out.indexOf("A minor") - out.indexOf("C major"))).toBe(1);
  });
});

describe("orderByEnergyArc with a key weight", () => {
  const items = [
    { id: "a", energy: 0.5, bpm: null, camelot: "8A" },
    { id: "b", energy: 0.5, bpm: null, camelot: "3B" },
    { id: "c", energy: 0.5, bpm: null, camelot: "8B" },
  ];

  it("without a key weight the order is what it always was", () => {
    const withoutKeys = items.map((i) => ({ id: i.id, energy: i.energy, bpm: i.bpm }));
    expect(orderByEnergyArc(items, "steady").map((i) => i.id)).toEqual(orderByEnergyArc(withoutKeys, "steady").map((i) => i.id));
  });

  it("with one, a clash is kept off the middle, and unknown keys cost nothing", () => {
    const ids = orderByEnergyArc(items, "steady", 0, 0, 0.5).map((i) => i.id);
    expect(ids[1]).not.toBe("b");
    const unknown = items.map((i) => ({ ...i, camelot: null }));
    expect(orderByEnergyArc(unknown, "steady", 0, 0, 0.5).map((i) => i.id)).toEqual(orderByEnergyArc(unknown, "steady").map((i) => i.id));
  });
});

describe("orderByEnergyArc: the key only breaks near-ties", () => {
  it("rewards songs whose keys fit: two keyed songs are kept together instead of being split up by an unkeyed one", () => {
    const items = [
      { id: "A", energy: 0.5, bpm: null, camelot: "8A" },
      { id: "u1", energy: 0.5, bpm: null, camelot: null },
      { id: "B", energy: 0.5, bpm: null, camelot: "8B" },
      { id: "u2", energy: 0.5, bpm: null, camelot: null },
    ];
    const ids = orderByEnergyArc(items, "steady", 0, 0, 0.08).map((i) => i.id);
    expect(Math.abs(ids.indexOf("A") - ids.indexOf("B"))).toBe(1);
    // with no key weight nothing moves them
    expect(orderByEnergyArc(items, "steady").map((i) => i.id)).toEqual(["A", "u1", "B", "u2"]);
  });

  it("never puts a dip in a rising or falling line for the sake of a key, even when many orders have the same energy cost", () => {
    // Every energy sits below the arc's targets, so the energy cost is the same for any order: only the key could move them, and it must not.
    const keys = ["8A", "3A", "8B", "3B", "9A", "4A"];
    const items = keys.map((camelot, i) => ({ id: `s${i}`, energy: 0.1 + i * 0.12, bpm: null, camelot }));
    for (const arc of ["build", "wind-down"] as const) {
      const energies = orderByEnergyArc(items, arc, 0, 0, 0.08).map((i) => i.energy);
      const sorted = [...energies].sort((a, b) => (arc === "build" ? a - b : b - a));
      expect(energies).toEqual(sorted);
    }
  });

  it("still lets the key reorder equal-energy songs on a steady arc", () => {
    const items = ["8A", "3A", "8B", "3B", "9A", "4A"].map((camelot, i) => ({ id: `s${i}`, energy: 0.5, bpm: null, camelot }));
    const clashes = (ids: string[]) => ids.slice(1).filter((id, i) => Math.abs(Number(items.find((x) => x.id === id)!.camelot.slice(0, -1)) - Number(items.find((x) => x.id === ids[i])!.camelot.slice(0, -1))) > 1).length;
    const keyed = orderByEnergyArc(items, "steady", 0, 0, 0.08).map((i) => i.id);
    expect(clashes(keyed)).toBeLessThan(clashes(orderByEnergyArc(items, "steady").map((i) => i.id)));
  });
});
