import { describe, expect, it } from "vitest";
import { genreCredits, genreGradient, genreImage, genreSlug, type GenreImage } from "./genreArt";

const photo: GenreImage = { src: "/genre-art/hip-hop.jpg", credit: "Someone", source: "Unsplash", url: "https://unsplash.com/photos/x" };

describe("genreSlug", () => {
  it("makes a stable file-safe name", () => {
    expect(genreSlug("Hip-Hop")).toBe("hip-hop");
    expect(genreSlug("R&B")).toBe("r-and-b");
    expect(genreSlug("  Drum & Bass ")).toBe("drum-and-bass");
  });
});

describe("genreImage", () => {
  it("only returns a photo that is registered, so a card never asks for a file that is not there", () => {
    expect(genreImage("Jazz", {})).toBeNull();
    expect(genreImage("Hip-Hop", { "hip-hop": photo })).toBe(photo);
  });
});

describe("genreGradient", () => {
  it("is the same for the same genre and always a usable gradient", () => {
    expect(genreGradient("Rock")).toEqual(genreGradient("Rock"));
    expect(genreGradient("Rock").css).toMatch(/^linear-gradient\(135deg, hsl\(/);
  });
  it("keeps every genre inside the app's violet-to-cyan range (hue 170-300)", () => {
    for (const g of ["Hip-Hop", "Pop", "R&B", "Country", "Electronic", "Rock", "Alternative", "Disco", "Funk", "Soul", "Latin", "Jazz"]) {
      const hue = Number(/hsl\((\d+) /.exec(genreGradient(g).from)![1]);
      expect(hue, g).toBeGreaterThanOrEqual(170);
      expect(hue, g).toBeLessThan(300);
    }
  });
});

describe("genreCredits", () => {
  it("lists the registered photos for the Credits section, sorted", () => {
    expect(genreCredits({ rock: { ...photo, src: "/genre-art/rock.jpg" }, "hip-hop": photo }).map((c) => c.slug)).toEqual(["hip-hop", "rock"]);
    expect(genreCredits({})).toEqual([]);
  });
});
