import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pickLoopWithAI, sanitizeLoopRequest } from "@/lib/ai-loop";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";

/** Far above any real request (100 loops with short names); anything bigger is rejected before parsing. */
const MAX_BODY_CHARS = 50_000;

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return jsonError(413, "Request too large.");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // falls through to the 400 below
  }
  // Bounds the paid Claude prompt regardless of what the client sends.
  const body = sanitizeLoopRequest(parsed);
  if (!body) return jsonError(400, "currentTrack and availableLoops are required.");

  const result = await pickLoopWithAI(body.currentTrack, body.availableLoops, body.previousLoopId);
  return NextResponse.json(result);
}

export const POST = apiHandler(handlePOST);
