// Replicate calls this when a stem separation run finishes (see the stems route, which registers it). It is how a job
// gets settled — and its stems saved to Blob before Replicate deletes them — when nobody has the app open to poll.
//
// There is no session here and the body is not trusted: it is only used to find which job to look at, and the
// job's state is then read from Replicate itself (advanceStemJob). A forged call can therefore do nothing but
// trigger a status check on a prediction id that already exists in our own table.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/apiRoute";
import { advanceStemJob } from "@/lib/stemJobs";

// Pulling four WAV stems into Blob can outlast the platform's default function timeout.
export const maxDuration = 60;

async function handlePOST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const predictionId = typeof body?.id === "string" ? body.id : "";
  if (!predictionId) return NextResponse.json({ error: "Missing prediction id." }, { status: 400 });

  const job = await prisma.stemSeparationJob.findFirst({ where: { replicatePredictionId: predictionId } });
  // 404 is deliberate: a very fast run can finish before the route that started it has saved the prediction id on
  // the job row, and Replicate retries a non-2xx webhook — so the retry finds it.
  if (!job) return NextResponse.json({ error: "Unknown prediction." }, { status: 404 });

  // A thrown error is a 500, which Replicate also retries.
  const settled = await advanceStemJob(job);
  return NextResponse.json({ id: settled.id, status: settled.status });
}

export const POST = apiHandler(handlePOST);
