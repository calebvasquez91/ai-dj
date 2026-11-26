import { describe, expect, it } from "vitest";
import { CLARIFYING_QUESTION, DEFAULT_TARGET_MINUTES, MAX_TARGET_MINUTES, parseRequestLocally, validateSpec, type CurationSpec } from "@/lib/curate/spec";
import { PROFILES, profileFromText } from "@/lib/curate/profiles";
import { eligibleTracks, explicitStatusOf, isHalloweenTrack } from "@/lib/curate/eligibility";
import { arcFit, arcTargets, estimateEnergies, orderByEnergyArc } from "@/lib/curate/energyArc";
import { SHORTFALL_RATIO, genreFit, scoreTrack, selectTracks, shortfallOf, wantsHalloween } from "@/lib/curate/select";
import { describeLocal, finishCuration, keyClashCount, refineOrder, selectForCuration, titleFromSpec, type PreviewTrack } from "@/lib/curate/curate";
import { camelotCompatibility } from "@/lib/camelot";
import type { GenreTag, GenreTagSource, Track } from "@/types/music";

const tag = (genre: string, confidence = 0.8, subgenre?: string, source: GenreTagSource = "musicbrainz"): GenreTag => ({ genre, ...(subgenre ? { subgenre } : {}), source, confidence, updatedAt: 1 });
let seq = 0;
const make = (over: Partial<Track> & { genres?: GenreTag[] }): Track => {
  const { genres, ...rest } = over;
  const id = rest.id ?? `t${++seq}`;
  return { id, title: id, artist: "Artist", durationSec: 200, addedAt: 0, source: "local", sourceUrl: `/api/tracks/${id}/audio`, genreTags: genres, genreStatus: genres ? "auto" : undefined, ...rest } as Track;
};
const bpmFrom = (t: Track) => ("bpm" in t ? ((t as { bpm?: number }).bpm ?? null) : null);
const spec = (over: Partial<CurationSpec> = {}): CurationSpec => ({ genres: [], subgenres: [], moods: [], ...over });

describe("reading a request locally", () => {
  it("reads the spec's own example: 90s R&B for a workout, clean only", () => {
    const { spec: s, clarification } = parseRequestLocally("90s R&B for a workout, clean only");
    expect(clarification).toBeNull();
    expect(s.genres).toEqual(["R&B"]);
    expect(s.eraRange).toEqual({ from: 1990, to: 1999 });
    expect(s.explicitPolicy).toBe("clean-only");
    expect(s.profile).toBe("workout");
    expect(s.moods).toContain("workout");
  });
  it("reads a late-night house request for a dinner party", () => {
    const { spec: s } = parseRequestLocally("late-night chill house for a dinner party");
    expect(s.subgenres).toContain("House");
    expect(s.genres).toEqual([]);
    expect(s.moods).toEqual(expect.arrayContaining(["chill", "late-night"]));
    expect(s.profile).toBe("dinner");
  });
  it("reads decades, spans, lengths, tempo windows and clean wording in their different forms", () => {
    expect(parseRequestLocally("80s rock").spec.eraRange).toEqual({ from: 1980, to: 1989 });
    expect(parseRequestLocally("2000s pop").spec.eraRange).toEqual({ from: 2000, to: 2009 });
    expect(parseRequestLocally("late 90s hip hop").spec.eraRange).toEqual({ from: 1996, to: 1999 });
    expect(parseRequestLocally("hip hop from 1995 to 2005").spec.eraRange).toEqual({ from: 1995, to: 2005 });
    expect(parseRequestLocally("an hour of jazz").spec.targetLengthMinutes).toBe(60);
    expect(parseRequestLocally("90 minutes of country").spec.targetLengthMinutes).toBe(90);
    expect(parseRequestLocally("2 hours of salsa").spec.targetLengthMinutes).toBe(120);
    expect(parseRequestLocally("house 120-128 bpm").spec.bpmRange).toEqual({ min: 120, max: 128 });
    for (const clean of ["rap, no explicit", "family friendly pop", "clean versions of rock", "radio-friendly pop"]) expect(parseRequestLocally(clean).spec.explicitPolicy, clean).toBe("clean-only");
    expect(parseRequestLocally("rap").spec.explicitPolicy).toBeUndefined();
  });
  it("finds a subgenre by its words, and keeps r&b whole", () => {
    expect(parseRequestLocally("trap bangers").spec.subgenres).toContain("Trap");
    expect(parseRequestLocally("drum and bass").spec.subgenres).toContain("Drum & Bass");
    expect(parseRequestLocally("neo soul").spec.subgenres).toContain("Neo-Soul");
    expect(parseRequestLocally("some r&b").spec.genres).toEqual(["R&B"]);
    // A subgenre asks for that subgenre alone, not every track of its parent genre.
    expect(parseRequestLocally("hard techno").spec).toMatchObject({ genres: [], subgenres: ["Techno"] });
    expect(parseRequestLocally("hip hop trap").spec).toMatchObject({ genres: ["Hip-Hop"], subgenres: ["Trap"] });
  });
  it("asks one clarifying question when the request names nothing usable", () => {
    for (const text of ["", "something good", "play me a thing", "the best songs ever"]) {
      const r = parseRequestLocally(text);
      expect(r.clarification, text).toBe(CLARIFYING_QUESTION);
    }
  });
});

