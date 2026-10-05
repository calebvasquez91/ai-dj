import { describe, expect, it } from "vitest";
import type { FxSound } from "@/types/music";
import { FX_DEFAULT_LEVEL } from "@/lib/layerMix";
import { fallbackAnalysis } from "@/lib/audio-analysis-core";
import { estimateStructuralCues } from "@/lib/structural-estimate";
import {
  SPOOKY_FX_BASE_GAIN,
  SPOOKY_FX_MAX_SEC,
  decideSpookyFx,
  pickRandomFx,
  effectsPool,
  spookyMoment,
  type SpookyFxState,
} from "./spookyFx";

function fx(id: string, over: Partial<FxSound> = {}): FxSound {
  return {
    id,
    name: id,
    fileName: `${id}.wav`,
    sourceUrl: `/fx/${id}`,
    mimeType: "audio/wav",
    category: "effect",
    durationSec: 5,
    tags: [],
    playlistAffinity: ["spooky", "halloween"],
    addedAt: 0,
    ...over,
  };
}

describe("effectsPool", () => {
  it("keeps every sound in the Effects category, whatever its tags", () => {
    const pool = effectsPool([
      fx("tagged"),
      fx("untagged", { playlistAffinity: [] }),
      fx("other-tag", { playlistAffinity: ["christmas"] }),
    ]);
    expect(pool.map((f) => f.id)).toEqual(["tagged", "untagged", "other-tag"]);
  });

  it("leaves out every other category, even when tagged spooky", () => {
    expect(
      effectsPool([
        fx("loop-bg", { category: "background" }),
        fx("trans", { category: "transition" }),
        fx("loop", { category: "loop" }),
        fx("vocal", { category: "vocal" }),
      ])
    ).toEqual([]);
  });

  it("drops sounds that are empty or too long to read as an effect", () => {
    const pool = effectsPool([
      fx("zero", { durationSec: 0 }),
      fx("long", { durationSec: SPOOKY_FX_MAX_SEC + 1 }),
      fx("edge", { durationSec: SPOOKY_FX_MAX_SEC }),
    ]);
    expect(pool.map((f) => f.id)).toEqual(["edge"]);
  });
});

describe("pickRandomFx", () => {
  const pool = [fx("a"), fx("b"), fx("c")];

  it("returns null for an empty pool", () => {
    expect(pickRandomFx([], null)).toBeNull();
  });

  it("never repeats the last one while others exist", () => {
    for (let i = 0; i < 50; i++) expect(pickRandomFx(pool, "b")?.id).not.toBe("b");
  });

  it("repeats the only FX rather than going silent", () => {
    expect(pickRandomFx([fx("a")], "a")?.id).toBe("a");
  });

  it("can reach every other FX (uses the injected random)", () => {
    expect(pickRandomFx(pool, "a", () => 0)?.id).toBe("b");
    expect(pickRandomFx(pool, "a", () => 0.99)?.id).toBe("c");
  });
});

describe("spookyMoment", () => {
  // No waveform peaks: detectBuild falls back to the structural guess of where the drop lands.
  const analysis = fallbackAnalysis();
  const duration = 200;
  const estimatedDrop = estimateStructuralCues(duration).estimatedDropAtSec;

  it("is 'drop' from just before the drop target to a couple of seconds after", () => {
    const at = (t: number) => spookyMoment({ analysis, durationSec: duration, currentTimeSec: t, dropTargetSec: 100 });
    expect(at(99.6)).toBe("drop");
    expect(at(100)).toBe("drop");
    expect(at(101.9)).toBe("drop");
    expect(at(102.1)).not.toBe("drop");
    expect(at(99.4)).not.toBe("drop");
  });

  it("is 'build' in the run-up to the drop", () => {
    expect(
      spookyMoment({ analysis, durationSec: duration, currentTimeSec: estimatedDrop - 10, dropTargetSec: null })
    ).toBe("build");
  });

  it("is null mid-track away from any build or drop", () => {
    expect(spookyMoment({ analysis, durationSec: duration, currentTimeSec: 5, dropTargetSec: null })).toBeNull();
  });

  it("ignores a drop target at or before the start", () => {
    expect(spookyMoment({ analysis, durationSec: duration, currentTimeSec: 0.2, dropTargetSec: 0 })).toBeNull();
  });
});

