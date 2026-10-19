import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { reviewSyncPlanWithAI, sanitizeSyncReviewInput } from "@/lib/ai-sync";
import { apiHandler, unauthorized } from "@/lib/apiRoute";

/** A real request is a couple of kilobytes; anything near this is not one. */
const MAX_BODY_CHARS = 16_000;

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
  const input = sanitizeSyncReviewInput(body);
  if (!input) {
    return NextResponse.json({ error: "currentTitle, nextTitle, report and plan are required." }, { status: 400 });
  }
  return NextResponse.json(await reviewSyncPlanWithAI(input));
}

export const POST = apiHandler(handlePOST);
