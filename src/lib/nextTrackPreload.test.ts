import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HAVE_FUTURE_DATA, MAX_INCOMING_HOLD_MS, MIN_HOLD_SLACK_SEC, PRELOAD_LEAD_SEC, PRELOAD_MIN_ELAPSED_SEC, shouldHoldForIncoming, shouldPreloadNext } from "./nextTrackPreload";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

describe("when the next song is loaded into the idle deck", () => {
  it("starts in the last minute and a half of the playing song, not before", () => {
    expect(shouldPreloadNext(PRELOAD_LEAD_SEC + 1, 100)).toBe(false);
    expect(shouldPreloadNext(PRELOAD_LEAD_SEC, 100)).toBe(true);
    expect(shouldPreloadNext(20, 200)).toBe(true);
  });

  it("not in the first moments of a song, and never for a song that is over or has no known length", () => {
    expect(shouldPreloadNext(60, PRELOAD_MIN_ELAPSED_SEC - 0.1)).toBe(false);
    expect(shouldPreloadNext(60, PRELOAD_MIN_ELAPSED_SEC)).toBe(true);
    expect(shouldPreloadNext(0, 200)).toBe(false);
    expect(shouldPreloadNext(-3, 200)).toBe(false);
    expect(shouldPreloadNext(NaN, 200)).toBe(false);
    expect(shouldPreloadNext(Infinity, 200)).toBe(false);
  });

  it("a short song (under the lead time) preloads as soon as it has settled", () => {
    expect(shouldPreloadNext(40, PRELOAD_MIN_ELAPSED_SEC)).toBe(true);
  });
});

describe("when a transition waits for the incoming song", () => {
  const base = { readyState: 1, remainingSec: 30, windowSec: 12, heldMs: 0 };

  it("waits while the song is not ready and there is room", () => {
    expect(shouldHoldForIncoming(base)).toBe(true);
    expect(shouldHoldForIncoming({ ...base, readyState: 2 })).toBe(true);
  });

  it("never waits for a song that is ready to play", () => {
    expect(shouldHoldForIncoming({ ...base, readyState: HAVE_FUTURE_DATA })).toBe(false);
    expect(shouldHoldForIncoming({ ...base, readyState: 4 })).toBe(false);
  });

  it("never waits for ever: it gives up after the longest hold", () => {
    expect(shouldHoldForIncoming({ ...base, heldMs: MAX_INCOMING_HOLD_MS - 1 })).toBe(true);
    expect(shouldHoldForIncoming({ ...base, heldMs: MAX_INCOMING_HOLD_MS })).toBe(false);
  });

  it("never waits when that would leave no room: the playing song must outlast the transition by a margin", () => {
    expect(shouldHoldForIncoming({ ...base, remainingSec: 12 + MIN_HOLD_SLACK_SEC + 0.1 })).toBe(true);
    expect(shouldHoldForIncoming({ ...base, remainingSec: 12 + MIN_HOLD_SLACK_SEC })).toBe(false);
    expect(shouldHoldForIncoming({ ...base, remainingSec: 5 })).toBe(false);
  });
});

describe("the deck stage never loads the incoming song at the last moment any more", () => {
  const stage = read("components/DualDeckStage.tsx");

  it("every place that gives the incoming deck a song goes through attachIncomingSource (which reuses the preload)", () => {
    // direct assignments to an incoming deck's src are gone; only the helper and the preload set it
    expect(stage).not.toMatch(/toEl\.src\s*=/);
    expect(stage).not.toMatch(/idleEl\.src\s*=\s*playUrl\(m\./);
    expect((stage.match(/attachIncomingSource\(/g) ?? []).length).toBe(4); // the definition and three call sites: a transition, a mashup hand-off, the Song Sync pre-roll
    expect(stage).toMatch(/attachIncomingSource\(toEl, toDeckId, nextTrack\);\n\s*toEl\.currentTime = plan\.incomingEntryOffsetSec;/);
  });

  it("the preload runs from the same periodic handler that decides to start a transition, and clears with the idle deck", () => {
    expect(stage).toMatch(/preloadNextTrack\(\);\n\s*tryAutoTransition\(\);/);
    expect(stage).toMatch(/preloadedRef\.current = null;\n\s*incomingHoldSinceRef\.current = null;\n\s*resetDeckNodes\(idleId, 0\);/);
  });

  it("an automatic start waits for the preloaded song (both the Auto-DJ blend and the plain fade), and a manual Mix Now does not", () => {
    expect((stage.match(/holdForIncoming\(nextTrack, clampedWindow, duration - currentTime\)/g) ?? []).length).toBe(2);
    const mixNow = stage.slice(stage.indexOf("const ordinaryMixNow = () => {"), stage.indexOf("const ordinaryMixNow = () => {") + 900);
    expect(mixNow).not.toMatch(/holdForIncoming/);
  });
});
