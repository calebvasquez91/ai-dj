import { describe, expect, it } from "vitest";
import type { Track } from "@/types/music";
import { artistsOf, likedTracks, parseLibraryView, topTags } from "./library";

function track(id: string, artist: string, tags?: string[]): Track {
  return { id, title: id, artist, tags, source: "local", sourceUrl: `/t/${id}`, durationSec: 100, addedAt: 0 } as Track;
}

describe("parseLibraryView", () => {
  it("reads the four segments", () => {
    expect(parseLibraryView("artists")).toBe("artists");
    expect(parseLibraryView("liked")).toBe("liked");
    expect(parseLibraryView("fx")).toBe("fx");
    expect(parseLibraryView("songs")).toBe("songs");
  });

  it("is Songs for anything else", () => {
    expect(parseLibraryView(null)).toBe("songs");
    expect(parseLibraryView(undefined)).toBe("songs");
    expect(parseLibraryView("albums")).toBe("songs");
  });
});

describe("artistsOf", () => {
  it("groups by artist ignoring case and padding, showing the first spelling", () => {
    const groups = artistsOf([track("1", "Daft Punk"), track("2", " daft punk "), track("3", "Elbow")]);
    expect(groups.map((g) => [g.name, g.tracks.map((t) => t.id)])).toEqual([
      ["Daft Punk", ["1", "2"]],
      ["Elbow", ["3"]],
    ]);
  });

  it("sorts A to Z without regard to case, with Unknown artist last", () => {
    const groups = artistsOf([track("1", ""), track("2", "zebra"), track("3", "Alpha"), track("4", "  ")]);
    expect(groups.map((g) => g.name)).toEqual(["Alpha", "zebra", "Unknown artist"]);
    expect(groups[2].tracks.map((t) => t.id)).toEqual(["1", "4"]);
  });

  it("has no groups for an empty library", () => {
    expect(artistsOf([])).toEqual([]);
  });
});

describe("likedTracks", () => {
  const library = [track("a", "A"), track("b", "B"), track("c", "C")];

  it("follows the order of the likes, newest first", () => {
    expect(likedTracks(library, ["c", "a"]).map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("skips a like whose song is no longer in the library", () => {
    expect(likedTracks(library, ["gone", "b"]).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("topTags", () => {
  const library = [track("1", "A", ["Dance", "chill"]), track("2", "A", ["dance"]), track("3", "A", ["rock", "rock", " "]), track("4", "A")];

  it("counts each song once per tag, case aside, most used first", () => {
    expect(topTags(library)).toEqual([
      { tag: "Dance", count: 2 },
      { tag: "chill", count: 1 },
      { tag: "rock", count: 1 },
    ]);
  });

  it("respects the limit", () => {
    expect(topTags(library, 1)).toEqual([{ tag: "Dance", count: 2 }]);
  });

  it("is empty with no tags", () => {
    expect(topTags([track("1", "A")])).toEqual([]);
  });
});
