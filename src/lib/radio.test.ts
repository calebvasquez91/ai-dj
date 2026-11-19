import { describe, expect, it } from "vitest";
import {
  buildRadioQueue,
  enforceArtistSpacing,
  isLoneSongPlay,
  nextRadioBatch,
  radioCandidates,
  RADIO_MAX_ARTIST_RUN,
  RADIO_MIN_AHEAD,
  RADIO_MIN_MATCHES,
  radioNeedsMore,
  radioProfile,
  radioScore,
  type RadioFacts,
} from "./radio";
import type { Track } from "@/types/music";

let n = 0;
function song(over: Partial<Track> & { facts?: RadioFacts } = {}): Track & { facts: RadioFacts } {
  const id = over.id ?? `s${++n}`;
  const { facts, ...rest } = over;
  return {
    id,
    title: id,
    artist: `artist ${n % 20}`,
    durationSec: 200,
    addedAt: 0,
    source: "local",
    sourceUrl: `x/${id}`,
    genre: "Hip-Hop",
    subgenres: ["Trap"],
    moods: ["late-night"],
    facts: facts ?? { bpm: 140, camelot: "8A", energy: 0.7 },
    ...rest,
  } as Track & { facts: RadioFacts };
}
const factsOf = (t: Track) => (t as Track & { facts?: RadioFacts }).facts ?? { bpm: null, camelot: null, energy: null };
const opts = { factsOf };
const many = (count: number, over: Partial<Track> & { facts?: RadioFacts } = {}) => Array.from({ length: count }, () => song(over));

describe("radioScore", () => {
  const seed = song({ id: "seed", artist: "Seed Artist" });
  const sf = factsOf(seed);
  const none = new Set<string>();
  it("scores a close match well above a poor one", () => {
    const close = song({ artist: "Other" });
    const far = song({ artist: "Other", genre: "Country", subgenres: [], moods: ["sleep"], facts: { bpm: 80, camelot: "3B", energy: 0.1 } });
    expect(radioScore(seed, sf, close, factsOf(close), none)).toBeGreaterThan(0.85);
    expect(radioScore(seed, sf, far, factsOf(far), none)).toBeLessThan(0.3);
  });
  it("treats half and double tempo as a match", () => {
    const half = song({ artist: "Other", facts: { bpm: 70, camelot: "8A", energy: 0.7 } });
    const same = song({ artist: "Other" });
    expect(radioScore(seed, sf, half, factsOf(half), none)).toBeCloseTo(radioScore(seed, sf, same, factsOf(same), none), 5);
  });
  it("boosts the same artist and a similar artist, the same artist most", () => {
    const base = song({ artist: "Nobody", facts: { bpm: 100, camelot: "3B", energy: 0.3 } });
    const same = song({ artist: "Seed Artist", facts: { bpm: 100, camelot: "3B", energy: 0.3 } });
    const sim = song({ artist: "Friend Of Seed", facts: { bpm: 100, camelot: "3B", energy: 0.3 } });
    const similar = new Set(["friend of seed"]);
    const b = radioScore(seed, sf, base, factsOf(base), similar);
    expect(radioScore(seed, sf, same, factsOf(same), similar)).toBeGreaterThan(radioScore(seed, sf, sim, factsOf(sim), similar));
    expect(radioScore(seed, sf, sim, factsOf(sim), similar)).toBeGreaterThan(b);
  });
  it("does not punish a song with nothing known about its tempo, key or energy", () => {
    const blank = song({ artist: "Other", facts: { bpm: null, camelot: null, energy: null } });
    expect(radioScore(seed, sf, blank, factsOf(blank), none)).toBeGreaterThan(0.6);
  });
});

describe("radioCandidates: only songs the rules allow", () => {
  const seed = song({ id: "seed" });
  it("never includes the seed, a Do-Not-Play song, Halloween music or (under clean-only) an explicit song", () => {
    const ok = song({ id: "ok" });
    const doNot = song({ id: "dn", playPreference: "do-not" });
    const spooky = song({ id: "sp", tags: ["halloween"] });
    const explicit = song({ id: "ex", explicit: "explicit" });
    const lib = [seed, ok, doNot, spooky, explicit];
    expect(radioCandidates(seed, lib, opts).map((c) => c.track.id).sort()).toEqual(["ex", "ok"]);
    expect(radioCandidates(seed, lib, { ...opts, explicitPolicy: "clean-only" }).map((c) => c.track.id)).toEqual(["ok"]);
  });
  it("leaves out songs already played or queued", () => {
    const a = song({ id: "a" });
    const b = song({ id: "b" });
    expect(radioCandidates(seed, [a, b], { ...opts, exclude: new Set(["a"]) }).map((c) => c.track.id)).toEqual(["b"]);
  });
  it("ranks the better matches first", () => {
    const good = song({ id: "good" });
    const worse = song({ id: "worse", genre: "Pop", subgenres: [], facts: { bpm: 150, camelot: "9A", energy: 0.6 } });
    expect(radioCandidates(seed, [worse, good], opts).map((c) => c.track.id)[0]).toBe("good");
  });
});

