import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/anthropicJson", () => ({ askClaudeForJson: vi.fn(async () => null) }));

import { askClaudeForJson } from "@/lib/anthropicJson";
import { refineWithClaude } from "@/lib/curate/llmRefine";
import type { CurationPreview, PreviewTrack } from "@/lib/curate/curate";

const track = (id: string, camelot?: string | null): PreviewTrack => ({ id, title: id, artist: "A", durationSec: 200, energy: 0.5, bpm: 100, ...(camelot === undefined ? {} : { camelot }) });
const preview = (tracks: PreviewTrack[]): CurationPreview => ({ title: "T", description: "D", tracks, runtimeSec: 0, arc: "steady", profile: null, shortfall: null, unknownYear: 0, unknownRating: 0, notes: [], spec: { genres: [], subgenres: [], moods: [] } });

describe("what the model is told about keys", () => {
  beforeEach(() => vi.mocked(askClaudeForJson).mockClear());

  it("sends each track's key (null when it has none) and tells the model to keep neighbouring keys compatible", async () => {
    await refineWithClaude("chill", preview([track("a", "8A"), track("b", null), track("c"), track("d", "9A")]));
    expect(askClaudeForJson).toHaveBeenCalledTimes(1);
    const request = vi.mocked(askClaudeForJson).mock.calls[0][0];
    expect(request.system).toMatch(/Camelot/);
    expect(request.system).toMatch(/never put clashing keys next to each other/);
    const tracks = (request.user as { tracks: { id: string; key: string | null }[] }).tracks;
    expect(tracks.map((t) => [t.id, t.key])).toEqual([["a", "8A"], ["b", null], ["c", null], ["d", "9A"]]);
  });

  it("does not ask the model at all for a playlist of fewer than four tracks", async () => {
    expect(await refineWithClaude("chill", preview([track("a"), track("b")]))).toBeNull();
    expect(askClaudeForJson).not.toHaveBeenCalled();
  });

  it("tells the model what was asked for and sends each track's moods and year, so it can order by them as well as energy", async () => {
    const withMeta: PreviewTrack = { ...track("a", "8A"), moods: ["sad", "chill"], year: 1994 };
    const p = preview([withMeta, track("b"), track("c"), track("d")]);
    p.spec = { genres: ["R&B"], subgenres: [], moods: ["sad"], eraRange: { from: 1990, to: 1999 }, explicitPolicy: "clean-only" };
    await refineWithClaude("sad 90s r&b, clean", p);
    const request = vi.mocked(askClaudeForJson).mock.calls[0][0];
    expect(request.system).toMatch(/"asked" says what the person asked for/);
    expect(request.system).toMatch(/Never change which tracks are in the list/);
    const user = request.user as { asked: unknown; tracks: { id: string; moods: string[]; year: number | null }[] };
    expect(user.asked).toEqual({ genres: ["R&B"], subgenres: [], moods: ["sad"], era: { from: 1990, to: 1999 }, cleanOnly: true });
    expect(user.tracks.map((t) => [t.id, t.moods, t.year])).toEqual([["a", ["sad", "chill"], 1994], ["b", [], null], ["c", [], null], ["d", [], null]]);
  });
});
