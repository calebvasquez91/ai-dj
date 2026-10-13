/**
 * Server-side: bring a stem separation job up to date with its Replicate prediction. Called from two places that race
 * harmlessly — the stems route (a client polling) and the Replicate webhook (nobody needs to be watching). Both write
 * the same bytes to the same blob paths and the same job row, so whoever gets there second just re-saves the result.
 */
import Replicate from "replicate";
import { prisma } from "@/lib/prisma";
import { uploadBlobFile } from "@/lib/storage";
import { STEM_NAMES, judgeStemPrediction, type StemName } from "@/lib/stemJobDecision";

/**
 * Replicate's prediction API reports compute time (metrics.predict_time),
 * never a dollar figure, directly — you multiply by the model's per-second
 * hardware rate yourself. This is the rate replicate.com/ryan5453/demucs
 * itself displayed (Nvidia A100 40GB, ~$0.027 for a ~24s example run),
 * checked 2026-09-21. Replicate's general pricing page only lists an 80GB
 * A100 tier, so this model-specific figure may drift from it — cross-check
 * estimatedCostUsd against your own Replicate billing dashboard during your
 * 2-3-track test and adjust this constant if it's off.
 */
const COST_PER_SECOND_USD = 0.027 / 24;

export function replicateClient(): Replicate {
  const auth_token = process.env.REPLICATE_API_TOKEN;
  if (!auth_token) throw new Error("REPLICATE_API_TOKEN is not set.");
  return new Replicate({ auth: auth_token });
}

/** The slice of a StemSeparationJob row this needs. */
export interface StemJobRow {
  id: string;
  trackId: string;
  status: string;
  replicatePredictionId: string;
  createdAt: Date;
}

/**
 * Settles `job` if Replicate has finished with it. Returns the (possibly updated) row. Throws if Replicate can't be
 * reached or a stem can't be saved — the job is left as it was so the next poll or webhook retry tries again.
 */
export async function advanceStemJob<T extends StemJobRow>(job: T) {
  // Already resolved — no need to ask Replicate again. A still-"pending" job
  // hasn't been handed to Replicate yet (POST is mid-flight) — nothing to poll.
  if (job.status === "ready" || job.status === "failed" || !job.replicatePredictionId) return job;

  const replicate = replicateClient();
  const prediction = await replicate.predictions.get(job.replicatePredictionId);
  const completedAt = (prediction as { completed_at?: string | null }).completed_at;
  const decision = judgeStemPrediction(
    {
      status: prediction.status,
      output: prediction.output,
      error: prediction.error,
      completedAtMs: completedAt ? Date.parse(completedAt) : null,
    },
    job.createdAt.getTime()
  );

  if (decision.kind === "wait") return job;

  if (decision.kind === "fail") {
    if (decision.cancel) await replicate.predictions.cancel(job.replicatePredictionId).catch(() => {});
    return prisma.stemSeparationJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: decision.message, completedAt: new Date() },
    });
  }

  const uploaded = await Promise.all(
    STEM_NAMES.map(async (stem: StemName) => {
      const res = await fetch(decision.urls[stem]);
      // Without this check a 4xx/5xx HTML error page was uploaded as the
      // "stem" and the job marked ready with corrupt audio.
      if (!res.ok) throw new Error(`Fetching the ${stem} stem failed (${res.status}).`);
      const buffer = Buffer.from(await res.arrayBuffer());
      // Replicate's own delivery URLs serve these as application/octet-stream
      // regardless of actual format — we know it's really WAV since that's
      // what we requested via output_format, so set it explicitly rather than
      // trusting (or falling back past) their generic header.
      const url = await uploadBlobFile(`stems/${job.trackId}/${job.id}-${stem}.wav`, buffer, "audio/wav");
      return [stem, url] as const;
    })
  );
  const urls = Object.fromEntries(uploaded) as Record<StemName, string>;
  const predictTimeSec = prediction.metrics?.predict_time ?? null;

  return prisma.stemSeparationJob.update({
    where: { id: job.id },
    data: {
      status: "ready",
      vocalsUrl: urls.vocals,
      drumsUrl: urls.drums,
      bassUrl: urls.bass,
      otherUrl: urls.other,
      predictTimeSec,
      estimatedCostUsd: predictTimeSec != null ? predictTimeSec * COST_PER_SECOND_USD : null,
      replicateModelVersion: prediction.version,
      completedAt: new Date(),
    },
  });
}

/**
 * The URL Replicate should call when a run finishes, or null when it can't reach this server (local dev, or any
 * non-https origin) — in which case the client's polling is the only path, exactly as before.
 */
export function stemWebhookUrl(requestUrl: string): string | null {
  let origin: URL;
  try {
    origin = new URL(process.env.STEM_WEBHOOK_BASE_URL || requestUrl);
  } catch {
    return null;
  }
  const host = origin.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost") || host.endsWith(".test");
  if (origin.protocol !== "https:" || local) return null;
  return `${origin.origin}/api/stems/webhook`;
}
