import { describe, expect, it } from "vitest";
import {
  PLAYLIST_MOODS,
  artistKeys,
  buildLibraryIndex,
  fillStatement,
  libraryMoods,
  matchLibrary,
  parseLibraryJsonl,
  planFill,
  titleKey,
  variantTokens,
  type LibraryRow,
} from "./djLibrary";
import { isMoodId } from "./moodTags";
import { MAX_MOODS_KEPT } from "./genre/stored";

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: "T001",
  playlist: "Workouts",
  title: "A Song",
  artist: "An Artist",
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

describe("reading the list", () => {
  const line = (o: object) => JSON.stringify(o);

  it("reads a song per line, with its moods as a list", () => {
    const { rows, skipped } = parseLibraryJsonl(
      line({ id: "T001", playlist: "Get You Pumped", title: "Raining Blood", artist: "Slayer", moods: "aggressive,intense, dark", year: 1986, energy: 10 }) + "\n"
    );
    expect(skipped).toBe(0);
    expect(rows).toEqual([row({ id: "T001", playlist: "Get You Pumped", title: "Raining Blood", artist: "Slayer", moods: ["aggressive", "intense", "dark"], year: 1986, energy: 10 })]);
  });

  it("reads the list's genre, tempo, key, rating and length, keeping only values that make sense", () => {
    const { rows } = parseLibraryJsonl(
      line({ id: "T1", title: "A", artist: "B", genre: "Metal", subGenre: "Thrash Metal", bpm: 210, camelot: "7a", explicit: true, durationSec: 254.4 }) + "\n" +
        line({ id: "T2", title: "A", artist: "B", bpm: 5, camelot: "13A", explicit: "yes", durationSec: -3 })
    );
    expect(rows[0]).toMatchObject({ genre: "Metal", subGenre: "Thrash Metal", bpm: 210, camelot: "7A", explicit: true, durationSec: 254 });
    expect(rows[1]).toMatchObject({ genre: "", subGenre: "", bpm: null, camelot: null, explicit: null, durationSec: null });
  });

  it("ignores blank lines, counts bad ones, and never throws", () => {
    const text = [line({ id: "T1", title: "A", artist: "B" }), "", "not json", line({ id: "T2", title: "", artist: "B" }), line([1, 2]), "null"].join("\r\n");
    const { rows, skipped } = parseLibraryJsonl(text);
    expect(rows.map((r) => r.id)).toEqual(["T1"]);
    expect(skipped).toBe(4);
  });

  it("reads a file that starts with a byte order mark, so its first song is not lost", () => {
    const { rows, skipped } = parseLibraryJsonl("﻿" + line({ id: "T001", title: "Raining Blood", artist: "Slayer" }) + "\n" + line({ id: "T002", title: "B", artist: "C" }));
    expect(rows.map((r) => r.id)).toEqual(["T001", "T002"]);
    expect(skipped).toBe(0);
  });

  it("takes a year or an energy only when it is a sane number", () => {
    const { rows } = parseLibraryJsonl(line({ id: "T1", title: "A", artist: "B", year: null, energy: 11 }) + "\n" + line({ id: "T2", title: "A", artist: "B", year: "1999", energy: "5" }));
    expect(rows.every((r) => r.year === null && r.energy === null)).toBe(true);
  });
});

describe("comparing titles and artists", () => {
  it("takes the noise out of a title: brackets, edit tails, feat., accents, case and punctuation", () => {
    const want = titleKey("Welcome to the Jungle");
    expect(titleKey("Welcome To The Jungle (Clean)")).toBe(want);
    expect(titleKey("Mr. Brightside (JPTheDJ Slam Edit) (Clean Short Edit)")).toBe(titleKey("Mr. Brightside"));
    expect(titleKey("Hot N Cold - Radio Edit")).toBe(titleKey("Hot N Cold"));
    expect(titleKey("Aminé Song feat. Someone")).toBe(titleKey("Amine Song"));
    expect(titleKey("(Any Masego song)")).toBe("");
  });

  it("splits an artist line into its artists, main one first, and drops 'Unknown Artist'", () => {
    expect(artistKeys("Drake ft. Tems")).toEqual(["drake", "tems"]);
    expect(artistKeys("PARTYNEXTDOOR & Drake")).toEqual(["partynextdoor", "drake"]);
    expect(artistKeys("Guns N' Roses")).toEqual(["gunsnroses"]);
    expect(artistKeys("Unknown Artist")).toEqual([]);
    expect(artistKeys("&LEZ & Robin M")).toEqual(["lez", "robinm"]);
  });

  it("leaves out a bracketed note in the artist line", () => {
    expect(artistKeys("Everything but the Girl (Todd Terry Remix)")).toEqual(["everythingbutthegirl"]);
    expect(artistKeys("Terror Squad (Fat Joe & Remy Ma)")).toEqual(["terrorsquad"]);
  });

  it("keeps accented letters and dashes working without invisible characters in the source", () => {
    expect(titleKey("Amé – Radio Edit")).toBe(titleKey("Ame"));
    expect(titleKey("Beyoncé — Live")).toBe(titleKey("Beyonce"));
  });

  it("sees a remix, a mashup, a cover, a live or acoustic take, but not a clean, dirty, radio or instrumental edit", () => {
    expect([...variantTokens("Caroline (Rey Santana Remix) (Dirty Short Edit)")]).toEqual(["remix"]);
    expect([...variantTokens("Cooped Up / Return of the Mack (Mashup)")]).toEqual(["mashup"]);
    expect([...variantTokens("Song (Live at Wembley)")]).toEqual(["live"]);
    expect(variantTokens("Passionfruit (Instrumental)").size).toBe(0);
    expect(variantTokens("Forever (Quick Hit Dirty)").size).toBe(0);
  });
});

