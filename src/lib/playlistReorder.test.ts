import { describe, expect, it } from "vitest";
import { planReorder } from "@/lib/playlistReorder";

const rows = (ids: string[]) => ids.map((trackId, position) => ({ trackId, position }));

describe("planReorder", () => {
  it("emits only the rows that move for an adjacent swap", () => {
    const plan = planReorder(rows(["a", "b", "c", "d"]), ["a", "c", "b", "d"]);
    expect(plan).toEqual({
      ok: true,
      updates: [
        { trackId: "c", position: 1 },
        { trackId: "b", position: 2 },
      ],
    });
  });

  it("is a no-op when the order is unchanged", () => {
    expect(planReorder(rows(["a", "b"]), ["a", "b"])).toEqual({ ok: true, updates: [] });
  });

  it("handles a full reversal", () => {
    const plan = planReorder(rows(["a", "b", "c"]), ["c", "b", "a"]);
    expect(plan).toEqual({
      ok: true,
      updates: [
        { trackId: "c", position: 0 },
        { trackId: "a", position: 2 },
      ],
    });
  });

  it("normalizes gaps left by earlier removals", () => {
    const current = [
      { trackId: "a", position: 0 },
      { trackId: "b", position: 3 },
      { trackId: "c", position: 7 },
    ];
    expect(planReorder(current, ["a", "b", "c"])).toEqual({
      ok: true,
      updates: [
        { trackId: "b", position: 1 },
        { trackId: "c", position: 2 },
      ],
    });
  });

  it("rejects a stale client that is missing a track", () => {
    expect(planReorder(rows(["a", "b", "c"]), ["a", "b"])).toEqual({ ok: false, reason: "membership-mismatch" });
  });

  it("rejects a stale client that references a removed track", () => {
    expect(planReorder(rows(["a", "b"]), ["a", "x"])).toEqual({ ok: false, reason: "membership-mismatch" });
  });

  it("ignores ids that have no row (Spooky auto-included tracks)", () => {
    expect(planReorder(rows(["a", "b"]), ["b", "auto-1", "a"])).toEqual({
      ok: true,
      updates: [
        { trackId: "b", position: 0 },
        { trackId: "a", position: 1 },
      ],
    });
  });

  it("rejects duplicate ids", () => {
    expect(planReorder(rows(["a", "b"]), ["a", "a"])).toEqual({ ok: false, reason: "duplicate-ids" });
  });

  it("accepts an empty playlist with an empty order", () => {
    expect(planReorder([], [])).toEqual({ ok: true, updates: [] });
  });
});
