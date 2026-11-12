import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyFxPicks,
  clashesWithSpans,
  fxPlanLocally,
  parseFxPlanReview,
  planFxWithAI,
  remainingFxPicks,
  sanitizeFxPlanInput,
  type FxPlanCandidate,
  type FxPlanInput,
} from "@/lib/ai-fx-plan";

function candidate(overrides: Partial<FxPlanCandidate> & { id: string }): FxPlanCandidate {
  return {
    cueKind: "drop",
    cueAtSec: 32,
    startSec: 32,
    endSec: 35,
    role: "impact",
    fxName: "Big Impact",
    score: 0.8,
    vocalOverlap: 0,
    reason: "the drop lands",
    ...overrides,
  };
}

function input(candidates: FxPlanCandidate[], overrides: Partial<FxPlanInput> = {}): FxPlanInput {
  return { title: "Song", bpm: 120, durationSec: 200, frequency: "frequent", spooky: false, candidates, ...overrides };
}

const spread = [
  candidate({ id: "a", startSec: 24, endSec: 32, cueAtSec: 32, cueKind: "build", role: "riser", score: 0.9 }),
  candidate({ id: "b", startSec: 64, endSec: 70, cueAtSec: 64, cueKind: "breakdown", role: "downlifter", score: 0.6 }),
  candidate({ id: "c", startSec: 100, endSec: 103, cueAtSec: 100, score: 0.8 }),
];

describe("sanitizeFxPlanInput", () => {
  const body = {
    title: "Song",
    bpm: 120,
    durationSec: 200,
    frequency: "occasional",
    spooky: true,
    candidates: [
      { id: "a|x", cueKind: "build", cueAtSec: 32, startSec: 24, endSec: 32, role: "riser", fxName: "Riser", score: 0.9, vocalOverlap: 0.1, reason: "r" },
    ],
  };

  it("accepts a well-formed request", () => {
    const result = sanitizeFxPlanInput(body)!;
    expect(result.candidates).toHaveLength(1);
    expect(result.frequency).toBe("occasional");
    expect(result.spooky).toBe(true);
  });

  it("rejects what isn't a plan request", () => {
    expect(sanitizeFxPlanInput(null)).toBeNull();
    expect(sanitizeFxPlanInput({ ...body, title: 3 })).toBeNull();
    expect(sanitizeFxPlanInput({ ...body, bpm: 0 })).toBeNull();
    expect(sanitizeFxPlanInput({ ...body, bpm: "fast" })).toBeNull();
    expect(sanitizeFxPlanInput({ ...body, durationSec: -1 })).toBeNull();
    expect(sanitizeFxPlanInput({ ...body, frequency: "off" })).toBeNull();
    expect(sanitizeFxPlanInput({ ...body, candidates: "no" })).toBeNull();
  });

  it("drops bad, duplicate and unknown candidates, caps the list and the lengths", () => {
    const good = body.candidates[0];
    const many = Array.from({ length: 30 }, (_, i) => ({ ...good, id: `id${i}` }));
    const result = sanitizeFxPlanInput({
      ...body,
      title: "x".repeat(500),
      candidates: [
        good,
        good, // duplicate id
        { ...good, id: "k", cueKind: "wild" },
        { ...good, id: "r", role: "boom" },
        { ...good, id: "t", startSec: 10, endSec: 10 },
        { ...good, id: "n", startSec: "soon" },
        { ...good, id: "", },
        null,
        ...many,
      ],
    })!;
    expect(result.title.length).toBe(120);
    expect(result.candidates.length).toBe(12);
    expect(new Set(result.candidates.map((c) => c.id)).size).toBe(12);
    expect(result.candidates.every((c) => c.cueKind !== ("wild" as never))).toBe(true);
  });

  it("clamps scores and caps free text", () => {
    const result = sanitizeFxPlanInput({
      ...body,
      candidates: [{ ...body.candidates[0], score: 7, vocalOverlap: -2, fxName: "n".repeat(200), reason: "r".repeat(500) }],
    })!;
    expect(result.candidates[0].score).toBe(1);
    expect(result.candidates[0].vocalOverlap).toBe(0);
    expect(result.candidates[0].fxName.length).toBe(60);
    expect(result.candidates[0].reason.length).toBe(120);
  });
});