describe("which uploaded songs are on the list", () => {
  const index = buildLibraryIndex([
    row({ id: "T1", title: "Passionfruit", artist: "Drake" }),
    row({ id: "T2", title: "Paradise", artist: "Sade" }),
    row({ id: "T3", title: "CN Tower", artist: "Drake & PartyNextDoor" }),
    row({ id: "T4", title: "Savage (Remix)", artist: "Megan Thee Stallion ft. Beyoncé" }),
    row({ id: "T5", title: "Zombie", artist: "The Cranberries" }),
    row({ id: "T6", title: "(Any Masego song)", artist: "Masego" }),
    row({ id: "T7", title: "Caroline", artist: "Aminé" }),
  ]);
  const ids = (title: string, artist: string) => matchLibrary({ title, artist }, index).map((r) => r.id);

  it("matches a clean, dirty or instrumental edit of the same song", () => {
    expect(ids("Passionfruit (Instrumental)", "Drake")).toEqual(["T1"]);
    expect(ids("Passionfruit (Clean)", "Drake")).toEqual(["T1"]);
  });

  it("matches when the artists are listed in another order or style", () => {
    expect(ids("CN TOWER (Dirty)", "PARTYNEXTDOOR & Drake")).toEqual(["T3"]);
    expect(ids("Caroline", "Amine")).toEqual(["T7"]);
  });

  it("does not match a different artist's song of the same name, or an unknown artist", () => {
    expect(ids("Paradise (Clean Radio Edit)", "&LEZ & Robin M")).toEqual([]);
    expect(ids("Zombie", "Unknown Artist")).toEqual([]);
  });

  it("a remix and an original never match each other, in either direction; a remix matches a list row that is that remix", () => {
    expect(ids("Caroline (Rey Santana Remix) (Dirty Short Edit)", "Aminé")).toEqual([]);
    expect(ids("Savage (Remix)", "Megan Thee Stallion")).toEqual(["T4"]);
    expect(ids("Savage", "Megan Thee Stallion")).toEqual([]);
  });

  it("an act joined with '&' is one name: a solo artist does not match it, the act (in any order) does", () => {
    const acts = buildLibraryIndex([
      row({ id: "B1", title: "Layla", artist: "Derek & The Dominos" }),
      row({ id: "B2", title: "Blinding", artist: "Drake & PartyNextDoor" }),
      row({ id: "B3", title: "Missing", artist: "Everything but the Girl (Todd Terry Remix)" }),
      row({ id: "B4", title: "Forever", artist: "Drake ft. Tems" }),
    ]);
    const found = (title: string, artist: string) => matchLibrary({ title, artist }, acts).map((r) => r.id);
    expect(found("Layla", "Derek")).toEqual([]);
    expect(found("Layla", "Derek & The Dominos")).toEqual(["B1"]);
    expect(found("Blinding", "PARTYNEXTDOOR & Drake")).toEqual(["B2"]);
    expect(found("Blinding", "Drake")).toEqual([]);
    expect(found("Missing", "Everything But The Girl")).toEqual(["B3"]);
    expect(found("Forever (Quick Hit Dirty)", "Drake")).toEqual(["B4"]);
  });

  it("has nothing to match a placeholder row against", () => {
    expect(ids("Tadow", "Masego")).toEqual([]);
    expect(index.has("")).toBe(false);
  });
});

