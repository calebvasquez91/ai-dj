import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadPlaylist, toPlaylistApiResponse } from "@/lib/playlistApi";
import { planReorder } from "@/lib/playlistReorder";
import { apiHandler, jsonError, notFound, unauthorized } from "@/lib/apiRoute";

/** Rewrites the positions that changed to match the given full order — the submitted order must be exactly the playlist's current membership (409 otherwise, so a stale client re-syncs instead of corrupting the order). */
async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== session.user.id) {
    return notFound();
  }

  const body = await request.json().catch(() => null);
  const trackIds: string[] | null = Array.isArray(body?.trackIds) && body.trackIds.every((t: unknown) => typeof t === "string")
    ? body.trackIds
    : null;
  if (!trackIds) return NextResponse.json({ error: "trackIds must be an array of strings." }, { status: 400 });

  // The membership check and the writes share one transaction (with the same
  // per-playlist advisory lock the add-track route takes) so a concurrent add
  // can't slip a row in between the check and the position rewrite.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const current = await tx.playlistTrack.findMany({ where: { playlistId: id }, select: { trackId: true, position: true } });
    const plan = planReorder(current, trackIds);
    if (!plan.ok) return plan;
    for (const u of plan.updates) {
      await tx.playlistTrack.updateMany({ where: { playlistId: id, trackId: u.trackId }, data: { position: u.position } });
    }
    return plan;
  });
  if (!outcome.ok) {
    return jsonError(
      outcome.reason === "duplicate-ids" ? 400 : 409,
      outcome.reason === "duplicate-ids"
        ? "trackIds must not contain duplicates."
        : "The playlist changed — reload it and try again."
    );
  }

  const updated = await loadPlaylist(id);
  if (!updated) return notFound();
  return NextResponse.json(toPlaylistApiResponse(updated));
}

export const PATCH = apiHandler(handlePATCH);
