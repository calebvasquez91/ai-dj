import { describe, expect, it } from "vitest";
import { VOCABULARY, readVocabulary, vocabularyPrompt, wordsOf } from "./vocabulary";
import { parseRequestLocally } from "./spec";
import { isProfileId } from "./profiles";
import { isMoodId } from "@/lib/moodTags";
import { scoreTrack } from "./select";
import { MOOD_ENERGY, moodEnergyTarget, proxyEnergy } from "./moodEnergy";
import { parseRequestWithLlm } from "./llmSpec";
import type { CurationSpec } from "./spec";
import type { Track } from "@/types/music";

const read = (text: string) => readVocabulary(wordsOf(text), text.toLowerCase());
const parse = (text: string) => parseRequestLocally(text);

describe("the vocabulary itself", () => {
  it("only names moods and occasions the app has, and every phrase is real words", () => {
    for (const entry of VOCABULARY) {
      expect(entry.moods.length).toBeGreaterThan(0);
      for (const m of entry.moods) expect(isMoodId(m), `${entry.from}: ${m}`).toBe(true);
      if (entry.profile) expect(isProfileId(entry.profile), entry.from).toBe(true);
      for (const p of entry.phrases) expect(wordsOf(p).length, p).toBeGreaterThan(0);
    }
  });

  it("gives no phrase two meanings", () => {
    const seen = new Map<string, string>();
    for (const entry of VOCABULARY) {
      for (const p of entry.phrases) {
        expect(seen.has(p), `"${p}" is in both ${seen.get(p)} and ${entry.from}`).toBe(false);
        seen.set(p, entry.from);
      }
    }
  });

  it("covers the owner's own playlists: Get You Pumped, Vibes & Wine Down, Parties & BBQ, Car Tunes, Sad & Mellow, Childhood, Lovey Dovey", () => {
    const from = new Set(VOCABULARY.map((e) => e.from.replace(/ \(.*\)$/, "")));
    for (const name of ["Get You Pumped", "Vibes & Wine Down", "Parties & BBQ", "Car Tunes", "Sad & Mellow", "Childhood", "Lovey Dovey"]) expect(from.has(name), name).toBe(true);
  });

  it("keeps accented letters and hyphenated words whole, with no invisible characters in the source", () => {
    expect(wordsOf("Lo-Fi caf" + String.fromCharCode(0xe9) + " R&B")).toEqual(["lo-fi", "caf" + String.fromCharCode(0xe9), "r&b"]);
  });

  it("is shown to the model as lines of wording -> moods and occasion", () => {
    const prompt = vocabularyPrompt();
    expect(prompt).toContain('"wine down"');
    expect(prompt).toMatch(/-> moods: chill, dinner; occasion: chill/);
    expect(prompt).toMatch(/not when the request is about classical music/);
  });
});

describe("reading the vocabulary in a request", () => {
  it("finds a phrase, its moods and the words it used", () => {
    const r = read("songs to wine down to");
    expect(r.moods).toEqual(["chill", "dinner"]);
    expect(r.profile).toBe("chill");
    expect(r.hits).toEqual([{ phrase: "wine down", moods: ["chill", "dinner"] }]);
    expect(r.remainder).toBe("songs to to");
  });

  it("the longest phrase wins: 'late night drive' is a drive at night, not a late night", () => {
    expect(read("late night drive").moods).toEqual(["road-trip", "late-night"]);
  });

  it("leaves 'romantic' alone beside a classical word", () => {
    expect(read("romantic dinner").moods).toEqual(["romantic"]);
    expect(read("romantic era piano").moods).toEqual([]);
    expect(read("romantic composers").moods).toEqual([]);
  });

  it("reads nothing in a request that uses none of it", () => {
    const r = read("90s r&b for a workout");
    expect(r.hits).toEqual([]);
    expect(r.moods).toEqual([]);
  });
});

