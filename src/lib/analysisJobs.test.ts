import { describe, expect, it } from "vitest";
import { pickNextAnalysisJob, type JobAnalysis, type JobTrack } from "./analysisJobs";

const local = (id: string): JobTrack => ({ id, source: "local" });
const yt = (id: string): JobTrack => ({ id, source: "youtube" });
const done: JobAnalysis = { songMap: null };
const noMap: JobAnalysis = {};

function pick(over: Partial<Parameters<typeof pickNextAnalysisJob<JobTrack>>[0]> = {}) {
  return pickNextAnalysisJob<JobTrack>({
    currentTrack: local("now"),
    queue: [],
    trackAnalysis: {},
    inFlightId: null,
    ...over,
  });
}

describe("pickNextAnalysisJob", () => {
  it("starts a fresh analysis for the playing track first", () => {
    const job = pick({ queue: [local("a")] });
    expect(job).toEqual({ track: local("now"), kind: "fresh" });
  });

  it("then works down the queue in order", () => {
    const job = pick({ queue: [local("a"), local("b")], trackAnalysis: { now: done } });
    expect(job?.track.id).toBe("a");
  });

  it("upgrades persisted analysis that has no song map, but not one that tried and found none, or already has one", () => {
    expect(pick({ trackAnalysis: { now: noMap } })).toEqual({ track: local("now"), kind: "upgrade" });
    expect(pick({ trackAnalysis: { now: { songMap: null } } })).toBeNull();
    expect(pick({ trackAnalysis: { now: { songMap: { beats: [] } } } })).toBeNull();
  });

  it("does nothing while a job is in flight (one at a time)", () => {
    expect(pick({ inFlightId: "now" })).toBeNull();
    expect(pick({ inFlightId: "something-else", queue: [local("a")] })).toBeNull();
  });

  it("returns null when everything in the window is done", () => {
    expect(pick({ queue: [local("a")], trackAnalysis: { now: done, a: done } })).toBeNull();
  });

  it("skips YouTube tracks without letting them use up the window", () => {
    // three YouTube tracks sit between the playing track and the next local one: it must still be found
    const job = pick({ queue: [yt("y1"), yt("y2"), yt("y3"), local("a")], trackAnalysis: { now: done } });
    expect(job?.track.id).toBe("a");
  });

  it("ignores a playing YouTube track", () => {
    const job = pick({ currentTrack: yt("ytnow"), queue: [local("a")] });
    expect(job?.track.id).toBe("a");
  });

  it("only looks `ahead` local tracks past the playing one", () => {
    const queue = [local("a"), local("b"), local("c"), local("d")];
    const allDoneButFourth = { now: done, a: done, b: done, c: done };
    expect(pick({ queue, trackAnalysis: allDoneButFourth, ahead: 3 })).toBeNull(); // d is the 4th ahead: not yet
    expect(pick({ queue, trackAnalysis: allDoneButFourth, ahead: 4 })?.track.id).toBe("d");
  });

  it("does not walk a huge queue looking for locals", () => {
    const queue = [...Array.from({ length: 500 }, (_, i) => yt("y" + i)), local("far")];
    expect(pick({ queue, trackAnalysis: { now: done } })).toBeNull();
    expect(pick({ queue, trackAnalysis: { now: done }, scanLimit: 1000 })?.track.id).toBe("far");
  });

  it("handles nothing playing and an empty queue", () => {
    expect(pick({ currentTrack: null, queue: [local("a")] })?.track.id).toBe("a");
    expect(pick({ currentTrack: null, queue: [] })).toBeNull();
  });

  it("does not mutate its inputs", () => {
    const queue = [local("a")];
    const analysis = { now: done };
    pick({ queue, trackAnalysis: analysis });
    expect(queue).toHaveLength(1);
    expect(analysis).toEqual({ now: done });
  });
});
