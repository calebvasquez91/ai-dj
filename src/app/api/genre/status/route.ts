// What genre classification is doing for the signed-in person: how many tracks are waiting, running or failed, how many
// need review, and which tracks have an active job (for the progress chip on a track card).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { genreTablesReady } from "@/lib/genre/prismaStore";

async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();
  const userId = session.user.id;
  if (!(await genreTablesReady())) {
    return NextResponse.json({ ready: false, queued: 0, running: 0, failed: 0, needsReview: 0, unclassified: 0, jobs: {} });
  }
  // The latest job of each track decides its state: an old failure that a later run fixed is not a failure.
  const rows = await prisma.genreJob.findMany({
    where: { track: { userId } },
    orderBy: { createdAt: "desc" },
    select: { trackId: true, status: true },
    take: 5000,
  });
  const jobs: Record<string, "queued" | "running" | "failed"> = {};
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.trackId)) continue;
    seen.add(r.trackId);
    if (r.status === "queued" || r.status === "running" || r.status === "failed") jobs[r.trackId] = r.status;
  }
  const states = Object.values(jobs);
  const [needsReview, unclassified] = await Promise.all([
    prisma.trackGenre.count({ where: { status: "needs-review", track: { userId } } }),
    prisma.track.count({ where: { userId, genreInfo: null } }),
  ]);
  return NextResponse.json({
    ready: true,
    queued: states.filter((s) => s === "queued").length,
    running: states.filter((s) => s === "running").length,
    failed: states.filter((s) => s === "failed").length,
    needsReview,
    unclassified,
    jobs,
  });
}

export const GET = apiHandler(handleGET);
