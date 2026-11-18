// Queues genre classification: for chosen tracks or a whole playlist (the "Re-classify" actions), or, with
// scope "unclassified", every song in the library that has never been classified (the backfill, at low priority).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, jsonError, notFound, unauthorized } from "@/lib/apiRoute";
import { existingTrackIds } from "@/lib/genre/api";
import { PRIORITY_BACKFILL, PRIORITY_REQUESTED } from "@/lib/genre/constants";
import { genreTablesReady, prismaJobStore } from "@/lib/genre/prismaStore";

const MAX_TRACK_IDS = 500;
const BACKFILL_BATCH = 1000;

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const userId = session.user.id;
  if (!(await genreTablesReady())) return jsonError(503, "Genre classification is not set up yet (the database tables have not been created).");

  const body = (await request.json().catch(() => null)) as { trackIds?: unknown; playlistId?: unknown; scope?: unknown } | null;
  if (!body || typeof body !== "object") return jsonError(400, "Invalid request body.");

  let ids: string[];
  let priority = PRIORITY_REQUESTED;
  if (body.scope === "unclassified") {
    const rows = await prisma.track.findMany({ where: { source: "local", genreInfo: null }, select: { id: true }, orderBy: { createdAt: "desc" }, take: BACKFILL_BATCH });
    ids = rows.map((r) => r.id);
    priority = PRIORITY_BACKFILL;
  } else if (typeof body.playlistId === "string") {
    const playlist = await prisma.playlist.findUnique({ where: { id: body.playlistId }, select: { userId: true, tracks: { select: { trackId: true } } } });
    if (!playlist || playlist.userId !== userId) return notFound("Playlist not found.");
    ids = playlist.tracks.map((t) => t.trackId);
  } else if (Array.isArray(body.trackIds) && body.trackIds.every((t) => typeof t === "string")) {
    if (body.trackIds.length > MAX_TRACK_IDS) return jsonError(400, `Re-classify at most ${MAX_TRACK_IDS} tracks at a time.`);
    ids = await existingTrackIds(body.trackIds as string[]);
  } else {
    return jsonError(400, "Give trackIds, a playlistId, or scope \"unclassified\".");
  }
  const queued = await prismaJobStore.enqueue(ids, priority);
  return NextResponse.json({ requested: ids.length, queued });
}

export const POST = apiHandler(handlePOST);