describe("validateSpec", () => {
  it("accepts a spec on the taxonomy as it is", () => {
    const r = validateSpec({ genres: ["Hip-Hop"], subgenres: ["Trap"], moods: ["chill"], explicitPolicy: "clean-only", targetLengthMinutes: 60, profile: "workout", energyArc: "build" });
    expect(r.spec).toEqual({ genres: ["Hip-Hop"], subgenres: ["Trap"], moods: ["chill"], explicitPolicy: "clean-only", targetLengthMinutes: 60, profile: "workout", energyArc: "build" });
    expect(r.clarification).toBeNull();
    expect(r.notes).toEqual([]);
  });
  it("maps an unknown word to the nearest taxonomy node by alias, and says so", () => {
    const r = validateSpec({ genres: ["Rap", "hip hop", "drum and bass"], moods: ["mellow"] });
    expect(r.spec.genres).toEqual(["Hip-Hop"]);
    expect(r.spec.subgenres).toEqual(["Drum & Bass"]);
    expect(r.spec.moods).toEqual(["chill"]);
    expect(r.notes.join(" ")).toMatch(/"Rap" became Hip-Hop/);
  });
  it("drops what it cannot place, with a note, and never invents a genre", () => {
    const r = validateSpec({ genres: ["Polka Metal Fusion", "Rock"], subgenres: ["Zzz"], moods: ["angsty"] });
    expect(r.spec.genres).toEqual(["Rock"]);
    expect(r.spec.subgenres).toEqual([]);
    expect(r.spec.moods).toEqual([]);
    expect(r.notes).toHaveLength(3);
  });
  it("clamps lengths, years and tempos, and ignores junk", () => {
    const r = validateSpec({ genres: ["Rock"], targetLengthMinutes: 99999, eraRange: { from: 2005, to: 1995 }, bpmRange: { min: 10, max: 900 }, energyArc: "sideways", explicitPolicy: "maybe", profile: "nope" });
    expect(r.spec.targetLengthMinutes).toBe(MAX_TARGET_MINUTES);
    expect(r.spec.eraRange).toEqual({ from: 1995, to: 2005 });
    expect(r.spec.bpmRange).toEqual({ min: 40, max: 240 });
    expect(r.spec.energyArc).toBeUndefined();
    expect(r.spec.explicitPolicy).toBeUndefined();
    expect(r.spec.profile).toBeUndefined();
    expect(validateSpec({ genres: ["Rock"], targetLengthMinutes: 1 }).spec.targetLengthMinutes).toBeUndefined();
    expect(validateSpec({ genres: ["Rock"], bpmRange: { min: 100, max: 101 } }).spec.bpmRange).toBeUndefined();
  });
  it("is safe on anything", () => {
    for (const bad of [null, undefined, "x", 5, [], { genres: "Rock" }, { genres: [1, null] }]) {
      expect(() => validateSpec(bad)).not.toThrow();
      expect(validateSpec(bad).clarification).not.toBeNull();
    }
  });
  it("keeps the model's own question only when nothing was usable", () => {
    expect(validateSpec({ clarification: "Which decade?" }).clarification).toBe("Which decade?");
    expect(validateSpec({ genres: ["Rock"], clarification: "Which decade?" }).clarification).toBeNull();
  });
});

describe("profiles", () => {
  it("picks the occasion a request names", () => {
    expect(profileFromText("a workout mix")).toBe("workout");
    expect(profileFromText("music for a dinner party")).toBe("dinner");
    expect(profileFromText("late night drive")).toBe("chill");
    expect(profileFromText("jazz")).toBeNull();
    expect(PROFILES.workout.djMode).toBe("party");
  });
});