describe("the moods a song gets", () => {
  it("maps the list's own words onto the app's moods and drops what does not map", () => {
    const moods = libraryMoods([row({ moods: ["aggressive", "intense", "dark", "headbang"] })]);
    expect(moods.slice(0, 3)).toEqual(["aggressive", "energetic", "dark"]);
    expect(moods.every(isMoodId)).toBe(true);
  });

  it("uses the playlist's mood only for a song whose own words gave none, never next to them", () => {
    expect(libraryMoods([row({ playlist: "Sad & Mellow", moods: ["swagger"] })])).toEqual(["sad"]);
    expect(libraryMoods([row({ playlist: "Lovey Dovey", moods: [] })])).toEqual(["romantic"]);
    expect(libraryMoods([row({ playlist: "Lovey Dovey", moods: ["anthemic", "catchy"] })])).toEqual(["uplifting"]);
    expect(libraryMoods([row({ playlist: "Parties & BBQ", moods: ["party", "swagger"] })])).toEqual(["party"]);
    expect(libraryMoods([row({ playlist: "Not A Playlist", moods: [] })])).toEqual([]);
  });

  it("joins the rows of a song that is in more than one playlist, and keeps at most the cap", () => {
    const many = ["chill", "party", "workout", "romantic", "sad", "happy", "dark"];
    expect(libraryMoods([row({ moods: many })]).length).toBe(MAX_MOODS_KEPT);
    const twice = libraryMoods([row({ playlist: "Workouts", moods: ["dreamy"] }), row({ playlist: "Lovey Dovey", moods: ["hazy", "swagger"] })]);
    expect(twice).toEqual(["dreamy"]);
    const bare = libraryMoods([row({ playlist: "Workouts", moods: ["swagger"] }), row({ playlist: "Lovey Dovey", moods: [] })]);
    expect(bare).toEqual(["workout", "romantic"]);
  });

  it("only uses moods that are on the app's list", () => {
    for (const moods of Object.values(PLAYLIST_MOODS)) expect(moods.every(isMoodId)).toBe(true);
  });
});

describe("what is filled in", () => {
  const rows = [row({ playlist: "Workouts", moods: ["hype"], year: 2008 })];

  it("fills moods and year when the song has neither", () => {
    expect(planFill({ moods: [], year: null }, rows)).toEqual({ moods: ["energetic"], year: 2008 });
  });

  it("never touches moods or a year the song already has", () => {
    expect(planFill({ moods: ["chill"], year: 1999 }, rows)).toEqual({});
    expect(planFill({ moods: ["chill"], year: null }, rows)).toEqual({ year: 2008 });
    expect(planFill({ moods: [], year: 1999 }, rows)).toEqual({ moods: ["energetic"] });
  });

  it("uses a year only when every row that has one agrees, and skips it when they do not", () => {
    const agree = [row({ year: 2016 }), row({ year: 2016 }), row({ year: null })];
    const differ = [row({ year: 2016 }), row({ year: 2023 })];
    expect(planFill({ moods: ["chill"], year: null }, agree)).toEqual({ year: 2016 });
    expect(planFill({ moods: ["chill"], year: null }, differ)).toEqual({});
  });

  it("has nothing to add when the list knows neither", () => {
    expect(planFill({ moods: [], year: null }, [row({ playlist: "?", moods: ["swagger"] })])).toEqual({});
  });
});

describe("the SQL", () => {
  it("writes moods only while they are still empty and the year only while it is missing, so it can be run twice", () => {
    const sql = fillStatement("cmabc", { moods: ["party", "dark"], year: 1999 })!;
    expect(sql).toContain(`"moodsJson" = CASE WHEN "moodsJson" = '[]' THEN '["party","dark"]' ELSE "moodsJson" END`);
    expect(sql).toContain(`"year" = COALESCE("year", 1999)`);
    expect(sql).toMatch(/WHERE "trackId" = 'cmabc';$/);
    expect(sql).not.toMatch(/INSERT|DELETE|DROP/i);
  });

  it("returns null when there is nothing to write, and never writes a made-up mood", () => {
    expect(fillStatement("cmabc", {})).toBeNull();
    expect(fillStatement("cmabc", { moods: ["not-a-mood"] })).toBeNull();
    expect(fillStatement("cmabc", { moods: ["party", "swagger"] })).toContain(`'["party"]'`);
  });

  it("escapes a quote in the id", () => {
    expect(fillStatement("a'b", { year: 2001 })).toContain(`'a''b'`);
  });
});
