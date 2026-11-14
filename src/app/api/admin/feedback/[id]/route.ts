import { NextResponse } from "next/server";
import { apiHandler, jsonError } from "@/lib/apiRoute";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { prisma } from "@/lib/prisma";

/** What a generated id looks like (letters, digits, "-" and "_"); anything else is refused before the database is asked. */
const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * DELETE /api/admin/feedback/:id: removes one submission from the inbox. Owner only, and for anyone else the route does
 * not exist (404), the same as the inbox page.
 */
async function handleDELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await feedbackOwnerSession())) return jsonError(404, "Not found.");
  const { id } = await params;
  if (!ID_SHAPE.test(id)) return jsonError(400, "That isn't a feedback id.");
  try {
    await prisma.feedback.delete({ where: { id } });
  } catch (err) {
    const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
    if (code === "P2025" || code === "P2021") return jsonError(404, "That feedback is already gone."); // not found / no table yet
    throw err;
  }
  return new NextResponse(null, { status: 204 });
}

export const DELETE = apiHandler(handleDELETE);