describe("which tracks may be used", () => {
  const rock = make({ genres: [tag("Rock")] });
  it("never uses a Do-Not-Play track", () => {
    const r = eligibleTracks([rock, make({ playPreference: "do-not", genres: [tag("Rock")] })], { explicitPolicy: "any", allowHalloween: false });
    expect(r.tracks).toEqual([rock]);
    expect(r.excluded.doNotPlay).toBe(1);
  });
  it("under clean-only, never uses an explicit track (by file advisory or by the person's tag), and counts the unknown ones", () => {
    const explicitFile = make({ explicit: "explicit" });
    const explicitTag = make({ tags: ["Explicit"], explicit: "clean" });
    const clean = make({ explicit: "clean" });
    const cleanTag = make({ tags: ["clean"], explicit: "explicit" });
    const unknown = make({});
    const r = eligibleTracks([explicitFile, explicitTag, clean, cleanTag, unknown], { explicitPolicy: "clean-only", allowHalloween: false });
    expect(r.tracks.map((t) => t.id)).toEqual([clean.id, cleanTag.id, unknown.id]);
    expect(r.excluded.explicit).toBe(2);
    expect(r.unknownRating).toBe(1);
    expect(eligibleTracks([explicitFile], { explicitPolicy: "any", allowHalloween: false }).tracks).toHaveLength(1);
  });
  it("knows a track's rating, the person's tag first", () => {
    expect(explicitStatusOf({})).toBe("unknown");
    expect(explicitStatusOf({ explicit: "clean" })).toBe("clean");
    expect(explicitStatusOf({ tags: ["explicit"], explicit: "clean" })).toBe("explicit");
  });
  it("keeps Halloween music out of every other playlist, however it is marked", () => {
    const tagged = make({ tags: ["halloween"] });
    const dark = make({ tags: ["Dark"] });
    const byGenre = make({ genres: [tag("Holiday", 0.9, "Halloween"), tag("Holiday", 0.9, "Halloween", "lastfm")] });
    const normal = make({ genres: [tag("Rock")] });
    expect([tagged, dark, byGenre].every(isHalloweenTrack)).toBe(true);
    expect(isHalloweenTrack(normal)).toBe(false);
    const r = eligibleTracks([tagged, dark, byGenre, normal], { explicitPolicy: "any", allowHalloween: false });
    expect(r.tracks).toEqual([normal]);
    expect(r.excluded.halloween).toBe(3);
    expect(eligibleTracks([tagged, byGenre, normal], { explicitPolicy: "any", allowHalloween: true }).tracks).toHaveLength(3);
  });
  it("only a request for Halloween music allows Halloween tracks", () => {
    expect(wantsHalloween(spec({ subgenres: ["Halloween"] }))).toBe(true);
    // Holiday music in general is not a request for Halloween: that stays in Spooky Music.
    expect(wantsHalloween(spec({ genres: ["Holiday"] }))).toBe(false);
    expect(wantsHalloween(spec({ genres: ["Rock"], moods: ["dark"] }))).toBe(false);
  });
});

describe("a named subgenre narrows its parent genre", () => {
  const trap = make({ id: "trap", genres: [tag("Hip-Hop", 0.9, "Trap")] });
  const boomBap = make({ id: "boomBap", genres: [tag("Hip-Hop", 0.9)] });
  const rock = make({ id: "rock", genres: [tag("Rock", 0.9)] });

  it("wants the subgenre, not every track of the genre, when both are named (what a model's reading of 'trap bangers' gives)", () => {
    const both = spec({ genres: ["Hip-Hop"], subgenres: ["Trap"] });
    expect(genreFit(trap, both)).toBeGreaterThan(0);
    expect(genreFit(boomBap, both)).toBe(0);
    expect(scoreTrack(boomBap, null, both)).toBeNull();
    expect(selectTracks(both, [trap, boomBap, rock], () => null).candidates.map((c) => c.track.id)).toEqual(["trap"]);
  });

  it("keeps a genre wide when none of its own subgenres is named", () => {
    expect(genreFit(boomBap, spec({ genres: ["Hip-Hop"] }))).toBeGreaterThan(0);
    // "rock and trap": Rock stays wide, Trap is the subgenre.
    const mixed = spec({ genres: ["Rock"], subgenres: ["Trap"] });
    expect(genreFit(rock, mixed)).toBeGreaterThan(0);
    expect(genreFit(trap, mixed)).toBeGreaterThan(0);
    expect(genreFit(boomBap, mixed)).toBe(0);
  });

  it("lets the shortfall offer to relax the subgenre, since it now really narrows", () => {
    const lib = [trap, boomBap, make({ id: "bb2", genres: [tag("Hip-Hop", 0.9)] })];
    const both = spec({ genres: ["Hip-Hop"], subgenres: ["Trap"], targetLengthMinutes: 10 });
    const sf = shortfallOf(both, lib, () => null, selectTracks(both, lib, () => null));
    expect(sf?.relaxations).toEqual([expect.objectContaining({ what: "subgenre", gain: 2 })]);
  });
});

