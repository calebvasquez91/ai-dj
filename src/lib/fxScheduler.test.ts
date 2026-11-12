import { describe, expect, it } from "vitest";
import {
  FX_MIN_LEAD_SEC,
  FX_PREFETCH_AHEAD_SEC,
  FX_SCHEDULE_AHEAD_SEC,
  buildFxPlan,
  nextFxToSchedule,
  planFromReview,
  type PlannedFx,
} from "@/lib/fxScheduler";
import type { SongMap, SongSection } from "@/lib/song-map";
import type { FxSound } from "@/types/music";

const BAR = 2; // 120 BPM

function section(label: SongSection["label"], startSec: number, endSec: number): SongSection {
  return { label, startSec, endSec, energy: 0.5, confidence: 0.8 };
}
function songMap(): SongMap {
  const durationSec = 200;
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
    phrases: { bars8: [], bars16: [], bars32: [], confidence: 0.8 },
    sections: [section("intro", 0, 40), section("build", 40, 64), section("drop", 64, 110), section("breakdown", 110, 130), section("drop", 130, 180), section("outro", 180, 200)],
  };
}
function fx(name: string, durationSec: number, extra: Partial<FxSound> = {}): FxSound {
  return { id: name, name, fileName: `${name}.wav`, sourceUrl: `/fx/${name}`, mimeType: "audio/wav", category: "effect", durationSec, tags: [], playlistAffinity: [], addedAt: 0, ...extra };
}
const pool = [fx("Riser", 8), fx("Big Impact", 3), fx("Downlifter", 6)];

const args = { title: "Song", songMap: songMap(), durationSec: 200, fromSec: 0, frequency: "frequent" as const, spooky: false, pool };

describe("buildFxPlan", () => {
  it("builds the candidates for the DJ and the effects each would become", () => {
    const built = buildFxPlan(args)!;
    expect(built.input.candidates.length).toBeGreaterThan(0);
    expect(built.input.bpm).toBe(120);
    for (const c of built.input.candidates) {
      const item = built.byId.get(c.id)!;
      expect(item.startSec).toBe(c.startSec);
      expect(item.fx.name).toBe(c.fxName);
    }
  });

  it("starts proposing a few seconds after the playhead, never before it", () => {
    const built = buildFxPlan({ ...args, fromSec: 100 })!;
    expect(built.input.candidates.every((c) => c.startSec >= 100)).toBe(true);
  });

  it("returns null when there is nothing to choose", () => {
    expect(buildFxPlan({ ...args, songMap: null })).toBeNull();
    expect(buildFxPlan({ ...args, pool: [] })).toBeNull();
    expect(buildFxPlan({ ...args, pool: [fx("Riser", 8, { bpm: 150 })] })).toBeNull(); // out of the song's tempo reach
    expect(buildFxPlan({ ...args, fromSec: 195 })).toBeNull();
  });
});

describe("planFromReview", () => {
  it("turns the picks into effects in song order, with the DJ's note when it gave one", () => {
    const built = buildFxPlan(args)!;
    const ids = built.input.candidates.map((c) => c.id);
    const planned = planFromReview(built, { picks: [{ id: ids[ids.length - 1], note: "the last" }, { id: ids[0], note: "" }] });
    expect(planned.map((p) => p.id)).toEqual([ids[0], ids[ids.length - 1]].sort((a, b) => built.byId.get(a)!.startSec - built.byId.get(b)!.startSec));
    expect(planned.find((p) => p.id === ids[ids.length - 1])?.note).toBe("the last");
    expect(planned.find((p) => p.id === ids[0])?.note).toBe(built.byId.get(ids[0])!.note); // no DJ note: the engineer's reason
  });

  it("drops picks that aren't candidates and picks that break the rules", () => {
    const built = buildFxPlan(args)!;
    const ids = built.input.candidates.map((c) => c.id);
    expect(planFromReview(built, { picks: [{ id: "ghost", note: "" }] })).toEqual([]);
    expect(planFromReview(built, { picks: [] })).toEqual([]);
    expect(planFromReview(built, { picks: ids.map((id) => ({ id, note: "" })) }).length).toBeLessThanOrEqual(6);
  });
});

