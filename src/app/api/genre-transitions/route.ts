import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { loadSharedOverrides } from "@/lib/genreTransitionsServer";

/** The admin's shared edits to the genre transition table, for every signed-in account (the player merges them under its own device overrides). */
async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();
  return NextResponse.json(await loadSharedOverrides());
}

export const GET = apiHandler(handleGET);
