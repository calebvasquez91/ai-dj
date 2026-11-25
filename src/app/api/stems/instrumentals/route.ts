import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { VOCAL_SPLIT_ENABLED } from "@/lib/featureFlags";
import { isMissingTable } from "@/lib/missingTable";
import { prisma } from "@/lib/prisma";
import { parseVocalActivity } from "@/lib/stemInstrumental";
import type { VoiceMap } from "@/lib/voiceMap";

/**
 * Which songs have a built instrumental (for "Instrumental mode") and when each one's lead vocal is present (for vocal swaps), for every signed-in
 * account (the library is shared). Empty while the feature is off or before prisma/vocal-split.sql has been run.
 */
async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();
  if (!VOCAL_SPLIT_ENABLED) return NextResponse.json({ instrumentals: {}, activity: {} });
  try {
    const rows = await prisma.stemSeparationJob.findMany({
      where: { status: "ready", instrumentalUrl: { not: null } },
      orderBy: { createdAt: "asc" }, // newest last, so a later job for the same song wins
      select: { trackId: true, instrumentalUrl: true, vocalActivityJson: true },
    });
    const instrumentals: Record<string, string> = {};
    const activity: Record<string, VoiceMap> = {};
    for (const r of rows) {
      if (!r.instrumentalUrl) continue;
      instrumentals[r.trackId] = r.instrumentalUrl;
      const map = parseVocalActivity(r.vocalActivityJson);
      if (map) activity[r.trackId] = map;
    }
    return NextResponse.json({ instrumentals, activity });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ instrumentals: {}, activity: {} });
    throw err;
  }
}

export const GET = apiHandler(handleGET);
