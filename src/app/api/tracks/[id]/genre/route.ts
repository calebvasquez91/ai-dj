// The admin's edit of one song's genres. PUT sets them (source "manual", confidence 1, status "confirmed"): the pipeline
// never overwrites them afterwards. DELETE takes the manual genres back, returning the song to what its sources say. Genres
// belong to the shared song, so nobody else may change them.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, jsonError, notFound, unauthorized } from "@/lib/apiRoute";
import { isAdmin } from "@/lib/feedbackAdmin";
import { fieldsFromStored } from "@/lib/genre/api";
import { genreTablesReady, prismaGenreStore } from "@/lib/genre/prismaStore";
import { applyManualGenres, clearManualGenres, finalizeStored, type GenrePick } from "@/lib/genre/stored";

const MAX_PICKS = 5;

function trackExists(id: string) {
  return prisma.track.findUnique({ where: { id }, select: { id: true } });
}

function readPicks(value: unknown): GenrePick[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PICKS) return null;
  const picks: GenrePick[] = [];
  for (const p of value) {
    if (!p || typeof p !== "object" || typeof (p as { genre?: unknown }).genre !== "string") return null;
    const sub = (p as { subgenre?: unknown }).subgenre;
    if (sub != null && typeof sub !== "string") return null;
    picks.push({ genre: (p as { genre: string }).genre, ...(typeof sub === "string" && sub ? { subgenre: sub } : {}) });
  }
  return picks;
}

async function handlePUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();
  const { id } = await params;
  if (!isAdmin(session.user.id)) return jsonError(403, "Only the admin can change a song's genres.");
  if (!(await trackExists(id))) return notFound();
  if (!(await genreTablesReady())) return jsonError(503, "Genre classification is not set up yet (the database tables have not been created).");

  const body = (await request.json().catch(() => null)) as { picks?: unknown } | null;
  const picks = readPicks(body?.picks);
  if (!picks) return jsonError(400, `Give 1 to ${MAX_PICKS} picks, each { genre, subgenre? }.`);

  const existing = await prismaGenreStore.get(id);
  const updated = applyManualGenres(existing, picks, Date.now());
  if (!updated) return jsonError(400, "None of those genres is on the genre list.");
  await prismaGenreStore.save(id, updated);
  return NextResponse.json(fieldsFromStored(updated));
}

async function handleDELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();
  const { id } = await params;
  if (!isAdmin(session.user.id)) return jsonError(403, "Only the admin can change a song's genres.");
  if (!(await trackExists(id))) return notFound();
  if (!(await genreTablesReady())) return jsonError(503, "Genre classification is not set up yet (the database tables have not been created).");

  const existing = await prismaGenreStore.get(id);
  if (!existing) return NextResponse.json(fieldsFromStored(finalizeStored([], [], undefined, Date.now())));
  const cleared = clearManualGenres(existing, Date.now());
  await prismaGenreStore.save(id, cleared);
  return NextResponse.json(fieldsFromStored(cleared));
}

export const PUT = apiHandler(handlePUT);
export const DELETE = apiHandler(handleDELETE);