describe("applyFxPicks", () => {
  it("keeps real picks in song order and ignores ids it doesn't know", () => {
    const kept = applyFxPicks(input(spread), ["c", "nope", "a"]);
    expect(kept.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("keeps each pick once", () => {
    expect(applyFxPicks(input(spread), ["a", "a"]).map((c) => c.id)).toEqual(["a"]);
  });

  it("caps the number by the frequency", () => {
    const many = Array.from({ length: 5 }, (_, i) => candidate({ id: `p${i}`, startSec: 10 + i * 100, endSec: 13 + i * 100 }));
    expect(applyFxPicks(input(many, { frequency: "occasional" }), many.map((c) => c.id))).toHaveLength(3);
    expect(applyFxPicks(input(many, { frequency: "frequent" }), many.map((c) => c.id))).toHaveLength(5);
  });

  it("drops a pick that overlaps or crowds an earlier one, the earlier winning", () => {
    const crowded = [
      candidate({ id: "x", startSec: 40, endSec: 46 }),
      candidate({ id: "y", startSec: 44, endSec: 48 }), // overlaps x
      candidate({ id: "z", startSec: 60, endSec: 63 }), // 20 s after x: under the 30 s spacing
      candidate({ id: "w", startSec: 90, endSec: 93 }),
    ];
    expect(applyFxPicks(input(crowded), ["x", "y", "z", "w"]).map((c) => c.id)).toEqual(["x", "w"]);
  });

  it("enforces the wider spacing on Occasional", () => {
    const pair = [candidate({ id: "x", startSec: 40, endSec: 43 }), candidate({ id: "w", startSec: 80, endSec: 83 })];
    expect(applyFxPicks(input(pair, { frequency: "occasional" }), ["x", "w"]).map((c) => c.id)).toEqual(["x"]);
    expect(applyFxPicks(input(pair, { frequency: "frequent" }), ["x", "w"]).map((c) => c.id)).toEqual(["x", "w"]);
  });

  it("accepts no picks at all", () => {
    expect(applyFxPicks(input(spread), [])).toEqual([]);
  });
});

describe("fxPlanLocally", () => {
  it("chooses the strongest candidates that fit the rules, and says it is the fallback", () => {
    const review = fxPlanLocally(input(spread));
    expect(review.usedFallback).toBe(true);
    expect(review.picks.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(review.summary).toMatch(/3 effects/);
  });

  it("keeps a vocal-covered sweep out but still allows a drop", () => {
    const sung = [
      candidate({ id: "sweep", cueKind: "build", role: "riser", startSec: 10, endSec: 16, vocalOverlap: 0.9, score: 0.9 }),
      candidate({ id: "drop", cueKind: "drop", startSec: 60, endSec: 63, vocalOverlap: 0.9, score: 0.5 }),
    ];
    expect(fxPlanLocally(input(sung)).picks.map((p) => p.id)).toEqual(["drop"]);
  });

  it("says so when nothing earns an effect", () => {
    const review = fxPlanLocally(input([]));
    expect(review.picks).toEqual([]);
    expect(review.summary).toMatch(/nothing/i);
  });
});

describe("parseFxPlanReview", () => {
  it("reads picks and a summary", () => {
    const parsed = parseFxPlanReview({ picks: [{ id: "a", note: " riser into the drop " }, { id: "c" }], summary: " Two effects. " })!;
    expect(parsed.picks).toEqual([{ id: "a", note: "riser into the drop" }, { id: "c", note: "" }]);
    expect(parsed.summary).toBe("Two effects.");
  });

  it("treats an empty pick list as a real answer", () => {
    expect(parseFxPlanReview({ picks: [], summary: "Nothing earned one." })!.picks).toEqual([]);
  });

  it("rejects what is not a review, and skips malformed picks", () => {
    expect(parseFxPlanReview(null)).toBeNull();
    expect(parseFxPlanReview({ summary: "x" })).toBeNull();
    expect(parseFxPlanReview({ picks: "a" })).toBeNull();
    expect(parseFxPlanReview({ picks: [null, { id: 3 }, { id: "" }, { id: "ok" }] })!.picks).toEqual([{ id: "ok", note: "" }]);
  });
});

describe("planFxWithAI", () => {
  const realKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
  });

  it("falls back with no key, and without calling the network", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const review = await planFxWithAI(input(spread));
    expect(review.usedFallback).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back with no candidates, without a call", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await planFxWithAI(input([]))).usedFallback).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  function reply(text: string, status = 200) {
    return vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status }));
  }

  it("uses the DJ's picks, but only the ones the rules allow", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", reply(JSON.stringify({ picks: [{ id: "c", note: "land it" }, { id: "ghost", note: "x" }], summary: "One." })));
    const review = await planFxWithAI(input(spread));
    expect(review.usedFallback).toBe(false);
    expect(review.picks).toEqual([{ id: "c", note: "land it" }]);
    expect(review.summary).toBe("One.");
  });

  it("accepts the DJ choosing nothing", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", reply('{"picks": [], "summary": "Nothing earned one."}'));
    const review = await planFxWithAI(input(spread));
    expect(review.usedFallback).toBe(false);
    expect(review.picks).toEqual([]);
  });

  it("holds the DJ to the spacing and the cap even if it ignores them", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const crowded = [candidate({ id: "x", startSec: 40, endSec: 46 }), candidate({ id: "y", startSec: 50, endSec: 53 })];
    vi.stubGlobal("fetch", reply(JSON.stringify({ picks: [{ id: "x", note: "" }, { id: "y", note: "" }], summary: "" })));
    const review = await planFxWithAI(input(crowded));
    expect(review.picks.map((p) => p.id)).toEqual(["x"]);
  });

  it("sends the DJ the candidates and the rules' numbers, never the key in the body", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = reply('{"picks": [], "summary": ""}');
    vi.stubGlobal("fetch", fetchMock);
    await planFxWithAI(input(spread, { frequency: "occasional", spooky: true }));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe("claude-sonnet-5");
    const user = JSON.parse(sent.messages[0].content);
    expect(user).toMatchObject({ maxPicks: 3, minGapSec: 60, spooky: true });
    expect(user.candidates).toHaveLength(3);
    expect(String(init.body)).not.toContain("test-key");
  });

  it("falls back on an HTTP error, unusable text, a bad shape and a thrown fetch", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    for (const fetchImpl of [
      reply("{}", 500),
      reply("not json at all"),
      reply('{"picks": "nope"}'),
      vi.fn(async () => {
        throw new Error("down");
      }),
    ]) {
      vi.stubGlobal("fetch", fetchImpl);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect((await planFxWithAI(input(spread))).usedFallback).toBe(true);
      warn.mockRestore();
    }
  });
});

