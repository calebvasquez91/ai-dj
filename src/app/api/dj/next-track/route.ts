import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pickNextTrackWithAI, type AiDjBoardState, type AiNextTrackCandidate } from "@/lib/ai-dj";

interface NextTrackRequestBody {
  currentTrack?: AiNextTrackCandidate;
  candidates?: AiNextTrackCandidate[];
  boardState?: AiDjBoardState;
}

function isCandidate(value: unknown): value is AiNextTrackCandidate {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as NextTrackRequestBody | null;
  if (!body || !isCandidate(body.currentTrack) || !Array.isArray(body.candidates) || !body.boardState) {
    return NextResponse.json({ error: "currentTrack, candidates, and boardState are required." }, { status: 400 });
  }
  const candidates = body.candidates.filter(isCandidate);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "candidates must contain at least one track." }, { status: 400 });
  }

  const result = await pickNextTrackWithAI(body.currentTrack, candidates, body.boardState);
  return NextResponse.json(result);
}
