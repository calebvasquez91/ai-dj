import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id, trackId } = await params;
  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== session.user.id) {
    return new NextResponse(null, { status: 404 });
  }

  await prisma.playlistTrack.deleteMany({ where: { playlistId: id, trackId } });
  return new NextResponse(null, { status: 204 });
}
