import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, notFound, unauthorized } from "@/lib/apiRoute";

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id, trackId } = await params;
  const playlist = await prisma.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== session.user.id) {
    return notFound();
  }

  await prisma.playlistTrack.deleteMany({ where: { playlistId: id, trackId } });
  return new NextResponse(null, { status: 204 });
}

export const DELETE = apiHandler(handleDELETE);
