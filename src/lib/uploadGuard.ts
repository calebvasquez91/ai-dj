// Server-only. Answers 429 when an account has added as many files today as it is allowed (lib/uploadLimit.ts); null when it may add
// another. The admin is never limited. Songs and FX sounds count together, since both go into the shared library.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/feedbackAdmin";
import { uploadAllowance, uploadCapFor, UPLOAD_WINDOW_MS } from "@/lib/uploadLimit";

export async function uploadLimitResponse(userId: string, now = Date.now()): Promise<NextResponse | null> {
  if (isAdmin(userId)) return null;
  const since = new Date(now - UPLOAD_WINDOW_MS);
  const [songs, fx, user] = await Promise.all([
    prisma.track.count({ where: { userId, createdAt: { gte: since } } }),
    prisma.fxSound.count({ where: { userId, createdAt: { gte: since } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
  ]);
  const cap = uploadCapFor(user ? now - user.createdAt.getTime() : null);
  if (uploadAllowance(songs + fx, cap).allowed) return null;
  return NextResponse.json(
    { error: `Upload limit reached: ${cap.toLocaleString("en-US")} files per 24 hours for this account. Try again later.` },
    { status: 429 },
  );
}
