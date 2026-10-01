import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageBackend, saveLocalFile, deleteLocalFile } from "@/lib/storage";
import { toFxApiResponse, isFxCategory } from "@/lib/fxApi";

export async function GET() {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const fx = await prisma.fxSound.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(fx.map(toFxApiResponse));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

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
    const name = formData.get("name");
    const category = formData.get("category");
    const durationSec = Number(formData.get("durationSec"));
    if (
      !(file instanceof File) ||
      typeof name !== "string" ||
      !isFxCategory(category) ||
      !Number.isFinite(durationSec)
    ) {
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
          fileName: file.name,
          category,
          durationSec,
          storageKey,
          mimeType: file.type || "audio/mpeg",
        },
      });
      return NextResponse.json(toFxApiResponse(fx), { status: 201 });
    } catch (err) {
      await deleteLocalFile(storageKey); // don't orphan the file if the DB write fails
      throw err;
    }
  }

  // JSON body: blob backend, bytes already uploaded client-side via
  // /api/fx/upload-token — this call just records the metadata.
  const body = await request.json().catch(() => null);
  const name = body?.name;
  const fileName = body?.fileName;
  const category = body?.category;
  const durationSec = Number(body?.durationSec);
  const blobUrl = body?.blobUrl;
  const mimeType = body?.mimeType;
  if (
    typeof name !== "string" ||
    typeof fileName !== "string" ||
    !isFxCategory(category) ||
    typeof blobUrl !== "string" ||
    !Number.isFinite(durationSec)
  ) {
    return NextResponse.json({ error: "Missing FX metadata." }, { status: 400 });
  }

  const fx = await prisma.fxSound.create({
    data: {
      userId: session.user.id,
      name,
      fileName,
      category,
      durationSec,
      storageKey: blobUrl,
      mimeType: typeof mimeType === "string" && mimeType ? mimeType : "audio/mpeg",
    },
  });
  return NextResponse.json(toFxApiResponse(fx), { status: 201 });
}