describe("matching tracks to a request", () => {
  const rnb90 = (over: Partial<Track> = {}) => make({ genres: [tag("R&B", 0.85), tag("R&B", 0.8, undefined, "lastfm")], year: 1996, ...over });
  const s = spec({ genres: ["R&B"], eraRange: { from: 1990, to: 1999 } });

  it("requires the genre, so a track of another genre is never a match", () => {
    expect(scoreTrack(make({ genres: [tag("Rock", 0.9)] }), null, s)).toBeNull();
    expect(scoreTrack(make({}), null, s)).toBeNull();
    expect(scoreTrack(rnb90(), null, s)?.score).toBeGreaterThan(0.8);
  });
  it("requires the era when the year is known, and allows an unknown year at a lower score", () => {
    expect(scoreTrack(rnb90({ year: 2015 }), null, s)).toBeNull();
    expect(scoreTrack(rnb90({ year: 2000 }), null, s)?.score).toBeLessThan(scoreTrack(rnb90(), null, s)!.score);
    const unknown = scoreTrack(rnb90({ year: undefined }), null, s)!;
    expect(unknown.yearUnknown).toBe(true);
    expect(unknown.score).toBeLessThan(scoreTrack(rnb90(), null, s)!.score);
  });
  it("requires a tempo window only when the request gave one, counting half and double tempo", () => {
    const withBpm = spec({ genres: ["Electronic"], bpmRange: { min: 120, max: 130 } });
    const t = make({ genres: [tag("Electronic", 0.9)] });
    expect(scoreTrack(t, 125, withBpm)).not.toBeNull();
    expect(scoreTrack(t, 62, withBpm)).not.toBeNull();
    expect(scoreTrack(t, 90, withBpm)).toBeNull();
    expect(scoreTrack(t, null, withBpm)?.score).toBeGreaterThan(0);
  });
  it("prefers a track that matches the mood or is Must-Play, without requiring them, and requires a named subgenre", () => {
    const withMood = spec({ genres: ["R&B"], moods: ["chill"] });
    const a = make({ genres: [tag("R&B", 0.8)], moods: ["chill"] });
    const b = make({ genres: [tag("R&B", 0.8)], moods: ["party"] });
    expect(scoreTrack(a, null, withMood)!.score).toBeGreaterThan(scoreTrack(b, null, withMood)?.score ?? 0);
    const sub = spec({ genres: ["Hip-Hop"], subgenres: ["Trap"] });
    const trapTags = [tag("Hip-Hop", 0.8, "Trap"), tag("Hip-Hop", 0.8, "Trap", "lastfm")];
    // A plain Hip-Hop track is not a match once Trap is named.
    expect(scoreTrack(make({ genres: [tag("Hip-Hop", 0.8)] }), null, sub)).toBeNull();
    expect(scoreTrack(make({ genres: trapTags }), null, sub)).not.toBeNull();
    expect(scoreTrack(make({ genres: trapTags, playPreference: "must" }), null, sub)!.score).toBeGreaterThan(scoreTrack(make({ genres: trapTags }), null, sub)!.score);
  });
  it("matches a subgenre-only request on the subgenre", () => {
    const only = spec({ subgenres: ["Trap"] });
    expect(scoreTrack(make({ genres: [tag("Hip-Hop", 0.8, "Trap"), tag("Hip-Hop", 0.8, "Trap", "lastfm")] }), null, only)).not.toBeNull();
    expect(scoreTrack(make({ genres: [tag("Hip-Hop", 0.8)] }), null, only)).toBeNull();
  });
  it("a person's own genre decides a match over what the sources said", () => {
    const t = make({ genres: [tag("Rock", 0.9), tag("Rock", 0.9, undefined, "lastfm"), tag("Jazz", 1, undefined, "manual")] });
    expect(scoreTrack(t, null, spec({ genres: ["Jazz"] }))).not.toBeNull();
    expect(scoreTrack(t, null, spec({ genres: ["Rock"] }))).toBeNull();
  });
});

