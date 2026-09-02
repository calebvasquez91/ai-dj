import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend, deleteLocalFile, deleteBlobFile } from "@/lib/storage";
import { toTrackApiResponse } from "@/lib/trackApi";

async function loadOwnedTrack(id: string, userId: string) {
  const track = await prisma.track.findUnique({ where: { id } });
  if (!track || track.userId !== userId) return null;
  return track;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const existing = await loadOwnedTrack(id, session.user.id);
  if (!existing) return new NextResponse(null, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Whitelist exactly what's allowed to change — never trust arbitrary
  // client-supplied fields for a mass update.
  const data: Record<string, unknown> = {};
  if (body.playPreference === "must" || body.playPreference === "do-not" || body.playPreference === null) {
    data.playPreference = body.playPreference;
  }
  if (body.analysis && typeof body.analysis === "object") {
    const a = body.analysis;
    if (typeof a.bpm === "number") data.bpm = a.bpm;
    if (typeof a.bpmConfidence === "number") data.bpmConfidence = a.bpmConfidence;
    if (typeof a.beatGridOffsetSec === "number") data.beatGridOffsetSec = a.beatGridOffsetSec;
    if (typeof a.energyOnsetSec === "number") data.energyOnsetSec = a.energyOnsetSec;
    if (typeof a.key === "string" || a.key === null) data.key = a.key;
    if (typeof a.keyConfidence === "number") data.keyConfidence = a.keyConfidence;
    if (typeof a.camelotKey === "string" || a.camelotKey === null) data.camelotKey = a.camelotKey;
    if (typeof a.breakdownAtSec === "number" || a.breakdownAtSec === null) data.breakdownAtSec = a.breakdownAtSec;
    if (typeof a.dropAtSec === "number" || a.dropAtSec === null) data.dropAtSec = a.dropAtSec;
    if (Array.isArray(a.waveformPeaks)) data.waveformPeaksJson = JSON.stringify(a.waveformPeaks);
  }
  if (body.lyricalFingerprint === null) {
    data.lyricalFingerprintJson = null;
  } else if (body.lyricalFingerprint && typeof body.lyricalFingerprint === "object") {
    const f = body.lyricalFingerprint;
    if (Array.isArray(f.words) && Array.isArray(f.moodTags)) {
      data.lyricalFingerprintJson = JSON.stringify({
        words: f.words.filter((w: unknown) => typeof w === "string"),
        moodTags: f.moodTags.filter((m: unknown) => typeof m === "string"),
      });
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No recognized fields to update." }, { status: 400 });
  }

  const track = await prisma.track.update({ where: { id }, data });
  return NextResponse.json(toTrackApiResponse(track));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const existing = await loadOwnedTrack(id, session.user.id);
  if (!existing) return new NextResponse(null, { status: 404 });

  try {
    if (existing.source === "youtube" || existing.source === "spotify") {
      // Nothing stored — storageKey holds the video/track id, not a file/blob.
    } else if (getStorageBackend() === "local") {
      await deleteLocalFile(existing.storageKey);
    } else {
      await deleteBlobFile(existing.storageKey);
    }
  } catch (err) {
    // Don't let a storage-side failure (already gone, transient network
    // error, etc.) leave the track stuck and undeletable from the app.
    console.warn(`Failed to delete storage object for track ${id}:`, err);
  }
  await prisma.track.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
