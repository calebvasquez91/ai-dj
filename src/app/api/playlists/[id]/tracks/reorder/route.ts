import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadPlaylist, toPlaylistApiResponse } from "@/lib/playlistApi";

/** Rewrites every track's position to match the given full order — simpler and race-free versus swapping two positions at a time. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== session.user.id) {
    return new NextResponse(null, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const trackIds = Array.isArray(body?.trackIds) ? body.trackIds.filter((t: unknown) => typeof t === "string") : null;
  if (!trackIds) return NextResponse.json({ error: "trackIds must be an array of strings." }, { status: 400 });

  await prisma.$transaction(
    trackIds.map((trackId: string, position: number) =>
      prisma.playlistTrack.updateMany({
        where: { playlistId: id, trackId },
        data: { position },
      })
    )
  );

  const updated = await loadPlaylist(id);
  return NextResponse.json(toPlaylistApiResponse(updated!));
}
