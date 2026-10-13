/**
 * What to do with a stem separation job given what Replicate currently says about its prediction. Pure — the stems
 * route (a client polling) and the Replicate webhook both run it, so a job is settled the same way whoever notices
 * the prediction first.
 *
 * Two failure modes this exists to name clearly instead of leaving a job "processing" for weeks:
 *  - Replicate deletes a finished run's output files after about an hour. A job nobody collected in time comes back
 *    "succeeded" with no usable output; that is "expired", not a mysterious bad shape.
 *  - A run that never finishes (or a job whose prediction was never created) must not hold a budget slot forever.
 */

export const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEM_NAMES)[number];

/** A job still running after this long is given up on (and cancelled so it stops billing). A real run takes under a minute or two. */
export const STEM_RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** Replicate keeps a finished prediction's output about this long. */
export const REPLICATE_OUTPUT_TTL_MS = 60 * 60 * 1000;

export interface StemPredictionView {
  /** Replicate's prediction status: starting | processing | succeeded | failed | canceled | aborted. */
  status: string;
  output: unknown;
  error: unknown;
  /** When Replicate finished the run (its `completed_at`), epoch ms, or null. */
  completedAtMs: number | null;
}

export type StemJobDecision =
  | { kind: "wait" }
  | { kind: "ready"; urls: Record<StemName, string> }
  | { kind: "fail"; message: string; cancel?: boolean };

function stemUrls(output: unknown): Record<StemName, string> | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const urls: Partial<Record<StemName, string>> = {};
  for (const name of STEM_NAMES) {
    const value = record[name];
    if (typeof value !== "string" || value === "") return null;
    urls[name] = value;
  }
  return urls as Record<StemName, string>;
}

function errorText(error: unknown): string {
  if (typeof error === "string" && error) return error;
  if (error == null) return "Unknown error";
  return JSON.stringify(error);
}

export function judgeStemPrediction(
  prediction: StemPredictionView,
  jobCreatedAtMs: number,
  now: number = Date.now()
): StemJobDecision {
  const { status } = prediction;

  if (status === "succeeded") {
    const urls = stemUrls(prediction.output);
    if (urls) return { kind: "ready", urls };
    const finishedAgo = prediction.completedAtMs != null ? now - prediction.completedAtMs : null;
    if (finishedAgo != null && finishedAgo >= REPLICATE_OUTPUT_TTL_MS) {
      return {
        kind: "fail",
        message:
          "The stems finished but weren't collected in time — Replicate deletes a run's files after about an hour. Separate the track again.",
      };
    }
    return { kind: "fail", message: "Replicate finished but returned no usable stems (unexpected output)." };
  }

  if (status === "failed" || status === "canceled" || status === "aborted") {
    return { kind: "fail", message: errorText(prediction.error) };
  }

  // starting / processing (or a status we don't know yet): wait, unless it has been far too long.
  if (now - jobCreatedAtMs > STEM_RUN_TIMEOUT_MS) {
    return {
      kind: "fail",
      message: `Gave up: separation hadn't finished after ${Math.round(STEM_RUN_TIMEOUT_MS / 60000)} minutes.`,
      cancel: true,
    };
  }
  return { kind: "wait" };
}
