import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend, deleteLocalFile, deleteBlobFile } from "@/lib/storage";
import { toFxApiResponse, isFxCategory } from "@/lib/fxApi";
import { apiHandler, notFound, unauthorized } from "@/lib/apiRoute";
import { cleanTags, cleanText, isFiniteNumber, MAX_NAME_LENGTH } from "@/lib/apiValidation";

async function loadOwnedFx(id: string, userId: string) {
  const fx = await prisma.fxSound.findUnique({ where: { id } });
  if (!fx || fx.userId !== userId) return null;
  return fx;
}

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const existing = await loadOwnedFx(id, session.user.id);
  if (!existing) return notFound();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Whitelist exactly what's allowed to change — same convention as
  // /api/tracks/[id]'s PATCH handler.
  const data: Record<string, unknown> = {};
  if (cleanText(body.name, MAX_NAME_LENGTH)) data.name = cleanText(body.name, MAX_NAME_LENGTH);
  if (isFxCategory(body.category)) data.category = body.category;
  if (body.bpm === null || (isFiniteNumber(body.bpm) && body.bpm > 0 && body.bpm <= 1000)) data.bpm = body.bpm;
  if (body.key === null) data.key = null;
  else if (typeof body.key === "string") data.key = cleanText(body.key, 16) || null;
  if (Array.isArray(body.tags)) data.tagsJson = JSON.stringify(cleanTags(body.tags));
  if (Array.isArray(body.playlistAffinity)) data.playlistAffinityJson = JSON.stringify(cleanTags(body.playlistAffinity));

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No recognized fields to update." }, { status: 400 });
  }

  const fx = await prisma.fxSound.update({ where: { id }, data });
  return NextResponse.json(toFxApiResponse(fx));
}

async function handleDELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const existing = await loadOwnedFx(id, session.user.id);
  if (!existing) return notFound();

  // Row first, storage second (see /api/tracks/[id] DELETE): a failed DB
  // delete must not leave a row whose audio is already gone. deleteMany so a
  // racing second delete is a no-op instead of a P2025 error.
  await prisma.fxSound.deleteMany({ where: { id, userId: session.user.id } });
  try {
    if (getStorageBackend() === "local") {
      await deleteLocalFile(existing.storageKey);
    } else {
      await deleteBlobFile(existing.storageKey);
    }
  } catch (err) {
    // Best-effort: a storage-side failure must not make a deleted FX look undeletable.
    console.warn(`Failed to delete storage object for FX ${id}:`, err);
  }

  return new NextResponse(null, { status: 204 });
}

export const PATCH = apiHandler(handlePATCH);
export const DELETE = apiHandler(handleDELETE);
