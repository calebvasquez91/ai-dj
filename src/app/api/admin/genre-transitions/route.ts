// PUT /api/admin/genre-transitions: the admin edits the SHARED genre transition table for one genre (its preferred styles and blend bar range), or clears
// it (override: null). Every account sees the change. Admin only; for anyone else the route does not exist.
import { NextResponse } from "next/server";
import { apiHandler, jsonError } from "@/lib/apiRoute";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { saveSharedOverride } from "@/lib/genreTransitionsServer";

const MAX_BODY_CHARS = 4_000;

async function handlePUT(request: Request) {
  const session = await feedbackOwnerSession();
  if (!session) return jsonError(404, "Not found.");
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) return jsonError(413, "Request too large.");
  let body: { genre?: unknown; override?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // falls through to the 400 below
  }
  if (!body || typeof body.genre !== "string" || !("override" in body)) return jsonError(400, "genre and override are required (override may be null to clear).");
  const result = await saveSharedOverride(body.genre, body.override, session.user.id);
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.reason === "no-table") return jsonError(409, "The genre-transitions table does not exist yet: run prisma/genre-transitions.sql first.");
  if (result.reason === "unknown-genre") return jsonError(400, "That is not a genre in the taxonomy.");
  return jsonError(400, "Nothing usable in that override: give preferred styles from the list and/or a bar range of 1 to 64 (shortest first).");
}

export const PUT = apiHandler(handlePUT);