describe("what the local reader makes of everyday wording", () => {
  it("'high energy' is the energetic mood, never the Hi-NRG subgenre; 'hi-nrg' as a genre still is one", () => {
    const high = parse("high energy workout").spec;
    expect(high.subgenres).toEqual([]);
    expect(high.moods).toContain("energetic");
    expect(high.profile).toBe("workout");
    expect(parse("hi-nrg classics").spec.subgenres).toContain("Hi-NRG");
  });

  it("'low energy' is chill, not the opposite", () => {
    expect(parse("low energy").spec.moods).toEqual(["chill"]);
  });

  it("'mellow' is the chill mood, never the Easy Listening genre; 'easy listening' still is one", () => {
    const mellow = parse("something mellow").spec;
    expect(mellow.genres).toEqual([]);
    expect(mellow.moods).toEqual(["chill"]);
    expect(parse("easy listening").spec.genres).toContain("Easy Listening");
  });

  it("'romantic dinner' is a mood and an occasion, not a classical period; 'romantic era classical' still is one", () => {
    const dinner = parse("romantic dinner").spec;
    expect(dinner.subgenres).toEqual([]);
    expect(dinner.moods).toEqual(["romantic", "dinner"]);
    const classical = parse("romantic era classical").spec;
    expect(classical.moods).not.toContain("romantic");
    expect(classical.genres.length + classical.subgenres.length).toBeGreaterThan(0);
  });

  it("builds a playlist from the owner's own playlist wording instead of asking a question", () => {
    for (const request of ["pump up music", "wine down", "vibes and wine down", "rainy day", "songs to cry to", "something from my childhood", "lovey dovey", "slow dance", "sunday morning", "backyard bbq", "car tunes", "sad and mellow"]) {
      const result = parse(request);
      expect(result.clarification, request).toBeNull();
      expect(result.spec.moods.length, request).toBeGreaterThan(0);
    }
  });

  it("says in plain words what it read a phrase as, but not when the wording is the mood itself", () => {
    expect(parse("wine down").notes).toContain('Read "wine down" as chill and dinner.');
    expect(parse("romantic dinner").notes.some((n) => n.startsWith("Read "))).toBe(false);
  });

  it("an occasion named in so many words wins over the vocabulary's: 'wine down for a dinner party' is a dinner party, 'after work wind down' is not focus", () => {
    expect(parse("wine down for a dinner party").spec.profile).toBe("dinner");
    expect(parse("after work wind down").spec.profile).toBe("chill");
    expect(parse("bbq").spec.profile).toBe("party");
  });

  it("does not change a request that uses none of the vocabulary", () => {
    const { spec, notes } = parse("90s R&B for a workout, clean only");
    expect(spec.genres).toEqual(["R&B"]);
    expect(spec.eraRange).toEqual({ from: 1990, to: 1999 });
    expect(spec.explicitPolicy).toBe("clean-only");
    expect(spec.profile).toBe("workout");
    expect(notes.some((n) => n.startsWith("Read "))).toBe(false);
  });
});

describe("a mood that implies an energy prefers songs that fit it", () => {
  const track = (genre?: string): Track => ({ id: genre ?? "none", title: "T", artist: "A", durationSec: 200, addedAt: 0, source: "local", sourceUrl: "", ...(genre ? { genre, genreTags: [] } : {}) }) as Track;
  const spec = (over: Partial<CurationSpec> = {}): CurationSpec => ({ genres: [], subgenres: [], moods: ["energetic"], ...over });
  const score = (t: Track, bpm: number | null, s: CurationSpec) => scoreTrack(t, bpm, s)?.score ?? 0;

  it("a high-energy request prefers a metal song to a folk one, and a low-energy request the reverse", () => {
    expect(score(track("Metal"), null, spec())).toBeGreaterThan(score(track("Folk"), null, spec()));
    expect(score(track("Folk"), null, spec({ moods: ["chill"] }))).toBeGreaterThan(score(track("Metal"), null, spec({ moods: ["chill"] })));
  });

  it("uses the tempo when it is known, ahead of the genre", () => {
    expect(score(track("Folk"), 170, spec())).toBeGreaterThan(score(track("Metal"), 70, spec()));
  });

  it("a song with neither a genre nor a tempo is neutral: above a clear mismatch, below a match", () => {
    const s = spec();
    expect(score(track(), null, s)).toBeGreaterThan(score(track("Folk"), null, s));
    expect(score(track(), null, s)).toBeLessThan(score(track("Metal"), null, s));
  });

  it("does nothing for moods that say nothing about energy, and can be turned off", () => {
    const romantic = spec({ moods: ["romantic"] });
    expect(score(track("Metal"), null, romantic)).toBe(score(track("Folk"), null, romantic));
    // a clear mismatch (folk for "energetic") is left out when the request names nothing else; with the energy fit off it is as good as any song
    expect(scoreTrack(track("Folk"), null, spec())).toBeNull();
    const off = scoreTrack(track("Folk"), null, spec(), { useEnergy: false })!.score;
    expect(off).toBe(scoreTrack(track("Metal"), null, spec(), { useEnergy: false })!.score);
  });

  it("proxyEnergy and the mood table", () => {
    expect(proxyEnergy(180, "Folk")).toBeGreaterThan(proxyEnergy(70, "Metal")!);
    expect(proxyEnergy(null, "Metal")).toBeGreaterThan(proxyEnergy(null, "Folk")!);
    expect(proxyEnergy(null, undefined)).toBeNull();
    expect(proxyEnergy(null, "Not A Genre")).toBeNull();
    expect(moodEnergyTarget(["workout", "party"])).toBeCloseTo(0.825);
    expect(moodEnergyTarget(["nostalgic"])).toBeNull();
    for (const m of Object.keys(MOOD_ENERGY)) expect(isMoodId(m), m).toBe(true);
  });
});

describe("the model that reads requests is shown the vocabulary", () => {
  it("sends it with the taxonomy and tells the model never to read 'high energy' as a genre", async () => {
    let body: { system: { text: string }[] } | null = null;
    const fetcher = async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ content: [] }));
    };
    await parseRequestWithLlm("wine down", { fetcher, apiKey: () => "K" });
    const text = body!.system.map((b) => b.text).join("\n");
    expect(text).toContain("Vocabulary (wording -> moods and occasion):");
    expect(text).toContain('"wine down"');
    expect(text).toMatch(/never the Hi-NRG subgenre/);
  });
});
