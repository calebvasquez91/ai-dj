// Receives the player's listening report: { segments: [{ trackId, playlistId?, seconds }] }. Each segment becomes one PlayEvent row for
// the signed-in account, with the song's title, artist and genre and the playlist's name copied in. Never fails the player: bad
// entries are dropped, and with the table missing (prisma/play-stats.sql not run yet) the report is simply not kept.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { parsePlaySegments } from "@/lib/playStats";

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  const segments = parsePlaySegments(body);
  if (segments.length === 0) return NextResponse.json({ recorded: 0 });

  const trackIds = [...new Set(segments.map((s) => s.trackId))];
  const playlistIds = [...new Set(segments.flatMap((s) => (s.playlistId ? [s.playlistId] : [])))];
  const [tracks, playlists] = await Promise.all([
    prisma.track.findMany({ where: { id: { in: trackIds } }, select: { id: true, title: true, artist: true } }),
    playlistIds.length > 0 ? prisma.playlist.findMany({ where: { id: { in: playlistIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const playlistById = new Map(playlists.map((p) => [p.id, p]));

  // The genre at the time of listening. The genre tables may not be there; the song is then simply recorded without one.
  const genreById = new Map<string, string | null>();
  try {
    const rows = await prisma.trackGenre.findMany({ where: { trackId: { in: trackIds } }, select: { trackId: true, genre: true } });
    for (const r of rows) genreById.set(r.trackId, r.genre);
  } catch {
    // no genre data yet
  }

  const data = segments.flatMap((s) => {
    const track = trackById.get(s.trackId);
    if (!track) return []; // a song that does not exist is not recorded
    const playlist = s.playlistId ? playlistById.get(s.playlistId) : undefined;
    return [
      {
        userId: session.user.id,
        trackId: track.id,
        playlistId: playlist?.id ?? null,
        title: track.title,
        artist: track.artist,
        genre: genreById.get(track.id) ?? null,
        playlistName: playlist?.name ?? null,
        seconds: s.seconds,
      },
    ];
  });
  if (data.length === 0) return NextResponse.json({ recorded: 0 });

  try {
    const result = await prisma.playEvent.createMany({ data });
    return NextResponse.json({ recorded: result.count });
  } catch (err) {
    console.warn("Could not record listening time (has prisma/play-stats.sql been run?):", err);
    return NextResponse.json({ recorded: 0 });
  }
}

export const POST = apiHandler(handlePOST);
