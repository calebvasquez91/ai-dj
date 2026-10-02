import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend, saveLocalFile, deleteLocalFile, deleteBlobFile } from "@/lib/storage";
import { toFxApiResponse, isFxCategory } from "@/lib/fxApi";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";
import { cleanText, isAcceptableStorageUrl, isValidDuration, MAX_NAME_LENGTH, normalizeAudioMime } from "@/lib/apiValidation";

async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();

  const fx = await prisma.fxSound.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(fx.map(toFxApiResponse));
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    if (getStorageBackend() !== "local") {
      return NextResponse.json(
        { error: "This server is configured for direct-to-blob uploads — use /api/fx/upload-token." },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const name = cleanText(formData.get("name"), MAX_NAME_LENGTH);
    const category = formData.get("category");
    const durationSec = Number(formData.get("durationSec"));
    if (!(file instanceof File) || !name || !isFxCategory(category) || !isValidDuration(durationSec)) {
      return NextResponse.json({ error: "Missing file or FX metadata." }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const storageKey = await saveLocalFile(id, file);
    try {
      const fx = await prisma.fxSound.create({
        data: {
          id,
          userId: session.user.id,
          name,
          fileName: cleanText(file.name),
          category,
          durationSec,
          storageKey,
          mimeType: normalizeAudioMime(file.type),
        },
      });
      return NextResponse.json(toFxApiResponse(fx), { status: 201 });
    } catch (err) {
      await deleteLocalFile(storageKey).catch(() => {}); // don't orphan the file if the DB write fails
      throw err;
    }
  }

  // JSON body: blob backend, bytes already uploaded client-side via
  // /api/fx/upload-token — this call just records the metadata.
  const body = await request.json().catch(() => null);
  const name = cleanText(body?.name, MAX_NAME_LENGTH);
  const fileName = cleanText(body?.fileName);
  const category = body?.category;
  const durationSec = Number(body?.durationSec);
  const blobUrl = body?.blobUrl;
  const mimeType = body?.mimeType;
  const backend = getStorageBackend();
  if (!name || !fileName || !isFxCategory(category) || !isAcceptableStorageUrl(blobUrl, backend) || !isValidDuration(durationSec)) {
    return NextResponse.json({ error: "Missing or invalid FX metadata." }, { status: 400 });
  }

  try {
    const fx = await prisma.fxSound.create({
      data: {
        userId: session.user.id,
        name,
        fileName,
        category,
        durationSec,
        storageKey: blobUrl,
        mimeType: normalizeAudioMime(typeof mimeType === "string" ? mimeType : ""),
      },
    });
    return NextResponse.json(toFxApiResponse(fx), { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) return jsonError(409, "That file is already in your FX library.");
    // Bytes already went straight to Blob from the browser; with no DB row
    // pointing at them they'd be orphaned (e.g. a stale session user's FK
    // failure) — clean them up before surfacing the error.
    if (backend === "blob") await deleteBlobFile(blobUrl).catch(() => {});
    throw err;
  }
}

export const GET = apiHandler(handleGET);
export const POST = apiHandler(handlePOST);
