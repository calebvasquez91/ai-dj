import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { parseDecisionInput, recordDecision } from "@/lib/genreTransitionsServer";

/** A decision is a few hundred bytes. */
const MAX_BODY_CHARS = 4_000;

/** Logs one genre-aware transition decision for the admin's counts: the genre pair and style, never a song title. A missing table is a normal answer ({ logged: false }). */
async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // falls through to the 400 below
  }
  const input = parseDecisionInput(body);
  if (!input) return NextResponse.json({ error: "fromGenre, toGenre, a known style and decidedBy are required." }, { status: 400 });
  return NextResponse.json({ logged: await recordDecision(input) });
}

export const POST = apiHandler(handlePOST);