describe("enforceArtistSpacing", () => {
  it("never lets one artist play more than twice in a row", () => {
    const items = [...Array(5)].map((_, i) => ({ artist: "A", id: `a${i}` })).concat([{ artist: "B", id: "b0" }, { artist: "C", id: "c0" }]);
    const out = enforceArtistSpacing(items);
    let run = 1;
    for (let i = 1; i < out.length; i++) {
      run = out[i].artist === out[i - 1].artist ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(RADIO_MAX_ARTIST_RUN);
    }
  });
  it("leaves out songs that can never fit, instead of breaking the rule", () => {
    const out = enforceArtistSpacing([{ artist: "A" }, { artist: "A" }, { artist: "A" }, { artist: "A" }]);
    expect(out).toHaveLength(2);
  });
  it("counts the artists already at the end of the queue", () => {
    const out = enforceArtistSpacing([{ artist: "A", id: 1 }, { artist: "B", id: 2 }], [{ artist: "A" }, { artist: "A" }]);
    expect(out[0].artist).toBe("B");
  });
  it("ignores case and punctuation in artist names", () => {
    const out = enforceArtistSpacing([{ artist: "The Weeknd" }, { artist: "the weeknd!" }, { artist: "THE WEEKND" }, { artist: "Drake" }]);
    // two by the same artist (however it is written), then Drake, then the third: never three in a row
    expect(out.map((o) => /weeknd/i.test(o.artist))).toEqual([true, true, false, true]);
  });
});

describe("buildRadioQueue and nextRadioBatch", () => {
  const seed = song({ id: "seed", artist: "Seed Artist" });
  const lib = [seed, ...many(60)];

  it("queues a batch of good matches with no repeats, not the seed, and artist spacing", () => {
    const { tracks, enough } = buildRadioQueue(seed, lib, opts);
    expect(enough).toBe(true);
    expect(tracks.length).toBeGreaterThanOrEqual(RADIO_MIN_AHEAD);
    expect(new Set(tracks.map((t) => t.id)).size).toBe(tracks.length);
    expect(tracks.some((t) => t.id === "seed")).toBe(false);
    let run = 1;
    for (let i = 1; i < tracks.length; i++) {
      run = tracks[i].artist === tracks[i - 1].artist ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(RADIO_MAX_ARTIST_RUN);
    }
  });

  it("tops up from the rest of the library without repeating anything already queued or played", () => {
    const first = buildRadioQueue(seed, lib, opts).tracks;
    const seen = new Set(first.map((t) => t.id));
    const more = nextRadioBatch(seed, lib, { ...opts, exclude: seen }, [first[first.length - 1]]).tracks;
    expect(more.length).toBeGreaterThan(0);
    for (const t of more) expect(seen.has(t.id)).toBe(false);
  });

  it("never queues a Do-Not-Play, Halloween or (clean-only) explicit song, however well it matches", () => {
    const bad = [song({ id: "dn", playPreference: "do-not" }), song({ id: "sp", tags: ["spooky"] }), song({ id: "ex", explicit: "explicit" })];
    const { tracks } = buildRadioQueue(seed, [...lib, ...bad], { ...opts, explicitPolicy: "clean-only" });
    for (const id of ["dn", "sp", "ex"]) expect(tracks.some((t) => t.id === id)).toBe(false);
  });

  it("says there are not enough matches, rather than padding with weak ones, for a library that has few", () => {
    const small = [seed, ...many(RADIO_MIN_MATCHES - 3), ...many(20, { genre: "Country", subgenres: [], moods: ["sleep"], facts: { bpm: 70, camelot: "3B", energy: 0.1 } })];
    const { tracks, enough } = buildRadioQueue(seed, small, opts);
    expect(enough).toBe(false);
    expect(tracks.every((t) => t.genre === "Hip-Hop")).toBe(true);
  });

  it("works from a seed with no analysis at all", () => {
    const blank = song({ id: "blank", facts: { bpm: null, camelot: null, energy: null } });
    expect(buildRadioQueue(blank, [blank, ...many(30)], opts).tracks.length).toBeGreaterThan(0);
  });
});

describe("radioProfile, radioNeedsMore, isLoneSongPlay", () => {
  it("picks the occasion from the energy of the seed", () => {
    expect(radioProfile(0.9)).toBe("party");
    expect(radioProfile(0.2)).toBe("chill");
    expect(radioProfile(0.5)).toBe("open");
    expect(radioProfile(null)).toBe("open");
  });
  it("wants more once fewer than ten songs are queued", () => {
    expect(radioNeedsMore(RADIO_MIN_AHEAD)).toBe(false);
    expect(radioNeedsMore(RADIO_MIN_AHEAD - 1)).toBe(true);
    expect(radioNeedsMore(0)).toBe(true);
  });
  it("starts a radio only for one song played on its own, not from a playlist or a list", () => {
    expect(isLoneSongPlay([{}], null)).toBe(true);
    expect(isLoneSongPlay([{}], "playlist-1")).toBe(false);
    expect(isLoneSongPlay([{}, {}], null)).toBe(false);
    expect(isLoneSongPlay([], undefined)).toBe(false);
  });
});
