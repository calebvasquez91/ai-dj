// Bulk actions for the Genre review screen: accept the best suggestion for every track waiting for review that is at least
// `minConfidence` sure of it (default 0.4), or confirm the chosen tracks as they stand. Each change is the person's own
// genres on their own tracks (source "manual"), so nothing a later re-run finds can overwrite it.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";
import { genreTablesReady, prismaGenreStore, storedFromRow } from "@/lib/genre/prismaStore";
import { acceptBest, confirmCurrent } from "@/lib/genre/stored";

const MAX_BATCH = 1000;
const DEFAULT_MIN_CONFIDENCE = 0.4;

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const userId = session.user.id;
  if (!(await genreTablesReady())) return jsonError(503, "Genre classification is not set up yet (the database tables have not been created).");

  const body = (await request.json().catch(() => null)) as { action?: unknown; minConfidence?: unknown; trackIds?: unknown } | null;
  if (!body || typeof body !== "object") return jsonError(400, "Invalid request body.");

  const now = Date.now();
  let changed = 0;
  if (body.action === "accept-above") {
    const min = typeof body.minConfidence === "number" && body.minConfidence >= 0 && body.minConfidence <= 1 ? body.minConfidence : DEFAULT_MIN_CONFIDENCE;
    const rows = await prisma.trackGenre.findMany({ where: { status: "needs-review", track: { userId } }, take: MAX_BATCH });
    for (const row of rows) {
      const next = acceptBest(storedFromRow(row), min, now);
      if (!next) continue;
      await prismaGenreStore.save(row.trackId, next);
      changed++;
    }
  } else if (body.action === "confirm") {
    if (!Array.isArray(body.trackIds) || body.trackIds.length === 0 || body.trackIds.length > MAX_BATCH || !body.trackIds.every((t) => typeof t === "string")) {
      return jsonError(400, `Give 1 to ${MAX_BATCH} trackIds.`);
    }
    const rows = await prisma.trackGenre.findMany({ where: { trackId: { in: body.trackIds as string[] }, track: { userId } } });
    for (const row of rows) {
      const next = confirmCurrent(storedFromRow(row), now);
      if (!next) continue;
      await prismaGenreStore.save(row.trackId, next);
      changed++;
    }
  } else {
    return jsonError(400, 'Give action "accept-above" or "confirm".');
  }
  const remaining = await prisma.trackGenre.count({ where: { status: "needs-review", track: { userId } } });
  return NextResponse.json({ changed, remaining });
}

export const POST = apiHandler(handlePOST);
