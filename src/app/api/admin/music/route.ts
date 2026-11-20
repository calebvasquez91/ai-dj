// GET /api/admin/music?q=&page=&pageSize=&sort=&dir=&missing=1: one page of the Music catalog (app/(app)/admin/music) with the search applied, plus
// the counts the page shows above the table. Admin only; for anyone else the route does not exist (404), the same as the page.
import { NextResponse } from "next/server";
import { apiHandler, jsonError } from "@/lib/apiRoute";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { prisma } from "@/lib/prisma";
import {
  MUSIC_SELECT,
  missingAnyWhere,
  missingArtistWhere,
  missingGenreWhere,
  missingTitleWhere,
  musicOrderBy,
  musicWhere,
  parseMusicQuery,
  toMusicRow,
} from "@/lib/adminMusic";

async function handleGET(request: Request) {
  if (!(await feedbackOwnerSession())) return jsonError(404, "Not found.");
  const query = parseMusicQuery(new URL(request.url).searchParams);
  const where = musicWhere(query.q, query.missing);

  const [total, library, noArtist, noTitle, noGenre, noneAtAll] = await Promise.all([
    prisma.track.count({ where }),
    prisma.track.count(),
    prisma.track.count({ where: missingArtistWhere }),
    prisma.track.count({ where: missingTitleWhere }),
    prisma.track.count({ where: missingGenreWhere }),
    prisma.track.count({ where: missingAnyWhere }),
  ]);
  // A page past the end (a search that narrowed the list while on page 5) shows the last page instead of nothing.
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pages);
  const songs = await prisma.track.findMany({
    where,
    orderBy: musicOrderBy(query.sort, query.dir),
    skip: (page - 1) * query.pageSize,
    take: query.pageSize,
    select: MUSIC_SELECT,
  });

  return NextResponse.json(
    { rows: songs.map(toMusicRow), total, page, pages, pageSize: query.pageSize, counts: { library, missingArtist: noArtist, missingTitle: noTitle, missingGenre: noGenre, missingAny: noneAtAll } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = apiHandler(handleGET);
