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
// temporary) before marking the job "ready". Replicate also calls
// /api/stems/webhook when a run finishes (https deployments only), so the job
// is settled even when nobody is polling — Replicate deletes a run's output
// after about an hour, so a closed tab used to mean paid-for stems were lost.
// Polling stays as the path that works everywhere (local dev, previews).
// Both go through lib/stemJobs.ts's advanceStemJob.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend } from "@/lib/storage";
import { trackSourceUrl } from "@/lib/trackApi";
import { apiHandler, notFound, unauthorized } from "@/lib/apiRoute";
import { autoBudgetDecision } from "@/lib/stemBudget";
import { stemSummaryForUser } from "@/lib/stemSummary";
import { advanceStemJob, replicateClient, stemWebhookUrl } from "@/lib/stemJobs";

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

/** How long a "pending" (claimed, Replicate not yet called) job may sit before POST treats it as dead. */
const PENDING_STALE_MS = 2 * 60 * 1000;

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
  // `?auto=1` marks a start the app made on its own (the stem autopilot), as opposed to someone pressing the button.
  // Those are held to the spending budget and to a few jobs at a time, and a failed job is never retried by them (it
  // would be billed again for the same likely failure) — all enforced here, since a client can't be trusted with
  // the money.
  const auto = new URL(request.url).searchParams.get("auto") === "1";
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"stems:" + id}))`;
    const existing = await tx.stemSeparationJob.findFirst({ where: { trackId: id }, orderBy: { createdAt: "desc" } });
    if (existing) {
      const stalePending = existing.status === "pending" && Date.now() - existing.createdAt.getTime() > PENDING_STALE_MS;
      if (stalePending) {
        const failed = await tx.stemSeparationJob.update({
          where: { id: existing.id },
          data: { status: "failed", errorMessage: "Never reached Replicate.", completedAt: new Date() },
        });
        if (auto) return { existing: failed };
      } else if (existing.status !== "failed" || auto) {
        return { existing };
      }
    }
    if (auto) {
      const summary = await stemSummaryForUser(tx, session.user.id);
      const decision = autoBudgetDecision({ spentUsd: summary.spentUsd, inFlight: summary.inFlight, budgetUsd: summary.budgetUsd });
      if (!decision.allowed) return { blocked: { reason: decision.reason, summary } };
    }
    const job = await tx.stemSeparationJob.create({ data: { trackId: id, status: "pending", replicatePredictionId: "" } });
    return { job };
  });
  if (claim.blocked) {
    const { reason, summary } = claim.blocked;
    return NextResponse.json(
      {
        error: reason === "budget" ? "The automatic stem separation budget has been reached." : "Too many separations are already running.",
        reason,
        ...summary,
      },
      { status: reason === "budget" ? 402 : 429 }
    );
  }
  if (claim.existing) return NextResponse.json(claim.existing);
  const claimed = claim.job;

  const webhook = stemWebhookUrl(request.url);
  let prediction;
  try {
    const replicate = replicateClient();
    prediction = await replicate.predictions.create({
      version: REPLICATE_MODEL_VERSION,
      input: { audio: trackSourceUrl(track), output_format: "wav" },
      ...(webhook ? { webhook, webhook_events_filter: ["completed" as const] } : {}),
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

  try {
    return NextResponse.json(await advanceStemJob(job));
  } catch (err) {
    return NextResponse.json({ error: `Failed to check Replicate status: ${String(err)}` }, { status: 502 });
  }
}

export const POST = apiHandler(handlePOST);
export const GET = apiHandler(handleGET);
