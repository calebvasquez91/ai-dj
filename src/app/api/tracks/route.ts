import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend, saveLocalFile, deleteLocalFile } from "@/lib/storage";
import { toTrackApiResponse } from "@/lib/trackApi";

export async function GET() {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const tracks = await prisma.track.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(tracks.map(toTrackApiResponse));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

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
    const title = formData.get("title");
    const artist = formData.get("artist");
    const durationSec = Number(formData.get("durationSec"));
    if (!(file instanceof File) || typeof title !== "string" || typeof artist !== "string" || !Number.isFinite(durationSec)) {
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
          mimeType: file.type || "audio/mpeg",
        },
      });
      return NextResponse.json(toTrackApiResponse(track), { status: 201 });
    } catch (err) {
      await deleteLocalFile(storageKey); // don't orphan the file if the DB write fails
      throw err;
    }
  }

  // JSON body: blob backend, bytes already uploaded client-side via
  // /api/tracks/upload-token — this call just records the metadata.
  const body = await request.json().catch(() => null);
  const title = body?.title;
  const artist = body?.artist;
  const durationSec = Number(body?.durationSec);
  const blobUrl = body?.blobUrl;
  const mimeType = body?.mimeType;
  if (typeof title !== "string" || typeof artist !== "string" || typeof blobUrl !== "string" || !Number.isFinite(durationSec)) {
    return NextResponse.json({ error: "Missing track metadata." }, { status: 400 });
  }

  const track = await prisma.track.create({
    data: {
      userId: session.user.id,
      title,
      artist,
      durationSec,
      storageKey: blobUrl,
      mimeType: typeof mimeType === "string" && mimeType ? mimeType : "audio/mpeg",
    },
  });
  return NextResponse.json(toTrackApiResponse(track), { status: 201 });
}