describe("selecting for a length, and not padding", () => {
  const library = [
    ...Array.from({ length: 5 }, (_, i) => make({ id: `rnb${i}`, genres: [tag("R&B", 0.85)], year: 1995, durationSec: 240 })),
    ...Array.from({ length: 8 }, (_, i) => make({ id: `rock${i}`, genres: [tag("Rock", 0.9)], year: 1995, durationSec: 240 })),
  ];

  it("stops at the length asked for", () => {
    const sel = selectTracks(spec({ genres: ["Rock"], targetLengthMinutes: 12 }), library, bpmFrom);
    expect(sel.chosen).toHaveLength(3);
    expect(sel.chosen.every((c) => c.track.id.startsWith("rock"))).toBe(true);
  });
  it("with too few matches, returns only what matches and a shortfall, never other genres", () => {
    const s = spec({ genres: ["R&B"], eraRange: { from: 1990, to: 1999 }, targetLengthMinutes: 60 });
    const sel = selectTracks(s, library, bpmFrom);
    expect(sel.chosen.map((c) => c.track.id).sort()).toEqual(["rnb0", "rnb1", "rnb2", "rnb3", "rnb4"]);
    const short = shortfallOf(s, library, bpmFrom, sel)!;
    expect(short.have).toBe(5);
    expect(short.message).toMatch(/^Only 5 matching tracks \(20 min of the 60 you asked for\)\./);
    expect(short.message).not.toMatch(/Rock/);
  });
  it("says what relaxing the era would add", () => {
    const lib = [...library, ...Array.from({ length: 4 }, (_, i) => make({ id: `old${i}`, genres: [tag("R&B", 0.85)], year: 1975, durationSec: 240 }))];
    const s = spec({ genres: ["R&B"], eraRange: { from: 1990, to: 1999 }, targetLengthMinutes: 60 });
    const short = shortfallOf(s, lib, bpmFrom, selectTracks(s, lib, bpmFrom))!;
    expect(short.relaxations).toEqual([{ what: "era", gain: 4, text: "Relaxing the era would add 4 tracks." }]);
    expect(short.message).toMatch(/Relaxing the era would add 4 tracks\./);
  });
  it("offers relaxing the era or clean-only when that would help", () => {
    const lib = [
      ...Array.from({ length: 4 }, (_, i) => make({ id: `a${i}`, genres: [tag("R&B", 0.85)], year: 1995, durationSec: 240 })),
      ...Array.from({ length: 6 }, (_, i) => make({ id: `b${i}`, genres: [tag("R&B", 0.85)], year: 1991, durationSec: 240, explicit: "explicit" })),
      ...Array.from({ length: 5 }, (_, i) => make({ id: `c${i}`, genres: [tag("R&B", 0.85)], year: 2008, durationSec: 240 })),
    ];
    const s = spec({ genres: ["R&B"], eraRange: { from: 1990, to: 1999 }, explicitPolicy: "clean-only", targetLengthMinutes: 90 });
    const sel = selectTracks(s, lib, bpmFrom);
    expect(sel.candidates).toHaveLength(4);
    const short = shortfallOf(s, lib, bpmFrom, sel)!;
    expect(short.relaxations.map((r) => r.what).sort()).toEqual(["clean", "era"]);
    expect(short.relaxations.find((r) => r.what === "clean")!.gain).toBe(6);
    expect(short.relaxations.find((r) => r.what === "era")!.gain).toBe(5);
    expect(short.relaxations[0].what).toBe("clean");
    expect(short.message).toMatch(/Relaxing clean-only would add 6 tracks/);
  });
  it("is no shortfall when the library covers the length", () => {
    const s = spec({ genres: ["Rock"], targetLengthMinutes: 20 });
    expect(shortfallOf(s, library, bpmFrom, selectTracks(s, library, bpmFrom))).toBeNull();
    expect(SHORTFALL_RATIO).toBeLessThan(1);
  });
  it("says so plainly when nothing matches", () => {
    const s = spec({ genres: ["Jazz"], targetLengthMinutes: 30 });
    const short = shortfallOf(s, library, bpmFrom, selectTracks(s, library, bpmFrom))!;
    expect(short.message).toMatch(/^No tracks in your library match/);
    expect(short.have).toBe(0);
  });
  it("gives the same tracks for the same request, and a seed only reshuffles near-ties", () => {
    const s = spec({ genres: ["Rock"], targetLengthMinutes: 12 });
    const ids = (seed?: number) => selectTracks(s, library, bpmFrom, seed).chosen.map((c) => c.track.id);
    expect(ids()).toEqual(ids());
    expect(ids(7)).toEqual(ids(7));
    expect(new Set([ids(1).join(), ids(2).join(), ids(3).join(), ids(4).join()]).size).toBeGreaterThan(1);
  });
  it("never uses a track that fails eligibility, even a perfect match", () => {
    const lib = [make({ id: "x", genres: [tag("Rock", 0.95)], explicit: "explicit" }), make({ id: "y", genres: [tag("Rock", 0.95)], tags: ["halloween"] }), make({ id: "z", genres: [tag("Rock", 0.95)], playPreference: "do-not" }), make({ id: "ok", genres: [tag("Rock", 0.6)] })];
    const sel = selectTracks(spec({ genres: ["Rock"], explicitPolicy: "clean-only" }), lib, bpmFrom);
    expect(sel.chosen.map((c) => c.track.id)).toEqual(["ok"]);
  });
});

