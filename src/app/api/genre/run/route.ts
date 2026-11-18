// Works through queued genre-classification jobs. The app calls it (POST) while a person has jobs waiting, and a scheduler
// can call it (GET or POST with `Authorization: Bearer $CRON_SECRET`; with no secret, only a signed-in POST works) to drain the queue with nobody having the app open (vercel.json runs it every minute). A call takes a few
// jobs and returns whether there are more, so the caller just asks again; the one-request-a-second limit on MusicBrainz is
// held across calls by the database (src/lib/genre/prismaServices.ts).
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { runJobs } from "@/lib/genre/jobs";
import { loadGenreFields, queueBackfillTopUp } from "@/lib/genre/api";
import { genreTablesReady, pruneGenreHousekeeping } from "@/lib/genre/prismaStore";
import { buildRunnerDeps } from "@/lib/genre/server";

export const maxDuration = 60;

/**
 * What one scheduled call may do: the app's own calls take 3 jobs, a scheduled one (every minute) takes more. A job can run a few
 * seconds past the budget while it waits for a source, so the budget leaves room under maxDuration.
 */
const SCHEDULER_MAX_JOBS = 20;
const SCHEDULER_BUDGET_MS = 45_000;

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
  if (!(await genreTablesReady())) return NextResponse.json({ ready: false, processed: 0, failed: 0, retrying: 0, more: false, processedIds: [], fields: {} });
  const summary = await runJobs(buildRunnerDeps(), {
    maxJobs: scheduler ? SCHEDULER_MAX_JOBS : 3,
    budgetMs: scheduler ? SCHEDULER_BUDGET_MS : 40_000,
  });
  await pruneGenreHousekeeping();
  // With the queue dry, the scheduler lines up the next batch of never-classified songs, so a big library is worked through to
  // the end without anybody opening the app.
  const toppedUp = scheduler && !summary.more ? await queueBackfillTopUp() : 0;
  // The app reads back just the tracks this run changed (not its whole library) to show their new genres.
  const fields = scheduler ? {} : Object.fromEntries(await loadGenreFields(summary.processedIds));
  return NextResponse.json({ ready: true, ...summary, toppedUp, fields });
}

export const POST = apiHandler((request: Request) => drain(request));
// Schedulers send GET. A GET changes things, so only the scheduler's secret is accepted on it.
export const GET = apiHandler((request: Request) => drain(request, true));
