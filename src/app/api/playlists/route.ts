import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadUserPlaylists, toPlaylistApiResponse } from "@/lib/playlistApi";

export async function GET() {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const playlists = await loadUserPlaylists(session.user.id);
  return NextResponse.json(playlists.map(toPlaylistApiResponse));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "New Playlist";

  const playlist = await prisma.playlist.create({
    data: { userId: session.user.id, name },
  });
  return NextResponse.json(
    { id: playlist.id, name: playlist.name, createdAt: playlist.createdAt.getTime(), tracks: [] },
    { status: 201 }
  );
}