describe("the energy plan", () => {
  it("estimates energy from loudness (by rank), tempo, or the genre when nothing is known", () => {
    const e = estimateEnergies([
      { id: "quiet", loudness: 0.1, bpm: null },
      { id: "mid", loudness: 0.3, bpm: null },
      { id: "loud", loudness: 0.6, bpm: null },
      { id: "fast", loudness: null, bpm: 175 },
      { id: "slow", loudness: null, bpm: 70 },
      { id: "metal", loudness: null, bpm: null, genre: "Metal" },
      { id: "unknown", loudness: null, bpm: null },
    ]);
    expect(e.get("quiet")!).toBeLessThan(e.get("mid")!);
    expect(e.get("mid")!).toBeLessThan(e.get("loud")!);
    expect(e.get("fast")!).toBeGreaterThan(0.9);
    expect(e.get("slow")!).toBe(0);
    expect(e.get("metal")!).toBeGreaterThan(0.8);
    expect(e.get("unknown")).toBe(0.5);
  });
  it("makes a build rise, a wind-down fall, a steady one flat and a peak a hump", () => {
    const build = arcTargets("build", 10);
    expect(build[9]).toBeGreaterThan(build[0]);
    const down = arcTargets("wind-down", 10);
    expect(down[0]).toBeGreaterThan(down[9]);
    expect(new Set(arcTargets("steady", 6)).size).toBe(1);
    const peak = arcTargets("peak", 11);
    expect(peak[5]).toBeGreaterThan(peak[0]);
    expect(peak[5]).toBeGreaterThan(peak[10]);
    expect(arcTargets("build", 0)).toEqual([]);
    expect(arcTargets("wave", 1)).toHaveLength(1);
    for (const arc of ["build", "steady", "peak", "wind-down", "wave"] as const) expect(arcTargets(arc, 20).every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  it("orders tracks along the arc, and a build ends louder than it starts", () => {
    const items = [0.9, 0.2, 0.5, 0.7, 0.3, 0.8, 0.4, 0.6].map((energy, i) => ({ id: `t${i}`, energy, bpm: null }));
    const ordered = orderByEnergyArc(items, "build");
    expect(ordered).toHaveLength(8);
    expect(new Set(ordered.map((o) => o.id)).size).toBe(8);
    expect(ordered[7].energy).toBeGreaterThan(ordered[0].energy);
    const fitBuild = arcFit(ordered.map((o) => o.energy), "build");
    const shuffledFit = arcFit(items.map((o) => o.energy), "build");
    expect(fitBuild).toBeLessThan(shuffledFit);
    expect(arcFit([], "build")).toBe(0);
  });
  it("prefers a small tempo jump between neighbours, counting half and double as no jump", () => {
    const items = [
      { id: "a", energy: 0.5, bpm: 120 },
      { id: "b", energy: 0.5, bpm: 60 },
      { id: "c", energy: 0.5, bpm: 95 },
    ];
    const ordered = orderByEnergyArc(items, "steady");
    const pos = (id: string) => ordered.findIndex((o) => o.id === id);
    expect(Math.abs(pos("a") - pos("b"))).toBe(1);
  });
  it("gives a different order for a different seed, and the same for the same", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, energy: 0.5 + (i % 3) * 0.01, bpm: null }));
    expect(orderByEnergyArc(items, "steady", 5).map((o) => o.id)).toEqual(orderByEnergyArc(items, "steady", 5).map((o) => o.id));
    expect(orderByEnergyArc(items, "steady", 5).map((o) => o.id)).not.toEqual(orderByEnergyArc(items, "steady", 99).map((o) => o.id));
  });
});

