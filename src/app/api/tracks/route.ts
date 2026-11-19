import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend, saveLocalFile, deleteLocalFile, deleteBlobFile } from "@/lib/storage";
import { toTrackApiResponse } from "@/lib/trackApi";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";
import { cleanText, isAcceptableStorageUrl, isValidDuration, normalizeAudioMime } from "@/lib/apiValidation";
import { loadAllGenreFields, queueNewTracks } from "@/lib/genre/api";
import { loadUserTrackData } from "@/lib/trackUserData";
import { uploadLimitResponse } from "@/lib/uploadGuard";
import { isAdmin } from "@/lib/feedbackAdmin";
import { recordAuditEvent, recordUpload, requestDeviceId } from "@/lib/telemetryServer";

async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();

  // The library is shared: every account sees every song, whoever added it. Only the must / do-not-play marks and hot cues are
  // each person's own (TrackUserData). YouTube imports were removed from the app, so none are listed. Genres belong to the song,
  // so everybody sees the same ones (empty until the genre tables exist).
  const [tracks, userData, genres] = await Promise.all([
    prisma.track.findMany({ where: { source: "local" }, orderBy: { createdAt: "asc" } }),
    loadUserTrackData(session.user.id),
    loadAllGenreFields(),
  ]);
  // The do-not-play mark is the admin's alone now. A mark an account made before that is not applied for them (shuffle, Home and the
  // curators all read it from here), and it comes back if that account is ever the admin.
  const admin = isAdmin(session.user.id);
  const mineFor = (id: string) => {
    const data = userData.get(id);
    return !admin && data?.playPreference === "do-not" ? { ...data, playPreference: null } : data;
  };
  return NextResponse.json(tracks.map((t) => ({ ...toTrackApiResponse(t, mineFor(t.id)), ...(genres.get(t.id) ?? {}) })));
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/** Which device added the song, and a line in the audit log (both best effort: they never fail the upload). */
async function noteSongAdded(request: Request, userId: string, track: { id: string; title: string; artist: string }) {
  const deviceId = requestDeviceId(request);
  await Promise.all([
    recordUpload({ userId, deviceId, trackId: track.id, trackTitle: track.title }),
    recordAuditEvent({ eventType: "song_added", actorId: userId, deviceId, targetId: track.id, targetLabel: `${track.artist} - ${track.title}` }),
  ]);
}

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const limited = await uploadLimitResponse(session.user.id);
  if (limited) return limited;

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    if (getStorageBackend() !== "local") {
      return NextResponse.json(
        { error: "This server is configured for direct-to-blob uploads — use /api/tracks/upload-token." },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const title = cleanText(formData.get("title"));
    const artist = cleanText(formData.get("artist"));
    const durationSec = Number(formData.get("durationSec"));
    if (!(file instanceof File) || !title || typeof formData.get("artist") !== "string" || !isValidDuration(durationSec)) {
      return NextResponse.json({ error: "Missing file or track metadata." }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const storageKey = await saveLocalFile(id, file);
    try {
      const track = await prisma.track.create({
        data: {
          id,
          userId: session.user.id,
          title,
          artist,
          durationSec,
          storageKey,
          mimeType: normalizeAudioMime(file.type),
        },
      });
      await queueNewTracks([track.id]); // classify its genres in the background (never fails the upload)
      await noteSongAdded(request, session.user.id, track);
      return NextResponse.json(toTrackApiResponse(track), { status: 201 });
    } catch (err) {
      await deleteLocalFile(storageKey).catch(() => {}); // don't orphan the file if the DB write fails
      throw err;
    }
  }

  // JSON body: blob backend, bytes already uploaded client-side via
  // /api/tracks/upload-token — this call just records the metadata.
  const body = await request.json().catch(() => null);
  const title = cleanText(body?.title);
  const artist = cleanText(body?.artist);
  const durationSec = Number(body?.durationSec);
  const blobUrl = body?.blobUrl;
  const mimeType = body?.mimeType;
  const backend = getStorageBackend();
  if (
    !title ||
    typeof body?.artist !== "string" ||
    !isAcceptableStorageUrl(blobUrl, backend) ||
    !isValidDuration(durationSec)
  ) {
    return NextResponse.json({ error: "Missing or invalid track metadata." }, { status: 400 });
  }

  try {
    const track = await prisma.track.create({
      data: {
        userId: session.user.id,
        title,
        artist,
        durationSec,
        storageKey: blobUrl,
        mimeType: normalizeAudioMime(typeof mimeType === "string" ? mimeType : ""),
      },
    });
    await queueNewTracks([track.id]);
    await noteSongAdded(request, session.user.id, track);
    return NextResponse.json(toTrackApiResponse(track), { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) return jsonError(409, "That file is already in your library.");
    // The bytes were already uploaded straight to Blob by the browser — if
    // the DB write fails, nothing will ever reference them again.
    if (backend === "blob") await deleteBlobFile(blobUrl).catch(() => {});
    throw err;
  }
}

export const GET = apiHandler(handleGET);
export const POST = apiHandler(handlePOST);
