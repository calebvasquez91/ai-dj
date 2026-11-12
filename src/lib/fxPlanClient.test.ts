import { afterEach, describe, expect, it, vi } from "vitest";
import { requestFxPlan } from "@/lib/fxPlanClient";
import type { BuildFxPlanArgs } from "@/lib/fxScheduler";
import type { SongMap, SongSection } from "@/lib/song-map";
import type { FxSound } from "@/types/music";

const BAR = 2;
const section = (label: SongSection["label"], startSec: number, endSec: number): SongSection => ({ label, startSec, endSec, energy: 0.5, confidence: 0.8 });
const downbeats = Array.from({ length: 100 }, (_, i) => i * BAR);
const songMap: SongMap = {
  version: 1,
  durationSec: 200,
  bpm: 120,
  tempoConfidence: 0.9,
  beatsPerBar: 4,
  beats: Array.from({ length: 400 }, (_, i) => i * 0.5),
  downbeatPhase: 0,
  downbeatConfidence: 0.9,
  downbeats,
  phrases: { bars8: [], bars16: [], bars32: [], confidence: 0.8 },
  sections: [section("intro", 0, 40), section("build", 40, 64), section("drop", 64, 110), section("outro", 110, 200)],
};
const fx = (name: string, durationSec: number): FxSound => ({
  id: name, name, fileName: `${name}.wav`, sourceUrl: `/fx/${name}`, mimeType: "audio/wav", category: "effect", durationSec, tags: [], playlistAffinity: [], addedAt: 0,
});
const args: BuildFxPlanArgs = {
  title: "Song",
  songMap,
  durationSec: 200,
  fromSec: 0,
  frequency: "frequent",
  spooky: false,
  pool: [fx("Riser", 8), fx("Big Impact", 3)],
};

afterEach(() => vi.unstubAllGlobals());

describe("requestFxPlan", () => {
  it("returns nothing, without a request, when there is nothing to choose", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestFxPlan({ ...args, songMap: null });
    expect(result.planned).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the DJ's picks", async () => {
    let candidateIds: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        candidateIds = (JSON.parse(String(init.body)).candidates as { id: string }[]).map((c) => c.id);
        return new Response(JSON.stringify({ picks: [{ id: candidateIds[0], note: "the DJ's note" }], summary: "One.", usedFallback: false }), { status: 200 });
      })
    );
    const result = await requestFxPlan(args);
    expect(result.planned.map((p) => p.id)).toEqual([candidateIds[0]]);
    expect(result.planned[0].note).toBe("the DJ's note");
    expect(result.usedFallback).toBe(false);
  });

  it("sends the effects already played so a re-plan counts them", async () => {
    let body: { prior?: { startSec: number; endSec: number }[]; candidates: { startSec: number }[] } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ picks: [], summary: "" }), { status: 200 });
      })
    );
    await requestFxPlan({ ...args, prior: [{ startSec: 100, endSec: 103 }] });
    expect(body!.prior).toEqual([{ startSec: 100, endSec: 103 }]);
    // Nothing offered crowds the played effect (Frequent keeps 30 s apart); the filtering itself is tested with buildFxPlan.
    expect(body!.candidates.length).toBeGreaterThan(0);
    expect(body!.candidates.every((c) => Math.abs(c.startSec - 100) >= 30)).toBe(true);
  });

  it("falls back to the engineer's own pick when the request fails or is abandoned", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const failed = await requestFxPlan(args);
    expect(failed.usedFallback).toBe(true);
    expect(failed.planned.length).toBeGreaterThan(0);

    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init.signal as AbortSignal);
        throw new DOMException("aborted", "AbortError");
      })
    );
    controller.abort();
    const abandoned = await requestFxPlan(args, controller.signal);
    expect(abandoned.usedFallback).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeDefined(); // the caller's signal and the timeout are both passed on
  });

  it("falls back on a 429 and on an unusable body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    expect((await requestFxPlan(args)).usedFallback).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })));
    expect((await requestFxPlan(args)).usedFallback).toBe(true);
  });
});