describe("effects already played in the song (a re-plan)", () => {
  const spans = [{ startSec: 10, endSec: 13 }, { startSec: 200, endSec: 203 }];

  it("sanitizes the prior spans: finite, ordered, capped", () => {
    const body = {
      title: "Song", bpm: 120, durationSec: 300, frequency: "frequent", candidates: [],
      prior: [{ startSec: 1, endSec: 2 }, { startSec: 5, endSec: 5 }, { startSec: "x", endSec: 9 }, null, ...Array.from({ length: 20 }, (_, i) => ({ startSec: 100 + i, endSec: 101 + i }))],
    };
    const result = sanitizeFxPlanInput(body)!;
    expect(result.prior!.length).toBe(8);
    expect(result.prior![0]).toEqual({ startSec: 1, endSec: 2 });
    expect(sanitizeFxPlanInput({ ...body, prior: undefined })!.prior).toEqual([]);
  });

  it("counts them against the cap", () => {
    expect(remainingFxPicks({ frequency: "occasional", prior: [] })).toBe(3);
    expect(remainingFxPicks({ frequency: "occasional", prior: spans })).toBe(1);
    expect(remainingFxPicks({ frequency: "occasional", prior: [...spans, ...spans] })).toBe(0);
    expect(remainingFxPicks({ frequency: "frequent" })).toBe(6);
  });

  it("keeps a pick away from them: no overlap, and the spacing applies", () => {
    expect(clashesWithSpans(spans, { startSec: 40, endSec: 43 }, "frequent")).toBe(false);
    expect(clashesWithSpans(spans, { startSec: 35, endSec: 38 }, "frequent")).toBe(true); // 25 s after the one at 10
    expect(clashesWithSpans(spans, { startSec: 35, endSec: 38 }, "occasional")).toBe(true);
    expect(clashesWithSpans(spans, { startSec: 12, endSec: 15 }, "frequent")).toBe(true); // overlaps
    expect(clashesWithSpans([], { startSec: 12, endSec: 15 }, "occasional")).toBe(false);
  });

  it("applyFxPicks honours them", () => {
    const cands = [
      candidate({ id: "near", startSec: 30, endSec: 33 }),
      candidate({ id: "far", startSec: 90, endSec: 93 }),
      candidate({ id: "far2", startSec: 150, endSec: 153 }),
    ];
    const kept = applyFxPicks(input(cands, { frequency: "occasional", prior: spans }), ["near", "far", "far2"]);
    // One slot left on Occasional (3 - 2), and "near" is within 60 s of the one at 10.
    expect(kept.map((c) => c.id)).toEqual(["far"]);
  });

  it("does not ask Claude when the song has had all it may, and tells it what already played", async () => {
    const realKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: '{"picks": [], "summary": ""}' }] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const full = await planFxWithAI(input(spread, { frequency: "occasional", prior: [...spans, { startSec: 100, endSec: 103 }] }));
      expect(full.usedFallback).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();

      await planFxWithAI(input(spread, { frequency: "occasional", prior: spans }));
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const user = JSON.parse(JSON.parse(String(init.body)).messages[0].content);
      expect(user.maxPicks).toBe(1);
      expect(user.alreadyPlayed).toEqual([{ startSec: 10, endSec: 13 }, { startSec: 200, endSec: 203 }]);
    } finally {
      vi.unstubAllGlobals();
      if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = realKey;
    }
  });
});
