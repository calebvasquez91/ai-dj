import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pickLoopWithAI, type AiLoopCandidate, type AiLoopTrackProfile } from "@/lib/ai-loop";
import { apiHandler, unauthorized } from "@/lib/apiRoute";

const MAX_LOOP_CANDIDATES = 100;

interface NextLoopRequestBody {
  currentTrack?: AiLoopTrackProfile;
  availableLoops?: AiLoopCandidate[];
  previousLoopId?: string | null;
}

function isTrackProfile(value: unknown): value is AiLoopTrackProfile {
  return typeof value === "object" && value !== null && typeof (value as { title?: unknown }).title === "string";
}

function isLoopCandidate(value: unknown): value is AiLoopCandidate {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => null)) as NextLoopRequestBody | null;
  if (!body || !isTrackProfile(body.currentTrack) || !Array.isArray(body.availableLoops)) {
    return NextResponse.json({ error: "currentTrack and availableLoops are required." }, { status: 400 });
  }
  // Bound the paid Claude prompt regardless of what the client sends.
  const availableLoops = body.availableLoops.filter(isLoopCandidate).slice(0, MAX_LOOP_CANDIDATES);
  const previousLoopId = typeof body.previousLoopId === "string" ? body.previousLoopId : null;

  const result = await pickLoopWithAI(body.currentTrack, availableLoops, previousLoopId);
  return NextResponse.json(result);
}

export const POST = apiHandler(handlePOST);
