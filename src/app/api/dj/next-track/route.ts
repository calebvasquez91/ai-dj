import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { AI_CANDIDATE_CAP, pickNextTrackWithAI, type AiDjBoardState, type AiNextTrackCandidate } from "@/lib/ai-dj";
import { apiHandler, unauthorized } from "@/lib/apiRoute";

interface NextTrackRequestBody {
  currentTrack?: AiNextTrackCandidate;
  candidates?: AiNextTrackCandidate[];
  boardState?: AiDjBoardState;
}

function isCandidate(value: unknown): value is AiNextTrackCandidate {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => null)) as NextTrackRequestBody | null;
  if (!body || !isCandidate(body.currentTrack) || !Array.isArray(body.candidates) || !body.boardState) {
    return NextResponse.json({ error: "currentTrack, candidates, and boardState are required." }, { status: 400 });
  }
  // The client already caps itself at AI_CANDIDATE_CAP, but nothing stopped a
  // crafted request from sending thousands of rows into the (paid) Claude prompt.
  const candidates = body.candidates.filter(isCandidate).slice(0, AI_CANDIDATE_CAP);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "candidates must contain at least one track." }, { status: 400 });
  }

  const result = await pickNextTrackWithAI(body.currentTrack, candidates, body.boardState);
  return NextResponse.json(result);
}

export const POST = apiHandler(handlePOST);