describe("decideSpookyFx", () => {
  const fresh: SpookyFxState = { lastPlayedSec: null, lastRollSec: null };
  const always = () => 0;
  const never = () => 0.999;

  it("never plays when ambience frequency is off", () => {
    expect(decideSpookyFx({ moment: "drop", currentTimeSec: 10, frequency: "off", state: fresh, random: always }).play).toBe(false);
  });

  it("plays at a drop or build when the roll succeeds, and records it", () => {
    const r = decideSpookyFx({ moment: "drop", currentTimeSec: 100, frequency: "occasional", state: fresh, random: always });
    expect(r.play).toBe(true);
    expect(r.state).toEqual({ lastPlayedSec: 100, lastRollSec: 100 });
    expect(decideSpookyFx({ moment: "build", currentTimeSec: 90, frequency: "occasional", state: fresh, random: always }).play).toBe(true);
  });

  it("records a failed roll so the same moment isn't rolled every tick", () => {
    const miss = decideSpookyFx({ moment: "build", currentTimeSec: 90, frequency: "occasional", state: fresh, random: never });
    expect(miss.play).toBe(false);
    expect(miss.state.lastRollSec).toBe(90);
    // 3s later (still inside the roll interval) it doesn't roll again, even with a winning roll
    expect(decideSpookyFx({ moment: "build", currentTimeSec: 93, frequency: "occasional", state: miss.state, random: always }).play).toBe(false);
    // ...but does once the interval has passed
    expect(decideSpookyFx({ moment: "build", currentTimeSec: 99, frequency: "occasional", state: miss.state, random: always }).play).toBe(true);
  });

  it("respects the cooldown after playing: 45s occasional, 18s frequent", () => {
    const played: SpookyFxState = { lastPlayedSec: 100, lastRollSec: 100 };
    expect(decideSpookyFx({ moment: "drop", currentTimeSec: 140, frequency: "occasional", state: played, random: always }).play).toBe(false);
    expect(decideSpookyFx({ moment: "drop", currentTimeSec: 146, frequency: "occasional", state: played, random: always }).play).toBe(true);
    expect(decideSpookyFx({ moment: "drop", currentTimeSec: 119, frequency: "frequent", state: played, random: always }).play).toBe(true);
  });

  it("a seek backwards doesn't lock it out", () => {
    const played: SpookyFxState = { lastPlayedSec: 150, lastRollSec: 150 };
    expect(decideSpookyFx({ moment: "drop", currentTimeSec: 30, frequency: "occasional", state: played, random: always }).play).toBe(true);
  });

  it("only rarely plays outside a build or drop", () => {
    expect(decideSpookyFx({ moment: null, currentTimeSec: 50, frequency: "occasional", state: fresh, random: never }).play).toBe(false);
    expect(decideSpookyFx({ moment: null, currentTimeSec: 50, frequency: "occasional", state: fresh, random: always }).play).toBe(true);
    let hits = 0;
    let seed = 1;
    const lcg = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 10_000; i++) {
      if (decideSpookyFx({ moment: null, currentTimeSec: 50, frequency: "occasional", state: fresh, random: lcg }).play) hits++;
    }
    expect(hits).toBeLessThan(60); // ~0.2% per tick
  });
});

describe("SPOOKY_FX_BASE_GAIN", () => {
  it("is the FX slider's default, so the slider reads as the effect's level", () => {
    expect(SPOOKY_FX_BASE_GAIN).toBe(FX_DEFAULT_LEVEL);
  });
});