describe("curating end to end", () => {
  const library = [
    ...Array.from({ length: 12 }, (_, i) => make({ id: `rnb${i}`, title: `Song ${i}`, genres: [tag("R&B", 0.85), tag("R&B", 0.8, undefined, "lastfm")], year: 1990 + (i % 10), durationSec: 230, bpm: 90 + i * 5 } as Partial<Track>)),
    make({ id: "rnbExplicit", genres: [tag("R&B", 0.9), tag("R&B", 0.9, undefined, "lastfm")], year: 1997, explicit: "explicit", durationSec: 230 }),
    make({ id: "rnbHalloween", genres: [tag("R&B", 0.9), tag("R&B", 0.9, undefined, "lastfm")], year: 1997, tags: ["halloween"], durationSec: 230 }),
    make({ id: "rock", genres: [tag("Rock", 0.9)], year: 1994, durationSec: 230 }),
  ];
  const request = "90s R&B for a workout, clean only";
  const parsed = parseRequestLocally(request);
  const preview = () => {
    const inputs = { spec: { ...parsed.spec, targetLengthMinutes: 30 }, notes: parsed.notes, library, bpmOf: bpmFrom, loudnessOf: () => null };
    return finishCuration(inputs, selectForCuration(inputs));
  };

  it("returns a previewed playlist of matching tracks with an energy arc, and no explicit tracks", () => {
    const p = preview();
    expect(p.tracks.length).toBeGreaterThanOrEqual(7);
    expect(p.tracks.every((t) => t.id.startsWith("rnb") && t.id !== "rnbExplicit" && t.id !== "rnbHalloween")).toBe(true);
    expect(p.tracks.find((t) => t.id === "rock")).toBeUndefined();
    expect(p.arc).toBe("build");
    expect(p.profile).toBe("workout");
    expect(p.tracks.every((t) => t.energy >= 0 && t.energy <= 1)).toBe(true);
    expect(p.tracks[p.tracks.length - 1].energy).toBeGreaterThanOrEqual(p.tracks[0].energy);
    expect(p.title).toBe("90s R&B Workout");
    expect(p.description).toMatch(/R&B from 90s for a workout.*Clean tracks only/);
    expect(p.shortfall).toBeNull();
    expect(p.runtimeSec).toBe(p.tracks.length * 230);
  });
  it("counts the tracks with no content rating, since clean-only cannot know them", () => {
    expect(preview().unknownRating).toBe(preview().tracks.length);
  });
  it("shows a shortfall, and no padding, when the library is too small", () => {
    const inputs = { spec: { ...parsed.spec, targetLengthMinutes: 240 }, library, bpmOf: bpmFrom };
    const p = finishCuration(inputs, selectForCuration(inputs));
    expect(p.shortfall?.message).toMatch(/^Only \d+ matching tracks/);
    expect(p.tracks.find((t) => t.id === "rock")).toBeUndefined();
  });
  it("names a playlist from its spec", () => {
    expect(titleFromSpec(spec({ genres: ["Electronic"], subgenres: ["House"], moods: ["chill"] }))).toBe("Chill House");
    expect(titleFromSpec(spec({ genres: ["Hip-Hop", "R&B"] }))).toBe("Hip-Hop R&B");
    expect(titleFromSpec(spec({}))).toBe("Made by DJ");
    expect(titleFromSpec(spec({ genres: ["Rock"], eraRange: { from: 1985, to: 1995 } }))).toBe("1985–1995 Rock");
    expect(DEFAULT_TARGET_MINUTES).toBeGreaterThan(0);
    expect(describeLocal(spec({ genres: ["Rock"] }), 1, 600, "steady")).toMatch(/^1 track of Rock, about 10 minutes/);
  });
  it("uses a model's reply only when it is sound: same tracks, plain text", () => {
    const p = preview();
    const reversed = [...p.tracks].reverse().map((t) => t.id);
    const ok = refineOrder(p, { title: "Gym Throwbacks", description: "Sweaty 90s slow jams turned up.", order: reversed });
    expect(ok.title).toBe("Gym Throwbacks");
    expect(ok.tracks.map((t) => t.id)).toEqual(reversed);
    const addsOne = refineOrder(p, { order: [...reversed.slice(1), "rock"] });
    expect(addsOne.tracks.map((t) => t.id)).toEqual(p.tracks.map((t) => t.id));
    const repeats = refineOrder(p, { order: [...reversed.slice(1), reversed[1]] });
    expect(repeats.tracks.map((t) => t.id)).toEqual(p.tracks.map((t) => t.id));
    const dropsOne = refineOrder(p, { order: reversed.slice(1) });
    expect(dropsOne.tracks).toHaveLength(p.tracks.length);
    const markup = refineOrder(p, { title: "<b>Hi</b>", description: "x".repeat(500) });
    expect(markup.title).toBe(p.title);
    expect(markup.description).toBe(p.description);
    expect(refineOrder(p, null)).toEqual(p);
  });
});

describe("keys in the playlist order", () => {
  // Six equally energetic R&B songs, their keys interleaved between two far-apart groups of compatible keys (8A/8B/9A and 3A/3B/4A).
  const keys = ["8A", "3A", "8B", "3B", "9A", "4A"];
  const songs = keys.map((_, i) => make({ id: `k${i}`, genres: [tag("R&B", 0.85), tag("R&B", 0.8, undefined, "lastfm")], durationSec: 200, bpm: 100 } as Partial<Track>));
  const keyOf = new Map(songs.map((s, i) => [s.id, keys[i]]));
  const request = { spec: { genres: ["R&B"], subgenres: [], moods: [], energyArc: "steady" as const, targetLengthMinutes: 20 }, library: songs, bpmOf: bpmFrom, loudnessOf: () => null };
  const order = (extra: object = {}) => {
    const inputs = { ...request, ...extra };
    return finishCuration(inputs, selectForCuration(inputs)).tracks.map((t) => t.id);
  };
  const clashes = (ids: string[]) => ids.slice(1).filter((id, i) => camelotCompatibility(keyOf.get(ids[i]) ?? null, keyOf.get(id) ?? null) === 0).length;

  it("keeps compatible keys next to each other when the energy is the same, so the playlist clashes less", () => {
    const without = order();
    const withKeys = order({ camelotOf: (t: Track) => keyOf.get(t.id) ?? null });
    expect([...withKeys].sort()).toEqual([...without].sort()); // the same songs, only the order differs
    expect(clashes(withKeys)).toBeLessThan(clashes(without));
    expect(clashes(withKeys)).toBeLessThanOrEqual(2);
  });

  it("ignores keys when none is known: no camelotOf, or a camelotOf that knows nothing, gives the order it always gave", () => {
    expect(order({ camelotOf: () => null })).toEqual(order());
  });

  it("does not trade the energy arc for a key: songs whose energy sits where the arc wants it stay in that order, whatever their keys", () => {
    // Each song's energy (from its tempo, with no loudness) is exactly the arc's target for its place, so any reshuffle for the sake of a key would cost energy.
    const targets = arcTargets("build", songs.length);
    const onTarget = songs.map((_, i) => make({ id: `e${i}`, genres: [tag("R&B", 0.85), tag("R&B", 0.8, undefined, "lastfm")], durationSec: 200, bpm: 70 + 110 * targets[i] } as Partial<Track>));
    const keysFor = new Map(onTarget.map((s, i) => [s.id, keys[i]]));
    const inputs = { ...request, library: onTarget, spec: { ...request.spec, energyArc: "build" as const }, camelotOf: (t: Track) => keysFor.get(t.id) ?? null };
    const ids = finishCuration(inputs, selectForCuration(inputs)).tracks.map((t) => t.id);
    expect(ids).toEqual(onTarget.map((s) => s.id));
  });
});

