// GET /api/admin/music?q=&page=&pageSize=&sort=&dir=&missing=1&counts=1: one page of the Music catalog (app/(app)/admin/music) with the search applied.
// `counts=1` also returns the library-wide figures shown above the table (they do not depend on the search, so the page asks once and again after an
// edit, not on every keystroke). Admin only; for anyone else the route does not exist (404), the same as the page.
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
  orderByCamelot,
  parseMusicQuery,
  sortsInMemory,
  toMusicRow,
  type MusicQuery,
} from "@/lib/adminMusic";

async function loadCounts() {
  const [library, missingArtist, missingTitle, missingGenre, missingAny] = await Promise.all([
    prisma.track.count(),
    prisma.track.count({ where: missingArtistWhere }),
    prisma.track.count({ where: missingTitleWhere }),
    prisma.track.count({ where: missingGenreWhere }),
    prisma.track.count({ where: missingAnyWhere }),
  ]);
  return { library, missingArtist, missingTitle, missingGenre, missingAny };
}

/** The songs of one page, in order. Key order is the Camelot wheel's, which the database cannot produce, so that sort orders every match by id first and reads just the page's rows after. */
async function loadPage(query: MusicQuery, where: ReturnType<typeof musicWhere>, page: number) {
  const skip = (page - 1) * query.pageSize;
  if (!sortsInMemory(query.sort)) {
    return prisma.track.findMany({ where, orderBy: musicOrderBy(query.sort, query.dir), skip, take: query.pageSize, select: MUSIC_SELECT });
  }
  const all = await prisma.track.findMany({ where, orderBy: musicOrderBy(query.sort, query.dir), select: { id: true, camelotKey: true } });
  const ids = orderByCamelot(all, query.dir).slice(skip, skip + query.pageSize).map((r) => r.id);
  const found = await prisma.track.findMany({ where: { id: { in: ids } }, select: MUSIC_SELECT });
  const byId = new Map(found.map((s) => [s.id, s]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

async function handleGET(request: Request) {
  if (!(await feedbackOwnerSession())) return jsonError(404, "Not found.");
  const params = new URL(request.url).searchParams;
  const query = parseMusicQuery(params);
  const where = musicWhere(query.q, query.missing);

  const [total, counts] = await Promise.all([prisma.track.count({ where }), params.get("counts") === "1" ? loadCounts() : Promise.resolve(null)]);
  // A page past the end (a search that narrowed the list while on page 5) shows the last page instead of nothing.
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pages);
  const songs = await loadPage(query, where, page);

  return NextResponse.json({ rows: songs.map(toMusicRow), total, page, pages, pageSize: query.pageSize, counts }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = apiHandler(handleGET);
