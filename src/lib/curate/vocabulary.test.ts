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

  it("covers pumping up, an evening wind-down, parties and barbecues, driving, sad and mellow, childhood throwbacks and love songs", () => {
    const from = new Set(VOCABULARY.map((e) => e.from));
    for (const group of ["pump-up wording", "evening wind-down wording", "party and barbecue wording", "car and driving wording", "sad and mellow wording", "childhood and throwback wording", "love and slow-dance wording"]) expect(from.has(group), group).toBe(true);
  });

  it("names no personal playlist: the source is public", () => {
    const all = VOCABULARY.map((e) => e.from).join(" ");
    for (const name of ["Get You Pumped", "Wine Down", "Parties & BBQ", "Car Tunes", "Sad & Mellow", "Lovey Dovey"]) expect(all).not.toContain(name);
  });

  it("keeps accented letters and hyphenated words whole, with no invisible characters in the source", () => {
    expect(wordsOf("Lo-Fi caf" + String.fromCharCode(0xe9) + " R&B")).toEqual(["lo-fi", "caf" + String.fromCharCode(0xe9), "r&b"]);
  });

  it("is shown to the model whole: every phrase the local reader knows, not just the first few of each entry", () => {
    const prompt = vocabularyPrompt();
    for (const entry of VOCABULARY) for (const phrase of entry.phrases) expect(prompt, phrase).toContain(`"${phrase}"`);
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

  it("'hi-energy' and 'hi energy' are the dance genre's spelling and are left to the genre reader; 'high energy' is the mood", () => {
    for (const request of ["80s hi-energy", "hi energy dance"]) {
      const spec = parse(request).spec;
      expect(spec.subgenres, request).toContain("Hi-NRG");
      expect(spec.moods, request).not.toContain("energetic");
    }
    expect(parse("high-energy").spec.moods).toContain("energetic");
  });

  it("'romantic' next to the word 'era' or 'period' in an ordinary request is still the mood; only classical words (or 'romantic era') make it a period", () => {
    for (const request of ["romantic 80s era slow songs", "romantic songs from the disco era", "romantic motown period"]) {
      const spec = parse(request).spec;
      expect(spec.moods, request).toContain("romantic");
      expect(spec.subgenres, request).not.toContain("Romantic"); // not the classical period (a genre named elsewhere in the request, like disco, is still read)
    }
    for (const request of ["romantic era classical", "romantic period music", "romantic piano"]) expect(parse(request).spec.moods, request).not.toContain("romantic");
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

  it("does not count a song's tempo twice: once the occasion's tempo window or a named tempo has scored it, the energy fit goes by genre", () => {
    const workout = spec({ moods: ["workout"], profile: "workout" }); // the workout window (110-175 BPM) scores the tempo
    expect(score(track("Metal"), 120, workout)).toBe(score(track("Metal"), 170, workout)); // both inside the window: the tempo no longer moves the energy part
    const named = spec({ moods: ["energetic"], bpmRange: { min: 100, max: 180 } });
    expect(score(track("Metal"), 120, named)).toBe(score(track("Metal"), 170, named));
    // with no window and no named tempo the tempo still counts, as before
    expect(score(track("Metal"), 170, spec({ moods: ["energetic"] }))).toBeGreaterThan(score(track("Metal"), 120, spec({ moods: ["energetic"] })));
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