describe("the model's reorder and the keys", () => {
  const t = (id: string, camelot: string | null | undefined): PreviewTrack => ({ id, title: id, artist: "A", durationSec: 200, energy: 0.5, bpm: 100, ...(camelot === undefined ? {} : { camelot }) });
  const preview = (tracks: PreviewTrack[]) => ({ title: "T", description: "D", tracks, runtimeSec: 0, arc: "steady" as const, profile: null, shortfall: null, unknownYear: 0, unknownRating: 0, notes: [], spec: { genres: [], subgenres: [], moods: [] } });
  // 8B fits 8A (relative) and 8A fits 9A (adjacent), but 8B and 9A do not fit each other; 3A fits none of them.
  const plan = preview([t("a", "8B"), t("b", "8A"), t("c", "9A"), t("far", "3A"), t("u", null)]);

  it("counts a clash only where both neighbours have a key and the keys do not fit", () => {
    expect(keyClashCount(plan.tracks)).toBe(1); // 9A -> 3A; 3A -> (no key) is not a clash
    expect(keyClashCount([t("x", undefined), t("y", undefined)])).toBe(0);
    expect(keyClashCount([])).toBe(0);
  });

  it("takes the model's reorder when it adds no key clash", () => {
    const reply = { order: ["c", "b", "a", "far", "u"], title: "Mellow" }; // 9A 8A 8B 3A: one clash, as before
    const out = refineOrder(plan, reply);
    expect(out.tracks.map((x) => x.id)).toEqual(["c", "b", "a", "far", "u"]);
    expect(out.title).toBe("Mellow");
  });

  it("ignores a reorder that adds a key clash, but still takes its title and description", () => {
    const reply = { order: ["a", "far", "b", "c", "u"], title: "Mellow", description: "Easy does it." }; // 8B 3A 8A 9A: two clashes
    const out = refineOrder(plan, reply);
    expect(out.tracks.map((x) => x.id)).toEqual(plan.tracks.map((x) => x.id));
    expect(out.title).toBe("Mellow");
    expect(out.description).toBe("Easy does it.");
  });

  it("does not care about keys when the preview carries none", () => {
    const bare = preview([t("a", undefined), t("b", undefined), t("c", undefined)]);
    expect(refineOrder(bare, { order: ["c", "b", "a"] }).tracks.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("finishCuration puts each song's key on its preview track only when keys were provided", () => {
    const songs = ["8A", "3A"].map((_, i) => make({ id: `p${i}`, genres: [tag("R&B", 0.85), tag("R&B", 0.8, undefined, "lastfm")], durationSec: 200, bpm: 100 } as Partial<Track>));
    const base = { spec: { genres: ["R&B"], subgenres: [], moods: [], targetLengthMinutes: 20 }, library: songs, bpmOf: bpmFrom, loudnessOf: () => null };
    const without = finishCuration(base, selectForCuration(base)).tracks;
    expect(without.every((x) => !("camelot" in x))).toBe(true);
    const keys = new Map([["p0", "8A"], ["p1", null as string | null]]);
    const withKeys = finishCuration({ ...base, camelotOf: (x: Track) => keys.get(x.id) ?? null }, selectForCuration(base)).tracks;
    expect(withKeys.find((x) => x.id === "p0")?.camelot).toBe("8A");
    expect(withKeys.find((x) => x.id === "p1")?.camelot).toBeNull();
  });
});

describe("preview tracks carry the metadata the model orders by", () => {
  const rnbTags = [tag("R&B", 0.85), tag("R&B", 0.8, undefined, "lastfm")];
  it("a song's moods and year are on its preview track when it has them, and absent when it has none", () => {
    const rich = make({ id: "rich", genres: rnbTags, durationSec: 200, bpm: 100, moods: ["sad", "chill"], year: 1994 } as Partial<Track>);
    const bare = make({ id: "bare", genres: rnbTags, durationSec: 200, bpm: 100 } as Partial<Track>);
    const inputs = { spec: { genres: ["R&B"], subgenres: [], moods: [], targetLengthMinutes: 20 }, library: [rich, bare], bpmOf: bpmFrom, loudnessOf: () => null };
    const tracks = finishCuration(inputs, selectForCuration(inputs)).tracks;
    expect(tracks.find((x) => x.id === "rich")).toMatchObject({ moods: ["sad", "chill"], year: 1994 });
    const plain = tracks.find((x) => x.id === "bare")!;
    expect("moods" in plain || "year" in plain).toBe(false);
  });
});
