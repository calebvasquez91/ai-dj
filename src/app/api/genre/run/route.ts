// Works through queued genre-classification jobs. The app calls it (POST) while a person has jobs waiting, and a scheduler
// can call it (GET or POST with `Authorization: Bearer $CRON_SECRET`; with no secret, only a signed-in POST works) to drain every user's queue. A call takes a few
// jobs and returns whether there are more, so the caller just asks again; the one-request-a-second limit on MusicBrainz is
// held across calls by the database (src/lib/genre/prismaServices.ts).
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { runJobs } from "@/lib/genre/jobs";
import { genreTablesReady } from "@/lib/genre/prismaStore";
import { buildRunnerDeps } from "@/lib/genre/server";

export const maxDuration = 60;

/** True for a request carrying the scheduler's secret. With CRON_SECRET unset nothing counts as the scheduler. */
function isScheduler(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

async function drain(request: Request, schedulerOnly = false) {
  const scheduler = isScheduler(request);
  if (schedulerOnly && !scheduler) return unauthorized();
  const session = scheduler ? null : await auth();
  if (!scheduler && !session) return unauthorized();
  if (!(await genreTablesReady())) return NextResponse.json({ ready: false, processed: 0, failed: 0, retrying: 0, more: false });
  const summary = await runJobs(buildRunnerDeps(), {
    maxJobs: scheduler ? 8 : 3,
    budgetMs: 40_000,
    userId: scheduler ? undefined : session!.user.id,
  });
  return NextResponse.json({ ready: true, ...summary });
}

export const POST = apiHandler((request: Request) => drain(request));
// Schedulers send GET. A GET changes things, so only the scheduler's secret is accepted on it.
export const GET = apiHandler((request: Request) => drain(request, true));
