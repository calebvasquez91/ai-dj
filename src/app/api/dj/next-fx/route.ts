import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pickTransitionFxWithAI, type AiFxBoardState, type AiFxCandidate, type AiFxTrackProfile } from "@/lib/ai-fx";
import { apiHandler, unauthorized } from "@/lib/apiRoute";

const MAX_FX_CANDIDATES = 200;

interface NextFxRequestBody {
  currentTrack?: AiFxTrackProfile;
  nextTrack?: AiFxTrackProfile;
  fxLibrary?: AiFxCandidate[];
  boardState?: AiFxBoardState;
}

function isTrackProfile(value: unknown): value is AiFxTrackProfile {
  return typeof value === "object" && value !== null && typeof (value as { title?: unknown }).title === "string";
}

function isFxCandidate(value: unknown): value is AiFxCandidate {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => null)) as NextFxRequestBody | null;
  if (
    !body ||
    !isTrackProfile(body.currentTrack) ||
    !isTrackProfile(body.nextTrack) ||
    !Array.isArray(body.fxLibrary) ||
    !body.boardState
  ) {
    return NextResponse.json(
      { error: "currentTrack, nextTrack, fxLibrary, and boardState are required." },
      { status: 400 }
    );
  }
  // Bound the paid Claude prompt regardless of what the client sends.
  const fxLibrary = body.fxLibrary.filter(isFxCandidate).slice(0, MAX_FX_CANDIDATES);

  const result = await pickTransitionFxWithAI(body.currentTrack, body.nextTrack, fxLibrary, body.boardState);
  return NextResponse.json(result);
}

export const POST = apiHandler(handlePOST);
