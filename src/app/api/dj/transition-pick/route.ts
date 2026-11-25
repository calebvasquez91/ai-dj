import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { askHaikuToPick } from "@/lib/transitionPickServer";
import { sanitizePickRequest } from "@/lib/transitionChoice";

/** A real request is a kilobyte or two. */
const MAX_BODY_CHARS = 8_000;

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
  const input = sanitizePickRequest(body);
  if (!input) return NextResponse.json({ error: "genrePair, mixability and two candidates are required." }, { status: 400 });
  // null (no key, slow, bad answer) is a normal answer: the DJ keeps its local winner.
  return NextResponse.json({ answer: await askHaikuToPick(input) });
}

export const POST = apiHandler(handlePOST);
