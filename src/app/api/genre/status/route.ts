// What genre classification is doing for the shared library: how many tracks are waiting, running or failed, how many
// need review, and which tracks have an active job (for the progress chip on a track card).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { genreTablesReady } from "@/lib/genre/prismaStore";

async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();
  if (!(await genreTablesReady())) {
    return NextResponse.json({ ready: false, queued: 0, running: 0, failed: 0, needsReview: 0, unclassified: 0, jobs: {} });
  }
  // Finished jobs are deleted, so this holds only waiting, running and given-up jobs (about one per track at most). The latest
  // job of each track decides its state.
  const rows = await prisma.genreJob.findMany({
    orderBy: { createdAt: "desc" },
    select: { trackId: true, status: true },
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
    prisma.trackGenre.count({ where: { status: "needs-review" } }),
    prisma.track.count({ where: { source: "local", genreInfo: null } }),
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
