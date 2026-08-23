import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadPlaylist, toPlaylistApiResponse } from "@/lib/playlistApi";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const existing = await prisma.playlist.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return new NextResponse(null, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });

  await prisma.playlist.update({ where: { id }, data: { name } });
  const playlist = await loadPlaylist(id);
  return NextResponse.json(toPlaylistApiResponse(playlist!));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const existing = await prisma.playlist.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return new NextResponse(null, { status: 404 });
  }

  await prisma.playlist.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
