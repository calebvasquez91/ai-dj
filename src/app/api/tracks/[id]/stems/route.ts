// Real per-track stem separation (vocals/drums/bass/other) via Replicate
// (hosting Demucs — see prisma/schema.prisma's StemSeparationJob for why
// this is a separate model, not more Track columns). Computed once,
// cached forever, same philosophy as Track's own cached analysis fields —
// the only difference is this needs a real ML model, so it's a genuinely
// async, multi-minute job tracked in Postgres rather than something a
// client can just compute and persist in one request.
//
// POST kicks off a job and returns immediately with its (pending) record —
// it never waits on Replicate. GET is the poll: it checks Replicate's
// current status and, the first time it sees "succeeded", pulls the 4 stem
// files into this app's own Blob storage (Replicate's own output URLs are
// temporary) before marking the job "ready". No webhook for this pass —
// polling works identically in every environment with no extra setup, and
// there's no existing job/webhook infrastructure in this app to extend
// either way; a webhook is a natural, easy follow-up once this is proven
// out and used at real volume.
import { NextResponse } from "next/server";
import Replicate from "replicate";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend, uploadBlobFile } from "@/lib/storage";
import { trackSourceUrl } from "@/lib/trackApi";
import { apiHandler, notFound, unauthorized } from "@/lib/apiRoute";

/**
 * ryan5453/demucs's currently-deployed version, pinned explicitly rather
 * than by model name: this model has `is_official: false`, and Replicate's
 * `/v1/models/{owner}/{name}/predictions` shorthand 404s for non-official
 * models — confirmed by directly hitting the API, not assumed. The classic
 * `/v1/predictions` + explicit `version` route (what the SDK's `version:`
 * option below uses) is the one that actually works. Re-checked directly
 * against the model's own `/v1/models/ryan5453/demucs` API response
 * (2026-09-22): this is its real `latest_version.id`, and its real
 * (undocumented-in-the-static-schema, empirically confirmed) input field is
 * `output_format` — not `format` — defaulting to lossy `mp3` if omitted, so
 * it's passed explicitly as `"wav"` below.
 */
const REPLICATE_MODEL_VERSION = "5a7041cc9b82e5a558fea6b3d7b12dea89625e89da33f0447bd727c2d0ab9e77";

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

/** How long a "pending" (claimed, Replicate not yet called) job may sit before POST treats it as dead. */
const PENDING_STALE_MS = 2 * 60 * 1000;

type StemName = "vocals" | "drums" | "bass" | "other";
const STEM_NAMES: readonly StemName[] = ["vocals", "drums", "bass", "other"];

function replicateClient(): Replicate {
  const auth_token = process.env.REPLICATE_API_TOKEN;
  if (!auth_token) throw new Error("REPLICATE_API_TOKEN is not set.");
  return new Replicate({ auth: auth_token });
}

async function loadOwnedTrack(id: string, userId: string) {
  const track = await prisma.track.findUnique({ where: { id } });
  if (!track || track.userId !== userId) return null;
  return track;
}

