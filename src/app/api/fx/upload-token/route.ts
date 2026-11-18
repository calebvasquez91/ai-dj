import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { uploadLimitResponse } from "@/lib/uploadGuard";

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/webm",
];

/** Issues short-lived Vercel Blob client-upload tokens for FX sounds (blob storage backend only — see src/lib/storage.ts). Mirrors /api/tracks/upload-token. */
async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  // A token is the licence to put a file in the shared store, so the daily limit is checked here as well as when the file is recorded.
  const limited = await uploadLimitResponse(session.user.id);
  if (limited) return limited;

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_AUDIO_TYPES,
        addRandomSuffix: true,
      }),
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export const POST = apiHandler(handlePOST);
