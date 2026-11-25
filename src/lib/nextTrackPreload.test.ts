import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALIGNED_MAX_HOLD_MS,
  MAX_INCOMING_HOLD_MS,
  MIN_HOLD_SLACK_SEC,
  NATURAL_END_HOLD_LEAD_SEC,
  NETWORK_LOADING,
  PRELOAD_LEAD_SEC,
  PRELOAD_MIN_ELAPSED_SEC,
  incomingIsLoading,
  incomingIsReady,
  isBufferedFrom,
  needsEntrySeek,
  shouldHoldForIncoming,
  shouldPreloadNext,
  type IncomingState,
} from "./nextTrackPreload";

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

const incoming = (over: Partial<IncomingState> = {}): IncomingState => ({
  readyState: 4,
  networkState: NETWORK_LOADING,
  buffered: [{ start: 0, end: 240 }],
  durationSec: 240,
  entryOffsetSec: 0,
  ...over,
});

describe("when the incoming song counts as ready", () => {
  it("is ready when the entry point itself is buffered", () => {
    expect(incomingIsReady(incoming())).toBe(true);
    expect(incomingIsReady(incoming({ entryOffsetSec: 64 }))).toBe(true);
  });

  it("is NOT ready when only the start of the song is buffered but the transition enters deeper in (a preload from time 0 does not cover a drop entry)", () => {
    const s = incoming({ buffered: [{ start: 0, end: 20 }], entryOffsetSec: 64 });
    expect(incomingIsReady(s)).toBe(false);
  });

  it("needs a little buffered past the entry point, not a single instant", () => {
    expect(isBufferedFrom([{ start: 0, end: 64.2 }], 64, 1, 240)).toBe(false);
    expect(isBufferedFrom([{ start: 0, end: 66 }], 64, 1, 240)).toBe(true);
    expect(isBufferedFrom([{ start: 10, end: 20 }, { start: 60, end: 70 }], 64, 1, 240)).toBe(true);
  });

  it("a song buffered to its end is ready from near its end", () => {
    expect(isBufferedFrom([{ start: 0, end: 240 }], 239.5, 1, 240)).toBe(true);
  });

  it("without buffer information the deck's own readyState decides", () => {
    expect(incomingIsReady(incoming({ buffered: [], readyState: 3 }))).toBe(true);
    expect(incomingIsReady(incoming({ buffered: [], readyState: 1 }))).toBe(false);
  });
});

describe("whether the browser is fetching the incoming song at all", () => {
  it("is loading while the network state says so, or once anything is buffered", () => {
    expect(incomingIsLoading(incoming({ buffered: [], networkState: NETWORK_LOADING }))).toBe(true);
    expect(incomingIsLoading(incoming({ buffered: [{ start: 0, end: 5 }], networkState: 1 }))).toBe(true);
  });

  it("is not loading on a browser that ignores the preload (nothing buffered, network idle): waiting there would wait for nothing", () => {
    expect(incomingIsLoading(incoming({ buffered: [], networkState: 1, readyState: 0 }))).toBe(false);
    expect(incomingIsLoading(incoming({ buffered: [], networkState: 0, readyState: 0 }))).toBe(false);
  });
});

describe("moving the idle deck to the entry point so the browser fetches there", () => {
  it("seeks when the entry point is deep, not buffered and the deck is elsewhere", () => {
    expect(needsEntrySeek(incoming({ buffered: [{ start: 0, end: 20 }], entryOffsetSec: 64 }), 0)).toBe(true);
  });

  it("does not seek when the entry point is at the start, already buffered, or the deck is already there", () => {
    expect(needsEntrySeek(incoming({ buffered: [{ start: 0, end: 5 }], entryOffsetSec: 0 }), 0)).toBe(false);
    expect(needsEntrySeek(incoming({ entryOffsetSec: 64 }), 0)).toBe(false);
    expect(needsEntrySeek(incoming({ buffered: [{ start: 0, end: 20 }], entryOffsetSec: 64 }), 64.2)).toBe(false);
  });
});

