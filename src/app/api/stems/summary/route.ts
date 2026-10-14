// How much stem separation this user has run and spent, and the budget automatic separation is held to
// (STEM_AUTO_BUDGET_USD), and whether this server can separate stems at all. Read-only; feeds the Stems panel in the DJ decks view.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { stemSummaryForUser } from "@/lib/stemSummary";
import { stemSupport } from "@/lib/stemSupport";
import { getStorageBackend } from "@/lib/storage";

async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();
  const summary = await stemSummaryForUser(prisma, session.user.id);
  const support = stemSupport({ storageBackend: getStorageBackend(), hasReplicateToken: Boolean(process.env.REPLICATE_API_TOKEN) });
  return NextResponse.json({ ...summary, support });
}

export const GET = apiHandler(handleGET);
