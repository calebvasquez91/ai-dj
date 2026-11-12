import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { planFxWithAI, sanitizeFxPlanInput } from "@/lib/ai-fx-plan";
import { apiHandler, unauthorized } from "@/lib/apiRoute";

/** A real request is a few kilobytes (a dozen short candidates); anything near this is not one. */
const MAX_BODY_CHARS = 24_000;

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // falls through to the 400 below
  }
  const input = sanitizeFxPlanInput(body);
  if (!input) {
    return NextResponse.json({ error: "title, bpm, durationSec, frequency and candidates are required." }, { status: 400 });
  }
  return NextResponse.json(await planFxWithAI(input));
}

export const POST = apiHandler(handlePOST);
