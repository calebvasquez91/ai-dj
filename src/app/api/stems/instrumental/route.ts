// Builds the vocal-free mix (and the vocal activity timeline) for ONE finished stem job per call: the low-priority background job behind VOCAL_SPLIT_ENABLED.
// It only works from stems that already exist (it never starts a paid separation) and does nothing while the feature is off. A scheduler can call it
// (GET or POST with `Authorization: Bearer $CRON_SECRET`); a signed-in POST works too. Until prisma/vocal-split.sql has been run it answers { ready: false }.
// The result is for playback inside the app: nothing here offers a download.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { isScheduler } from "./cronAuth";
import { VOCAL_SPLIT_ENABLED } from "@/lib/featureFlags";
import { isMissingTable } from "@/lib/missingTable";
import { prisma } from "@/lib/prisma";
import { uploadBlobFile } from "@/lib/storage";
import { buildInstrumental } from "@/lib/stemInstrumental";

export const maxDuration = 60;

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetching a stem failed (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
};

async function run(request: Request, schedulerOnly = false) {
  const scheduler = isScheduler(request);
  if (schedulerOnly && !scheduler) return unauthorized();
  if (!scheduler && !(await auth())) return unauthorized();
  if (!VOCAL_SPLIT_ENABLED) return NextResponse.json({ enabled: false, built: 0, remaining: 0 });
  try {
    const todo = { status: "ready", instrumentalUrl: null, vocalsUrl: { not: null }, drumsUrl: { not: null }, bassUrl: { not: null }, otherUrl: { not: null } } as const;
    const job = await prisma.stemSeparationJob.findFirst({ where: todo, orderBy: { createdAt: "asc" } });
    if (!job) return NextResponse.json({ enabled: true, ready: true, built: 0, remaining: 0 });
    try {
      const result = await buildInstrumental(job, { fetchBytes, store: (path, bytes, type) => uploadBlobFile(path, Buffer.from(bytes), type) });
      await prisma.stemSeparationJob.update({ where: { id: job.id }, data: { instrumentalUrl: result.instrumentalUrl, instrumentalBuiltAt: new Date(), vocalActivityJson: JSON.stringify(result.voiceMap) } });
    } catch (err) {
      // A bad stem or a storage hiccup leaves the job as it was; the next call tries the next one, and this one again later.
      console.warn("[instrumental] could not build one:", err instanceof Error ? err.message : err);
      return NextResponse.json({ enabled: true, ready: true, built: 0, failed: 1, remaining: await prisma.stemSeparationJob.count({ where: todo }) });
    }
    return NextResponse.json({ enabled: true, ready: true, built: 1, remaining: await prisma.stemSeparationJob.count({ where: todo }) });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ enabled: true, ready: false, built: 0, remaining: 0 });
    throw err;
  }
}

export const POST = apiHandler((request: Request) => run(request));
// Schedulers send GET. A GET changes things, so only the scheduler's secret is accepted on it.
export const GET = apiHandler((request: Request) => run(request, true));
