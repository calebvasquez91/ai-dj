import { describe, expect, it } from "vitest";
import {
  FX_END_GUARD_SEC,
  findFxCues,
  fitFxToCue,
  fxRoleOf,
  placeFx,
  proposeFx,
  vocalOverlap,
  type FxCue,
} from "@/lib/fxCues";
import type { SongMap, SongSection } from "@/lib/song-map";
import type { VoiceMap } from "@/lib/voiceMap";
import type { FxSound } from "@/types/music";

/** 120 BPM: a beat every 0.5 s, a bar every 2 s. Intro 0-16, build 16-32, drop 32-64, breakdown 64-80, drop 80-112, outro 112-128. */
const BAR = 2;
function section(label: SongSection["label"], startSec: number, endSec: number, confidence = 0.8): SongSection {
  return { label, startSec, endSec, energy: 0.5, confidence };
}
function songMap(overrides: Partial<SongMap> = {}): SongMap {
  const durationSec = 128;
  const downbeats = Array.from({ length: durationSec / BAR }, (_, i) => i * BAR);
  return {
    version: 1,
    durationSec,
    bpm: 120,
    tempoConfidence: 0.9,
    beatsPerBar: 4,
    beats: Array.from({ length: durationSec * 2 }, (_, i) => i * 0.5),
    downbeatPhase: 0,
    downbeatConfidence: 0.9,
    downbeats,
    phrases: {
      bars8: downbeats.filter((_, i) => i % 8 === 0),
      bars16: downbeats.filter((_, i) => i % 16 === 0),
      bars32: downbeats.filter((_, i) => i % 32 === 0),
      confidence: 0.8,
    },
    sections: [
      section("intro", 0, 16),
      section("build", 16, 32),
      section("drop", 32, 64),
      section("breakdown", 64, 80),
      section("drop", 80, 112),
      section("outro", 112, 128),
    ],
    ...overrides,
  };
}

function fx(overrides: Partial<FxSound> & { name: string }): FxSound {
  return {
    id: overrides.name,
    fileName: `${overrides.name}.wav`,
    sourceUrl: `/fx/${overrides.name}`,
    mimeType: "audio/wav",
    category: "effect",
    durationSec: 4,
    tags: [],
    playlistAffinity: [],
    addedAt: 0,
    ...overrides,
  };
}

const find = (overrides: Partial<Parameters<typeof findFxCues>[0]> = {}) =>
  findFxCues({ songMap: songMap(), durationSec: 128, fromSec: 0, ...overrides });

