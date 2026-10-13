// How much stem separation this user has run and spent, and the budget automatic separation is held to
// (STEM_AUTO_BUDGET_USD). Read-only; feeds the Stems panel in the DJ decks view.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { stemSummaryForUser } from "@/lib/stemSummary";

async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();
  return NextResponse.json(await stemSummaryForUser(prisma, session.user.id));
}

export const GET = apiHandler(handleGET);
