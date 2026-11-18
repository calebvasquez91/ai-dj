// Receives the player's listening report: { segments: [{ trackId, playlistId?, seconds }] }. Each segment is added to the signed-in
// account's PlayEvent for that song and playlist (one row while the reports keep coming, a new one after a pause), with the song's
// title, artist and genre and the playlist's name copied in. A report is measured against the clock: it is credited with no more than
// the time since the account's last report allows, and nobody can be credited more than a day in a day. Never fails the player: bad
// entries are dropped, and with the table missing (prisma/play-stats.sql not run yet) the report is simply not kept.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { DAILY_CAP_SECONDS, fitToBudget, parsePlaySegments, reportBudgetSeconds } from "@/lib/playStats";

/** Reports for the same song and playlist within this long of the previous one are added into the same row. */
const MERGE_WINDOW_MS = 10 * 60 * 1000;

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = parsePlaySegments(body);
  if (parsed.length === 0) return NextResponse.json({ recorded: 0 });

  const trackIds = [...new Set(parsed.map((s) => s.trackId))];
  const playlistIds = [...new Set(parsed.flatMap((s) => (s.playlistId ? [s.playlistId] : [])))];
  const [tracks, playlists] = await Promise.all([
    prisma.track.findMany({ where: { id: { in: trackIds } }, select: { id: true, title: true, artist: true } }),
    // Only the account's own playlists count: a report cannot credit listening to somebody else's playlist.
    playlistIds.length > 0 ? prisma.playlist.findMany({ where: { id: { in: playlistIds }, userId }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const playlistById = new Map(playlists.map((p) => [p.id, p]));

  // The song's genre now. The genre tables may not be there; the song is then simply recorded without one (the statistics read the
  // current genre when they are shown, so this is only what a deleted song keeps).
  const genreById = new Map<string, string | null>();
  try {
    const rows = await prisma.trackGenre.findMany({ where: { trackId: { in: trackIds } }, select: { trackId: true, genre: true } });
    for (const r of rows) genreById.set(r.trackId, r.genre);
  } catch {
    // no genre data yet
  }

  const known = parsed.filter((s) => trackById.has(s.trackId)).map((s) => ({ ...s, playlistId: s.playlistId && playlistById.has(s.playlistId) ? s.playlistId : null }));
  if (known.length === 0) return NextResponse.json({ recorded: 0 });

  try {
    const now = Date.now();
    const [last, used] = await Promise.all([
      prisma.playEvent.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      prisma.playEvent.aggregate({ where: { userId, createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } }, _sum: { seconds: true } }),
    ]);
    const credited = Math.min(used._sum.seconds ?? 0, DAILY_CAP_SECONDS);
    const segments = fitToBudget(known, reportBudgetSeconds(last ? now - last.updatedAt.getTime() : null, credited));

    let recorded = 0;
    for (const s of segments) {
      const track = trackById.get(s.trackId)!;
      const playlist = s.playlistId ? playlistById.get(s.playlistId) : undefined;
      const recent = await prisma.playEvent.findFirst({
        where: { userId, trackId: s.trackId, playlistId: s.playlistId, updatedAt: { gte: new Date(now - MERGE_WINDOW_MS) } },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (recent) {
        await prisma.playEvent.update({ where: { id: recent.id }, data: { seconds: { increment: s.seconds } } });
      } else {
        await prisma.playEvent.create({
          data: {
            userId,
            trackId: track.id,
            playlistId: playlist?.id ?? null,
            title: track.title,
            artist: track.artist,
            genre: genreById.get(track.id) ?? null,
            playlistName: playlist?.name ?? null,
            seconds: s.seconds,
          },
        });
      }
      recorded++;
    }
    return NextResponse.json({ recorded });
  } catch (err) {
    console.warn("Could not record listening time (has prisma/play-stats.sql been run?):", err);
    return NextResponse.json({ recorded: 0 });
  }
}

export const POST = apiHandler(handlePOST);
