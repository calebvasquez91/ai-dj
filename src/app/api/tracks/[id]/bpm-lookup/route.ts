import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { lookupBpmFromDeezer } from "@/lib/deezerBpm";

/**
 * Confidence assigned to a Deezer metadata match — above mix-engine.ts's
 * MIN_TEMPO_CONFIDENCE_FOR_TRUST (0.35) so it's trusted enough to drive
 * tempo-fit scoring, but honestly lower-tier than a real per-sample local
 * analysis or a user-verified tap-tempo (see TAP_BPM_CONFIDENCE in
 * lib/youtubeBpm.ts).
 */
const METADATA_BPM_CONFIDENCE = 0.5;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const track = await prisma.track.findUnique({ where: { id } });
  if (!track || track.userId !== session.user.id) return new NextResponse(null, { status: 404 });
  if (track.source !== "youtube") {
    return NextResponse.json({ error: "Metadata BPM lookup only applies to YouTube tracks." }, { status: 400 });
  }

  // Already resolved (an earlier lookup, or a user's manual tap) — don't
  // let a repeat lookup ever clobber a higher-confidence tap-tempo value,
  // and don't waste a Deezer call re-confirming an existing match.
  if (track.bpm != null) {
    return NextResponse.json({ bpm: track.bpm, bpmConfidence: track.bpmConfidence, bpmSource: track.bpmSource });
  }

  const bpm = await lookupBpmFromDeezer(track.title, track.artist);
  if (bpm == null) {
    return NextResponse.json({ bpm: null, bpmConfidence: 0, bpmSource: null });
  }

  const updated = await prisma.track.update({
    where: { id },
    data: { bpm, bpmConfidence: METADATA_BPM_CONFIDENCE, bpmSource: "metadata" },
  });
  return NextResponse.json({ bpm: updated.bpm, bpmConfidence: updated.bpmConfidence, bpmSource: updated.bpmSource });
}
