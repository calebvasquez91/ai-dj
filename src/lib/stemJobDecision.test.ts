import { describe, expect, it } from "vitest";
import { REPLICATE_OUTPUT_TTL_MS, STEM_RUN_TIMEOUT_MS, judgeStemPrediction } from "./stemJobDecision";

const NOW = 1_000_000_000_000;
const output = { vocals: "https://r/v.wav", drums: "https://r/d.wav", bass: "https://r/b.wav", other: "https://r/o.wav" };
const base = { output: null, error: null, completedAtMs: null };

describe("judgeStemPrediction", () => {
  it("is ready with the four stem urls once Replicate succeeded", () => {
    const d = judgeStemPrediction({ ...base, status: "succeeded", output, completedAtMs: NOW - 5_000 }, NOW - 60_000, NOW);
    expect(d).toEqual({ kind: "ready", urls: output });
  });

  it("names an expired run as expired, not as a bad shape", () => {
    const d = judgeStemPrediction(
      { ...base, status: "succeeded", completedAtMs: NOW - REPLICATE_OUTPUT_TTL_MS - 1000 },
      NOW - 2 * REPLICATE_OUTPUT_TTL_MS,
      NOW
    );
    expect(d.kind).toBe("fail");
    expect(d.kind === "fail" && d.message).toMatch(/weren't collected in time/);
    expect(d.kind === "fail" && d.cancel).toBeFalsy();
  });

  it("calls a fresh success with a missing stem an unexpected output", () => {
    const d = judgeStemPrediction(
      { ...base, status: "succeeded", output: { vocals: "x", drums: "y" }, completedAtMs: NOW - 1000 },
      NOW - 60_000,
      NOW
    );
    expect(d.kind === "fail" && d.message).toMatch(/unexpected output/);
  });

  it("treats an empty-string url as missing", () => {
    const d = judgeStemPrediction({ ...base, status: "succeeded", output: { ...output, bass: "" } }, NOW - 1000, NOW);
    expect(d.kind).toBe("fail");
  });

  it("fails with Replicate's own error text", () => {
    expect(judgeStemPrediction({ ...base, status: "failed", error: "CUDA out of memory" }, NOW - 1000, NOW)).toEqual({
      kind: "fail",
      message: "CUDA out of memory",
    });
    const d = judgeStemPrediction({ ...base, status: "canceled", error: null }, NOW - 1000, NOW);
    expect(d).toEqual({ kind: "fail", message: "Unknown error" });
  });

  it("keeps waiting on a run that is within the time limit", () => {
    expect(judgeStemPrediction({ ...base, status: "processing" }, NOW - 5 * 60_000, NOW)).toEqual({ kind: "wait" });
    expect(judgeStemPrediction({ ...base, status: "starting" }, NOW - 1000, NOW)).toEqual({ kind: "wait" });
  });

  it("gives up on a run that has gone on too long, and asks for it to be cancelled", () => {
    const d = judgeStemPrediction({ ...base, status: "processing" }, NOW - STEM_RUN_TIMEOUT_MS - 1000, NOW);
    expect(d.kind).toBe("fail");
    expect(d.kind === "fail" && d.cancel).toBe(true);
  });

  it("does not time out a run that already succeeded", () => {
    const d = judgeStemPrediction({ ...base, status: "succeeded", output }, NOW - 10 * STEM_RUN_TIMEOUT_MS, NOW);
    expect(d.kind).toBe("ready");
  });
});
