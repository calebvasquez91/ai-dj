// Bulk actions for the Genre review screen: accept the best suggestion for every track waiting for review that is at least
// `minConfidence` sure of it (default 0.4), or confirm the chosen tracks as they stand. Each change is a manual genre
// (source "manual") on a shared song, so nothing a later re-run finds can overwrite it, and only the admin may make it.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";
import { isAdmin } from "@/lib/feedbackAdmin";
import { genreTablesReady, prismaGenreStore, storedFromRow } from "@/lib/genre/prismaStore";
import { acceptBest, confirmCurrent, type StoredGenre } from "@/lib/genre/stored";

const MAX_BATCH = 1000;
/** "Accept all" looks at the needs-review tracks a page at a time, up to this many in one request. */
const PAGE = 500;
const MAX_SCAN = 5000;
const DEFAULT_MIN_CONFIDENCE = 0.4;

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.id)) return jsonError(403, "Only the admin can change a song's genres.");
  if (!(await genreTablesReady())) return jsonError(503, "Genre classification is not set up yet (the database tables have not been created).");

  const body = (await request.json().catch(() => null)) as { action?: unknown; minConfidence?: unknown; trackIds?: unknown } | null;
  if (!body || typeof body !== "object") return jsonError(400, "Invalid request body.");

  const now = Date.now();
  let changed = 0;
  if (body.action === "accept-above") {
    const min = typeof body.minConfidence === "number" && body.minConfidence >= 0 && body.minConfidence <= 1 ? body.minConfidence : DEFAULT_MIN_CONFIDENCE;
    // Walks the tracks waiting for review by id, page by page, keeping those with a suggestion above the bar. Reading only the first
    // rows would stall once they held nothing acceptable: the same rows would come back on every click.
    const updates: { trackId: string; stored: StoredGenre }[] = [];
    let cursor: string | undefined;
    for (let scanned = 0; scanned < MAX_SCAN && updates.length < MAX_BATCH; scanned += PAGE) {
      const rows = await prisma.trackGenre.findMany({
        where: { status: "needs-review" },
        orderBy: { trackId: "asc" },
        take: PAGE,
        ...(cursor ? { cursor: { trackId: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) {
        const next = acceptBest(storedFromRow(row), min, now);
        if (next) updates.push({ trackId: row.trackId, stored: next });
      }
      if (rows.length < PAGE) break;
      cursor = rows[rows.length - 1].trackId;
    }
    await prismaGenreStore.saveMany(updates);
    changed = updates.length;
  } else if (body.action === "confirm") {
    if (!Array.isArray(body.trackIds) || body.trackIds.length === 0 || body.trackIds.length > MAX_BATCH || !body.trackIds.every((t) => typeof t === "string")) {
      return jsonError(400, `Give 1 to ${MAX_BATCH} trackIds.`);
    }
    const rows = await prisma.trackGenre.findMany({ where: { trackId: { in: body.trackIds as string[] } } });
    const updates: { trackId: string; stored: StoredGenre }[] = [];
    for (const row of rows) {
      const next = confirmCurrent(storedFromRow(row), now);
      if (next) updates.push({ trackId: row.trackId, stored: next });
    }
    await prismaGenreStore.saveMany(updates);
    changed = updates.length;
  } else {
    return jsonError(400, 'Give action "accept-above" or "confirm".');
  }
  const remaining = await prisma.trackGenre.count({ where: { status: "needs-review" } });
  return NextResponse.json({ changed, remaining });
}

export const POST = apiHandler(handlePOST);
