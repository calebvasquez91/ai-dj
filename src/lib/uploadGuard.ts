// Server-only. Answers 429 when an account has added as many files today as it is allowed (lib/uploadLimit.ts); null when it may add
// another. The admin is never limited. Songs and FX sounds count together, since both go into the shared library.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/feedbackAdmin";
import { parseUploadCap, uploadAllowance, UPLOAD_WINDOW_MS } from "@/lib/uploadLimit";

export async function uploadLimitResponse(userId: string, now = Date.now()): Promise<NextResponse | null> {
  if (isAdmin(userId)) return null;
  const since = new Date(now - UPLOAD_WINDOW_MS);
  const [songs, fx] = await Promise.all([
    prisma.track.count({ where: { userId, createdAt: { gte: since } } }),
    prisma.fxSound.count({ where: { userId, createdAt: { gte: since } } }),
  ]);
  const cap = parseUploadCap(process.env.MAX_UPLOADS_PER_DAY);
  if (uploadAllowance(songs + fx, cap).allowed) return null;
  return NextResponse.json(
    { error: `Upload limit reached: an account can add up to ${cap} files per 24 hours. Try again later.` },
    { status: 429 },
  );
}