describe("when a transition waits for the incoming song", () => {
  const base = { ready: false, loading: true, remainingSec: 30, windowSec: 12, heldMs: 0 };

  it("waits while the song is being fetched, is not ready and there is room", () => {
    expect(shouldHoldForIncoming(base)).toBe(true);
  });

  it("never waits for a song that is ready to play", () => {
    expect(shouldHoldForIncoming({ ...base, ready: true })).toBe(false);
  });

  it("never waits for a song the browser is not fetching", () => {
    expect(shouldHoldForIncoming({ ...base, loading: false })).toBe(false);
  });

  it("never waits for ever: it gives up after the longest hold", () => {
    expect(shouldHoldForIncoming({ ...base, heldMs: MAX_INCOMING_HOLD_MS - 1 })).toBe(true);
    expect(shouldHoldForIncoming({ ...base, heldMs: MAX_INCOMING_HOLD_MS })).toBe(false);
  });

  it("a start aligned to the playing song's drop or breakdown waits far less", () => {
    expect(shouldHoldForIncoming({ ...base, heldMs: ALIGNED_MAX_HOLD_MS - 1, maxHoldMs: ALIGNED_MAX_HOLD_MS })).toBe(true);
    expect(shouldHoldForIncoming({ ...base, heldMs: ALIGNED_MAX_HOLD_MS, maxHoldMs: ALIGNED_MAX_HOLD_MS })).toBe(false);
    expect(ALIGNED_MAX_HOLD_MS).toBeLessThan(MAX_INCOMING_HOLD_MS);
  });

  it("never waits when that would leave no room: the playing song must outlast the transition by a margin", () => {
    expect(shouldHoldForIncoming({ ...base, remainingSec: 12 + MIN_HOLD_SLACK_SEC + 0.1 })).toBe(true);
    expect(shouldHoldForIncoming({ ...base, remainingSec: 12 + MIN_HOLD_SLACK_SEC })).toBe(false);
    expect(shouldHoldForIncoming({ ...base, remainingSec: 5 })).toBe(false);
  });
});

describe("the start at the playing song's natural end", () => {
  const window = 12;

  it("at the usual moment (only the transition's own length left) there is no room to wait: this is why the start moves earlier", () => {
    expect(shouldHoldForIncoming({ ready: false, loading: true, remainingSec: window, windowSec: window, heldMs: 0 })).toBe(false);
  });

  it("started earlier by the lead, there is room to wait for the whole of the longest hold", () => {
    expect(shouldHoldForIncoming({ ready: false, loading: true, remainingSec: window + NATURAL_END_HOLD_LEAD_SEC, windowSec: window, heldMs: 0 })).toBe(true);
    // ...and a hold that has used its time is released while the song still outlasts the transition, so the song never runs out under the fade
    const remainingWhenHoldEnds = window + NATURAL_END_HOLD_LEAD_SEC - MAX_INCOMING_HOLD_MS / 1000;
    expect(remainingWhenHoldEnds - window).toBeGreaterThanOrEqual(MIN_HOLD_SLACK_SEC);
    expect(shouldHoldForIncoming({ ready: false, loading: true, remainingSec: remainingWhenHoldEnds, windowSec: window, heldMs: MAX_INCOMING_HOLD_MS })).toBe(false);
  });
});

describe("the deck stage never loads the incoming song at the last moment any more", () => {
  const stage = read("components/DualDeckStage.tsx");

  it("every place that gives the incoming deck a song goes through attachIncomingSource (which reuses the preload)", () => {
    // direct assignments to an incoming deck's src are gone; only the helper and the preload set it
    expect(stage).not.toMatch(/toEl\.src\s*=/);
    expect(stage).not.toMatch(/idleEl\.src\s*=\s*playUrl\(m\./);
    expect((stage.match(/attachIncomingSource\(/g) ?? []).length).toBe(4); // the definition and three call sites: a transition, a mashup hand-off, the Song Sync pre-roll
  });

  it("the preload runs from the same periodic handler that decides to start a transition, and clears with the idle deck", () => {
    expect(stage).toMatch(/preloadNextTrack\(\);\n\s*tryAutoTransition\(\);/);
    expect(stage).toMatch(/preloadedRef\.current = null;\n\s*incomingHoldSinceRef\.current = null;\n\s*resetDeckNodes\(idleId, 0\);/);
  });

  it("only the automatic start (tryAutoTransition) waits for the preloaded song; a manual Mix Now never does", () => {
    const calls = [...stage.matchAll(/holdForIncoming\(nextTrack,/g)].map((m) => m.index ?? -1);
    expect(calls.length).toBe(2); // the Auto-DJ blend and the plain fade
    const autoStart = stage.indexOf("function tryAutoTransition()");
    const mixNow = stage.indexOf("const ordinaryMixNow = () => {");
    expect(autoStart).toBeGreaterThan(-1);
    expect(mixNow).toBeGreaterThan(autoStart);
    for (const at of calls) {
      expect(at).toBeGreaterThan(autoStart);
      expect(at).toBeLessThan(mixNow);
    }
  });
});
