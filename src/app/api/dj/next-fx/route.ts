import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pickTransitionFxWithAI, type AiFxBoardState, type AiFxCandidate, type AiFxTrackProfile } from "@/lib/ai-fx";

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

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });

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
  const fxLibrary = body.fxLibrary.filter(isFxCandidate);

  const result = await pickTransitionFxWithAI(body.currentTrack, body.nextTrack, fxLibrary, body.boardState);
  return NextResponse.json(result);
}
