import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend, deleteLocalFile, deleteBlobFile } from "@/lib/storage";
import { toTrackApiResponse } from "@/lib/trackApi";
import { apiHandler, notFound, unauthorized } from "@/lib/apiRoute";
import { cleanTags, cleanWaveformPeaks } from "@/lib/apiValidation";

async function loadOwnedTrack(id: string, userId: string) {
  const track = await prisma.track.findUnique({ where: { id } });
  if (!track || track.userId !== userId) return null;
  return track;
}

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const existing = await loadOwnedTrack(id, session.user.id);
  if (!existing) return notFound();

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
  if (body.bpmSource === "metadata" || body.bpmSource === "tap" || body.bpmSource === null) {
    data.bpmSource = body.bpmSource;
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
    if (Array.isArray(a.buildDropPairs)) {
      const pairs = a.buildDropPairs.filter(
        (p: unknown): p is { buildAtSec: number; dropAtSec: number } =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as { buildAtSec?: unknown }).buildAtSec === "number" &&
          typeof (p as { dropAtSec?: unknown }).dropAtSec === "number"
      );
      data.buildDropPairsJson = JSON.stringify(pairs);
    }
    const peaks = cleanWaveformPeaks(a.waveformPeaks);
    if (peaks) data.waveformPeaksJson = JSON.stringify(peaks);
  }
  if (Array.isArray(body.tags)) {
    data.tagsJson = JSON.stringify(cleanTags(body.tags));
  }
  if (body.hotCueOverrides && typeof body.hotCueOverrides === "object") {
    const sanitized: Record<string, number> = {};
    for (const [cueNumber, atSec] of Object.entries(body.hotCueOverrides)) {
      const n = Number(cueNumber);
      if (Number.isInteger(n) && n >= 1 && n <= 8 && typeof atSec === "number" && atSec >= 0) {
        sanitized[cueNumber] = atSec;
      }
    }
    data.hotCueOverridesJson = JSON.stringify(sanitized);
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

async function handleDELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const existing = await loadOwnedTrack(id, session.user.id);
  if (!existing) return notFound();

  // Separated stems live in Blob under their own URLs; the StemSeparationJob
  // rows cascade away with the track, so grab the URLs first or they leak.
  const stemJobs = await prisma.stemSeparationJob.findMany({
    where: { trackId: id },
    select: { vocalsUrl: true, drumsUrl: true, bassUrl: true, otherUrl: true },
  });
  const stemUrls = stemJobs.flatMap((j) => [j.vocalsUrl, j.drumsUrl, j.bassUrl, j.otherUrl]).filter((u): u is string => !!u);

  // Row first, storage second: if the DB delete fails the track is still
  // fully playable (nothing was removed); the other order left a "ghost"
  // track whose audio was already gone. deleteMany (not delete) so a double
  // click / second tab racing us is a no-op rather than a P2025 error.
  await prisma.track.deleteMany({ where: { id, userId: session.user.id } });

  // Best-effort: a storage-side failure (already gone, transient network
  // error, etc.) must not make an already-deleted track look undeletable.
  const cleanups: Promise<void>[] = [];
  if (existing.source !== "youtube") {
    // (youtube: nothing stored — storageKey holds the video id, not a file/blob)
    cleanups.push(getStorageBackend() === "local" ? deleteLocalFile(existing.storageKey) : deleteBlobFile(existing.storageKey));
  }
  if (getStorageBackend() === "blob") cleanups.push(...stemUrls.map((u) => deleteBlobFile(u)));
  const results = await Promise.allSettled(cleanups);
  for (const r of results) {
    if (r.status === "rejected") console.warn(`Failed to delete a storage object for track ${id}:`, r.reason);
  }

  return new NextResponse(null, { status: 204 });
}

export const PATCH = apiHandler(handlePATCH);
export const DELETE = apiHandler(handleDELETE);
