import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend, deleteLocalFile, deleteBlobFile } from "@/lib/storage";
import { toFxApiResponse, isFxCategory } from "@/lib/fxApi";

async function loadOwnedFx(id: string, userId: string) {
  const fx = await prisma.fxSound.findUnique({ where: { id } });
  if (!fx || fx.userId !== userId) return null;
  return fx;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const existing = await loadOwnedFx(id, session.user.id);
  if (!existing) return new NextResponse(null, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Whitelist exactly what's allowed to change — same convention as
  // /api/tracks/[id]'s PATCH handler.
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (isFxCategory(body.category)) data.category = body.category;
  if (typeof body.bpm === "number" || body.bpm === null) data.bpm = body.bpm;
  if (typeof body.key === "string" || body.key === null) data.key = body.key;
  if (Array.isArray(body.tags)) {
    data.tagsJson = JSON.stringify(
      body.tags.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
    );
  }
  if (Array.isArray(body.playlistAffinity)) {
    data.playlistAffinityJson = JSON.stringify(
      body.playlistAffinity.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
    );
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No recognized fields to update." }, { status: 400 });
  }

  const fx = await prisma.fxSound.update({ where: { id }, data });
  return NextResponse.json(toFxApiResponse(fx));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const existing = await loadOwnedFx(id, session.user.id);
  if (!existing) return new NextResponse(null, { status: 404 });

  try {
    if (getStorageBackend() === "local") {
      await deleteLocalFile(existing.storageKey);
    } else {
      await deleteBlobFile(existing.storageKey);
    }
  } catch (err) {
    // Don't let a storage-side failure leave the FX stuck and undeletable.
    console.warn(`Failed to delete storage object for FX ${id}:`, err);
  }
  await prisma.fxSound.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