describe("findFxCues", () => {
  it("finds a riser's run-up, the drops, the breakdown and the phrase turns", () => {
    const cues = find();
    const kinds = cues.map((c) => `${c.kind}@${c.atSec}`);
    expect(kinds).toContain("build@32");
    expect(kinds).toContain("drop@32");
    expect(kinds).toContain("breakdown@64");
    expect(kinds).toContain("drop@80");
    // No build before the second drop: a breakdown comes before it, not a build.
    expect(kinds).not.toContain("build@80");
    // Phrase accents only inside steady stretches, never on a section edge's own bar.
    expect(cues.filter((c) => c.kind === "phrase").length).toBe(0);
  });

  it("gives a build cue the whole build as its run-up, capped at 16 bars", () => {
    const cue = find().find((c) => c.kind === "build")!;
    expect(cue.roomSec).toBe(16); // build 16-32 s = 8 bars
    const long = find({
      songMap: songMap({ sections: [section("build", 0, 100), section("drop", 100, 128)] }),
    });
    // A 50-bar build still offers only 16 bars of run-up: no riser is 30+ s long.
    expect(long.find((c) => c.kind === "build")?.roomSec).toBe(32);
  });

  it("puts every cue on a bar line", () => {
    for (const cue of find()) expect(cue.atSec % BAR).toBe(0);
  });

  it("proposes nothing before the playhead, and nothing in the song's last stretch", () => {
    expect(find({ fromSec: 50 }).every((c) => c.atSec >= 50)).toBe(true);
    const late = find({ durationSec: 128 });
    expect(late.every((c) => c.atSec <= 128 - FX_END_GUARD_SEC)).toBe(true);
  });

  it("proposes nothing when the beat grid can't be trusted", () => {
    expect(find({ songMap: null })).toEqual([]);
    expect(find({ songMap: songMap({ downbeatConfidence: 0.1 }) })).toEqual([]);
    expect(find({ songMap: songMap({ tempoConfidence: 0.1 }) })).toEqual([]);
    expect(find({ songMap: songMap({ downbeats: [0, 2, 4] }) })).toEqual([]);
  });

  it("skips a section edge the bar grid doesn't agree with", () => {
    const off = songMap({ sections: [section("build", 10.1, 31.1), section("drop", 31.1, 64)], downbeats: Array.from({ length: 64 }, (_, i) => i * BAR + 0.9) });
    // Bar lines sit at x.9 s, the drop edge at 31.1 s is 0.2 s from 30.9: within a bar, so it is kept and snapped.
    expect(findFxCues({ songMap: off, durationSec: 128, fromSec: 0 }).some((c) => c.kind === "drop")).toBe(true);
    const far = songMap({ sections: [section("drop", 33, 64)], downbeats: Array.from({ length: 64 }, (_, i) => i * 10) });
    expect(findFxCues({ songMap: far, durationSec: 128, fromSec: 0 }).filter((c) => c.kind === "drop")).toEqual([]);
  });

  it("rates a cue lower with vocals on it and says so", () => {
    const voice: VoiceMap = { source: "stem", durationSec: 128, segments: [[20, 40]] };
    const clean = find().find((c) => c.kind === "build")!;
    const sung = find({ voiceMap: voice }).find((c) => c.kind === "build")!;
    expect(sung.vocalOverlap).toBeGreaterThan(0.5);
    expect(sung.quality).toBeLessThan(clean.quality);
    expect(sung.reason).toMatch(/vocals/);
  });

  it("rates a drop and a build level, and both above a breakdown", () => {
    const cues = find();
    const q = (kind: string) => cues.find((c) => c.kind === kind)!.quality;
    expect(q("drop")).toBeCloseTo(q("build"), 6);
    expect(q("build")).toBeGreaterThan(q("breakdown"));
  });

  it("gives each cue a stable id and the room after it", () => {
    const cues = find();
    expect(new Set(cues.map((c) => c.id)).size).toBe(cues.length);
    const breakdown = cues.find((c) => c.kind === "breakdown")!;
    expect(breakdown.spaceSec).toBe(16); // up to the next cue (the drop at 80 s)
  });
});

describe("vocalOverlap", () => {
  const voice: VoiceMap = { source: "lyrics", durationSec: 100, segments: [[10, 20], [30, 40]] };
  it("is the share of the window with a voice", () => {
    expect(vocalOverlap(voice, 10, 20)).toBe(1);
    expect(vocalOverlap(voice, 0, 20)).toBe(0.5);
    expect(vocalOverlap(voice, 15, 35)).toBeCloseTo(0.5);
    expect(vocalOverlap(voice, 50, 60)).toBe(0);
  });
  it("is 0 with no map or an empty window", () => {
    expect(vocalOverlap(null, 0, 10)).toBe(0);
    expect(vocalOverlap(voice, 10, 10)).toBe(0);
  });
});