describe("nextFxToSchedule", () => {
  const item = (id: string, startSec: number): PlannedFx => ({
    id,
    fx: fx(id, 3),
    role: "impact",
    cueKind: "drop",
    startSec,
    endSec: startSec + 3,
    rate: 1,
    note: "",
  });
  const plan = [item("a", 64), item("b", 130)];

  it("schedules an effect that is due within a few seconds, with the delay on the clock", () => {
    const d = nextFxToSchedule(plan, 62, new Set());
    expect(d.schedule?.item.id).toBe("a");
    expect(d.schedule?.delaySec).toBeCloseTo(2);
  });

  it("divides the song-time distance by the deck's speed", () => {
    expect(nextFxToSchedule(plan, 62, new Set(), 2).schedule?.delaySec).toBeCloseTo(1);
    expect(nextFxToSchedule(plan, 62, new Set(), 0).schedule?.delaySec).toBeCloseTo(2); // a bad rate is read as 1
  });

  it("waits while an effect is further away, and asks for it to be decoded when it is coming", () => {
    const far = nextFxToSchedule(plan, 20, new Set());
    expect(far.schedule).toBeNull();
    expect(far.prefetch).toBeNull(); // 44 s away
    const coming = nextFxToSchedule(plan, 50, new Set());
    expect(coming.schedule).toBeNull();
    expect(coming.prefetch?.id).toBe("a"); // 14 s away
  });

  it("skips an effect that is past or too close to start cleanly", () => {
    expect(nextFxToSchedule(plan, 64.2, new Set()).schedule).toBeNull();
    expect(nextFxToSchedule(plan, 64 - FX_MIN_LEAD_SEC + 0.01, new Set()).schedule).toBeNull();
    expect(nextFxToSchedule(plan, 64 - FX_MIN_LEAD_SEC - 0.01, new Set()).schedule?.item.id).toBe("a");
  });

  it("does not schedule one twice, and moves on to the next", () => {
    expect(nextFxToSchedule(plan, 62, new Set(["a"])).schedule).toBeNull();
    expect(nextFxToSchedule(plan, 128, new Set(["a"])).schedule?.item.id).toBe("b");
  });

  it("uses the documented windows", () => {
    expect(nextFxToSchedule(plan, 64 - FX_SCHEDULE_AHEAD_SEC, new Set()).schedule?.item.id).toBe("a");
    expect(nextFxToSchedule(plan, 64 - FX_SCHEDULE_AHEAD_SEC - 0.1, new Set()).schedule).toBeNull();
    expect(nextFxToSchedule(plan, 64 - FX_PREFETCH_AHEAD_SEC, new Set()).prefetch?.id).toBe("a");
    expect(nextFxToSchedule(plan, 64 - FX_PREFETCH_AHEAD_SEC - 1, new Set()).prefetch).toBeNull();
  });

  it("handles an empty plan", () => {
    expect(nextFxToSchedule([], 10, new Set())).toEqual({ schedule: null, prefetch: null });
  });
});

describe("buildFxPlan for a re-plan", () => {
  it("leaves out proposals too close to an effect already played", () => {
    const fresh = buildFxPlan(args)!;
    const first = fresh.input.candidates[0];
    const replanned = buildFxPlan({ ...args, prior: [{ startSec: first.startSec, endSec: first.endSec }] });
    const ids = replanned ? replanned.input.candidates.map((c) => c.id) : [];
    expect(ids).not.toContain(first.id);
    for (const c of replanned?.input.candidates ?? []) expect(Math.abs(c.startSec - first.startSec)).toBeGreaterThanOrEqual(30);
    expect(replanned?.input.prior).toEqual([{ startSec: first.startSec, endSec: first.endSec }]);
  });

  it("returns null when the song has already had all the effects it may", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ startSec: 1000 + i * 100, endSec: 1003 + i * 100 }));
    expect(buildFxPlan({ ...args, prior: six })).toBeNull();
    // Occasional allows 3, so three already played also stops it.
    expect(buildFxPlan({ ...args, frequency: "occasional", prior: six.slice(0, 3) })).toBeNull();
    expect(buildFxPlan({ ...args, frequency: "occasional", prior: six.slice(0, 2) })).not.toBeNull();
  });

  it("applies a pick to the cap left after the prior effects", () => {
    const built = buildFxPlan({ ...args, frequency: "occasional", prior: [{ startSec: 1000, endSec: 1003 }, { startSec: 1100, endSec: 1103 }] })!;
    const ids = built.input.candidates.map((c) => c.id);
    expect(planFromReview(built, { picks: ids.map((id) => ({ id, note: "" })) }).length).toBeLessThanOrEqual(1);
  });
});
