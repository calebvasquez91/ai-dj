import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadPlaylist, toPlaylistApiResponse } from "@/lib/playlistApi";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== session.user.id) {
    return new NextResponse(null, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const trackId = typeof body?.trackId === "string" ? body.trackId : "";
  if (!trackId) return NextResponse.json({ error: "trackId is required." }, { status: 400 });

  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track || track.userId !== session.user.id) {
    return NextResponse.json({ error: "Track not found." }, { status: 404 });
  }

  const last = await prisma.playlistTrack.findFirst({
    where: { playlistId: id },
    orderBy: { position: "desc" },
  });

  await prisma.playlistTrack.upsert({
    where: { playlistId_trackId: { playlistId: id, trackId } },
    create: { playlistId: id, trackId, position: (last?.position ?? -1) + 1 },
    update: {}, // already in the playlist — no-op, matches the old client-side "don't duplicate" check
  });

  const updated = await loadPlaylist(id);
  return NextResponse.json(toPlaylistApiResponse(updated!), { status: 201 });
}