describe("fxRoleOf", () => {
  const role = (name: string, durationSec = 4, tags: string[] = []) => fxRoleOf({ name, fileName: `${name}.wav`, tags, durationSec });
  it("reads the role from the name and tags", () => {
    expect(role("Epic Riser 01")).toBe("riser");
    expect(role("Reverse Cymbal")).toBe("riser");
    expect(role("Downlifter 128")).toBe("downlifter");
    expect(role("Sub Drop Impact", 3)).toBe("impact");
    expect(role("White Noise Sweep")).toBe("sweep");
    expect(role("Air Horn", 1)).toBe("hit");
    expect(role("Spooky Wind Atmos", 8)).toBe("texture");
    expect(role("whatever", 3, ["uplifter"])).toBe("riser");
  });
  it("calls a short texture-named sound a hit, and falls back on length", () => {
    expect(role("Ghost Scream", 1.2)).toBe("hit");
    expect(role("Ghost Scream", 6)).toBe("texture");
    expect(role("Sound 12", 1)).toBe("hit");
    expect(role("Sound 12", 9)).toBe("texture");
  });
  it("tells a downlifter from a riser", () => {
    expect(role("Down Sweep")).toBe("downlifter");
    expect(role("Up Sweep")).toBe("sweep");
  });
});

describe("placeFx", () => {
  const map = songMap();
  const cue = (overrides: Partial<FxCue>): FxCue => ({
    id: "c",
    kind: "build",
    atSec: 32,
    roomSec: 16,
    spaceSec: 16,
    quality: 1,
    vocalOverlap: 0,
    reason: "test",
    ...overrides,
  });

  it("ends a riser exactly on the bar line it leads into", () => {
    const placed = placeFx(fx({ name: "Riser", durationSec: 8 }), cue({}), map)!;
    expect(placed.placement.endSec).toBeCloseTo(32, 6);
    expect(placed.placement.startSec).toBeCloseTo(24, 6);
    expect(placed.placement.rate).toBeCloseTo(1, 6);
  });

  it("starts an impact on the bar line", () => {
    const placed = placeFx(fx({ name: "Big Impact", durationSec: 3 }), cue({ kind: "drop" }), map)!;
    expect(placed.placement.startSec).toBe(32);
  });

  it("starts a downlifter on the breakdown's bar line", () => {
    const placed = placeFx(fx({ name: "Downlifter", durationSec: 6 }), cue({ kind: "breakdown", atSec: 64 }), map)!;
    expect(placed.placement.startSec).toBe(64);
    expect(placed.placement.endSec).toBeCloseTo(70, 6);
  });

  it("matches a sound's BPM to the song's, within a turntable's range", () => {
    // A 4 s riser at 125 BPM on a 120 BPM song plays 4% slower, so it lasts 4 / 0.96 s.
    const placed = placeFx(fx({ name: "Riser", durationSec: 4, bpm: 125 }), cue({}), map)!;
    expect(placed.placement.tempoMatched).toBe(true);
    expect(placed.placement.rate).toBeCloseTo(120 / 125, 6);
    expect(placed.placement.endSec - placed.placement.startSec).toBeCloseTo(4 / (120 / 125), 6);
    expect(placed.placement.endSec).toBeCloseTo(32, 6);
  });

  it("folds a double or half tempo, and refuses a tempo out of reach", () => {
    const half = placeFx(fx({ name: "Riser", durationSec: 4, bpm: 60 }), cue({}), map)!;
    expect(half.placement.rate).toBeCloseTo(1, 6);
    expect(placeFx(fx({ name: "Riser", durationSec: 4, bpm: 140 }), cue({}), map)).toBeNull();
  });

  it("stretches a no-BPM riser up to 10% to fill whole bars, and otherwise leaves it alone", () => {
    const fits = placeFx(fx({ name: "Riser", durationSec: 7.6 }), cue({}), map)!; // nearest whole bars: 4 bars = 8 s, 5% off
    expect(fits.placement.barFit).toBe(true);
    expect(fits.placement.endSec - fits.placement.startSec).toBeCloseTo(8, 6);
    const odd = placeFx(fx({ name: "Riser", durationSec: 5.2 }), cue({}), map)!; // 3 bars = 6 s is 15% away
    expect(odd.placement.barFit).toBe(false);
    expect(odd.placement.rate).toBe(1);
    expect(odd.placement.endSec).toBeCloseTo(32, 6);
  });

  it("still fits a riser exactly as long as its run-up when the measured bar lines put the room a few ms short", () => {
    // Seen live: a 4-bar riser (8.000 s) against a build whose measured bar lines left 7.999 s of run-up.
    const placed = placeFx(fx({ name: "Riser", durationSec: 8 }), cue({ roomSec: 7.999 }), map);
    expect(placed).not.toBeNull();
    expect(placed!.placement.endSec).toBeCloseTo(32, 6);
    // ...but not a sound clearly too long for the room.
    expect(placeFx(fx({ name: "Riser", durationSec: 8 }), cue({ roomSec: 7.8 }), map)).toBeNull();
  });

  it("scores an unstretched bar-fit riser as a full fit, and a stretched one lower", () => {
    const buildCue = cue({ roomSec: 16 });
    const exact = fitFxToCue(fx({ name: "Riser", durationSec: 8 }), buildCue, map)!;
    const stretched = fitFxToCue(fx({ name: "Riser", durationSec: 8.7 }), buildCue, map)!; // 4 bars = 8 s: 8% off
    expect(exact.score).toBeGreaterThan(stretched.score);
  });

  it("refuses a sound that is longer than the room it needs", () => {
    expect(placeFx(fx({ name: "Riser", durationSec: 12 }), cue({ roomSec: 6 }), map)).toBeNull();
    expect(placeFx(fx({ name: "Big Impact", durationSec: 12 }), cue({ kind: "drop", spaceSec: 4 }), map)).toBeNull();
  });

  it("refuses a role that has no place at that kind of moment", () => {
    expect(placeFx(fx({ name: "Riser", durationSec: 4 }), cue({ kind: "drop" }), map)).toBeNull();
    expect(placeFx(fx({ name: "Big Impact", durationSec: 2 }), cue({ kind: "build" }), map)).toBeNull();
  });
});