function latestJob(trackId: string) {
  return prisma.stemSeparationJob.findFirst({ where: { trackId }, orderBy: { createdAt: "desc" } });
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const track = await loadOwnedTrack(id, session.user.id);
  if (!track) return notFound();

  if (track.source !== "local") {
    return NextResponse.json(
      { error: "Stem separation needs the track's real audio bytes — only local tracks have them." },
      { status: 400 }
    );
  }
  if (getStorageBackend() !== "blob") {
    return NextResponse.json(
      { error: 'Stem separation requires NEXT_PUBLIC_STORAGE_BACKEND="blob" — Replicate needs a publicly reachable audio URL to fetch.' },
      { status: 400 }
    );
  }

  // Idempotent: an in-flight or already-finished job is returned as-is
  // rather than double-submitted; a failed one is retried as a fresh row.
  // The check and the claim (a "pending" row) happen under a per-track
  // advisory lock BEFORE the paid Replicate call — previously two concurrent
  // POSTs (double click, two tabs) both saw "no job" and each started (and
  // were billed for) their own prediction. A "pending" row older than
  // PENDING_STALE_MS means the process that claimed it died before reaching
  // Replicate; it is treated as failed so the track is not stuck forever.
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"stems:" + id}))`;
    const existing = await tx.stemSeparationJob.findFirst({ where: { trackId: id }, orderBy: { createdAt: "desc" } });
    if (existing) {
      const stalePending = existing.status === "pending" && Date.now() - existing.createdAt.getTime() > PENDING_STALE_MS;
      if (stalePending) {
        await tx.stemSeparationJob.update({
          where: { id: existing.id },
          data: { status: "failed", errorMessage: "Never reached Replicate.", completedAt: new Date() },
        });
      } else if (existing.status !== "failed") {
        return { existing };
      }
    }
    const job = await tx.stemSeparationJob.create({ data: { trackId: id, status: "pending", replicatePredictionId: "" } });
    return { job };
  });
  if (claim.existing) return NextResponse.json(claim.existing);
  const claimed = claim.job;

  let prediction;
  try {
    const replicate = replicateClient();
    prediction = await replicate.predictions.create({
      version: REPLICATE_MODEL_VERSION,
      input: { audio: trackSourceUrl(track), output_format: "wav" },
    });
  } catch (err) {
    await prisma.stemSeparationJob
      .update({ where: { id: claimed.id }, data: { status: "failed", errorMessage: String(err), completedAt: new Date() } })
      .catch(() => {});
    return NextResponse.json({ error: `Failed to start Replicate prediction: ${String(err)}` }, { status: 502 });
  }

  const job = await prisma.stemSeparationJob.update({
    where: { id: claimed.id },
    data: { status: "processing", replicatePredictionId: prediction.id, replicateModelVersion: prediction.version },
  });

  return NextResponse.json(job, { status: 201 });
}

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const track = await loadOwnedTrack(id, session.user.id);
  if (!track) return notFound();

  const job = await latestJob(id);
  // "No job yet" is the normal state for most tracks (nobody's run Separate
  // Stems on them) — a 200 with a null body, not a 404, since this is now
  // polled automatically in the background for every queued track
  // (DualDeckStage's vocal-layering eligibility check), not just fetched
  // once by a manual button click. A 404 here would mean every un-separated
  // track spams the console every session.
  if (!job) return NextResponse.json(null);

  // Already resolved — no need to ask Replicate again. A still-"pending" job
  // hasn't been handed to Replicate yet (POST is mid-flight) — nothing to poll.
  if (job.status === "ready" || job.status === "failed" || !job.replicatePredictionId) {
    return NextResponse.json(job);
  }

  let prediction;
  try {
    const replicate = replicateClient();
    prediction = await replicate.predictions.get(job.replicatePredictionId);
  } catch (err) {
    return NextResponse.json({ error: `Failed to check Replicate status: ${String(err)}` }, { status: 502 });
  }

  if (prediction.status === "succeeded") {
    const output = prediction.output as Partial<Record<StemName, string>> | null;
    if (!output || STEM_NAMES.some((stem) => typeof output[stem] !== "string")) {
      const failed = await prisma.stemSeparationJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: "Replicate returned an unexpected output shape.", completedAt: new Date() },
      });
      return NextResponse.json(failed);
    }
    const uploaded = await Promise.all(
      STEM_NAMES.map(async (stem) => {
        const res = await fetch(output[stem] as string);
        // Without this check a 4xx/5xx HTML error page was uploaded as the
        // "stem" and the job marked ready with corrupt audio.
        if (!res.ok) throw new Error(`Fetching the ${stem} stem failed (${res.status}).`);
        const buffer = Buffer.from(await res.arrayBuffer());
        // Replicate's own delivery URLs serve these as application/octet-stream
        // regardless of actual format — we know it's really WAV since that's
        // what we requested via output_format above, so set it explicitly
        // rather than trusting (or falling back past) their generic header.
        const url = await uploadBlobFile(`stems/${id}/${job.id}-${stem}.wav`, buffer, "audio/wav");
        return [stem, url] as const;
      })
    );
    const urls = Object.fromEntries(uploaded) as Record<StemName, string>;
    const predictTimeSec = prediction.metrics?.predict_time ?? null;

    const updated = await prisma.stemSeparationJob.update({
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
    return NextResponse.json(updated);
  }

  if (prediction.status === "failed" || prediction.status === "canceled" || prediction.status === "aborted") {
    const updated = await prisma.stemSeparationJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: typeof prediction.error === "string" ? prediction.error : JSON.stringify(prediction.error ?? "Unknown error"),
        completedAt: new Date(),
      },
    });
    return NextResponse.json(updated);
  }

  // Still "starting"/"processing" on Replicate's side — nothing new yet.
  return NextResponse.json(job);
}

export const POST = apiHandler(handlePOST);
export const GET = apiHandler(handleGET);