describe("fitFxToCue", () => {
  const map = songMap();
  const buildCue = find().find((c) => c.kind === "build")!;

  it("scores a riser that fills the run-up above one that fills a sliver of it", () => {
    const full = fitFxToCue(fx({ name: "Riser", durationSec: 16 }), buildCue, map)!;
    const short = fitFxToCue(fx({ name: "Riser", durationSec: 2 }), buildCue, map)!;
    expect(full.score).toBeGreaterThan(short.score);
  });

  it("scores a tempo-matched sound above a stretched one", () => {
    const exact = fitFxToCue(fx({ name: "Riser", durationSec: 8, bpm: 120 }), buildCue, map)!;
    const off = fitFxToCue(fx({ name: "Riser", durationSec: 8, bpm: 129 }), buildCue, map)!;
    expect(exact.score).toBeGreaterThan(off.score);
  });

  it("explains itself", () => {
    expect(fitFxToCue(fx({ name: "Riser", durationSec: 8, bpm: 120 }), buildCue, map)!.reason).toMatch(/riser.*tempo-matched/);
  });
});

describe("proposeFx", () => {
  const map = songMap();
  const cues = find();
  const pool = [
    fx({ name: "Riser A", durationSec: 8 }),
    fx({ name: "Riser B", durationSec: 16 }),
    fx({ name: "Big Impact", durationSec: 2.5 }),
    fx({ name: "Downlifter", durationSec: 6 }),
    fx({ name: "Air Horn", durationSec: 1 }),
  ];
  const propose = (overrides: Partial<Parameters<typeof proposeFx>[0]> = {}) =>
    proposeFx({ cues, pool, songMap: map, frequency: "frequent", random: () => 0, ...overrides });

  it("proposes sounds that suit their moments, in song order", () => {
    const proposals = propose();
    expect(proposals.length).toBeGreaterThan(0);
    const starts = proposals.map((p) => p.placement.startSec);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const p of proposals) {
      if (p.kind === "build") expect(["riser", "sweep"]).toContain(p.role);
      if (p.kind === "drop") expect(["impact", "hit"]).toContain(p.role);
      if (p.kind === "breakdown") expect(["downlifter", "sweep", "texture", "hit"]).toContain(p.role);
    }
  });

  it("puts a riser that fills the build ahead of an impact on the same bar line", () => {
    const proposals = proposeFx({ cues: find(), pool, songMap: map, frequency: "frequent", random: () => 0 });
    const atFirstDrop = proposals.find((p) => p.cueId === "build@32.00" || p.cueId === "drop@32.00")!;
    expect(atFirstDrop.role).toBe("riser");
    expect(atFirstDrop.placement.endSec).toBeCloseTo(32, 6);
  });

  it("never overlaps two sounds, keeps the spacing, and takes one sound per moment", () => {
    const proposals = propose();
    for (let i = 1; i < proposals.length; i++) {
      expect(proposals[i].placement.startSec).toBeGreaterThanOrEqual(proposals[i - 1].placement.endSec);
      expect(proposals[i].placement.startSec - proposals[i - 1].placement.startSec).toBeGreaterThanOrEqual(30);
    }
    const buildAndDrop = proposals.filter((p) => p.cueId === "build@32.00" || p.cueId === "drop@32.00");
    expect(buildAndDrop.length).toBeLessThanOrEqual(1);
  });

  it("is quieter on Occasional than on Frequent, and silent when off", () => {
    expect(propose({ frequency: "occasional" }).length).toBeLessThanOrEqual(3);
    expect(propose({ frequency: "occasional" }).length).toBeLessThanOrEqual(propose({ frequency: "frequent" }).length);
    expect(propose({ frequency: "off" })).toEqual([]);
  });

  it("proposes nothing without a usable grid, a pool or cues", () => {
    expect(propose({ songMap: null })).toEqual([]);
    expect(propose({ pool: [] })).toEqual([]);
    expect(propose({ cues: [] })).toEqual([]);
  });

  it("leaves out sounds that fit nothing", () => {
    const proposals = propose({ pool: [fx({ name: "Sound", durationSec: 3, bpm: 150 })] });
    expect(proposals).toEqual([]);
  });

  it("avoids a sound heard lately when another fits nearly as well, but still uses it if it is the only fit", () => {
    const two = [fx({ name: "Riser A", durationSec: 8 }), fx({ name: "Riser B", durationSec: 8 })];
    const riserCues = cues.filter((c) => c.kind === "build");
    const first = proposeFx({ cues: riserCues, pool: two, songMap: map, frequency: "frequent", random: () => 0, recentFxIds: ["Riser A"] });
    expect(first[0].fxId).toBe("Riser B");
    const only = proposeFx({ cues: riserCues, pool: [two[0]], songMap: map, frequency: "frequent", random: () => 0, recentFxIds: ["Riser A"] });
    expect(only[0].fxId).toBe("Riser A");
  });

  it("alternates between near-equal sounds as the dice change, but a clearly better sound wins", () => {
    const two = [fx({ name: "Riser A", durationSec: 8 }), fx({ name: "Riser B", durationSec: 8 })];
    const riserCues = cues.filter((c) => c.kind === "build");
    const pickWith = (value: number) => proposeFx({ cues: riserCues, pool: two, songMap: map, frequency: "frequent", random: () => value })[0].fxId;
    expect(new Set([pickWith(0), pickWith(0.99)]).size).toBe(2);
    const lopsided = [fx({ name: "Riser A", durationSec: 16 }), fx({ name: "Riser B", durationSec: 2 })];
    const strong = (value: number) => proposeFx({ cues: riserCues, pool: lopsided, songMap: map, frequency: "frequent", random: () => value })[0].fxId;
    expect(strong(0)).toBe("Riser A");
  });
});
