// The genre fields of every track in the signed-in person's library that has been classified, keyed by track id. The app
// reads this after the background jobs have made progress, so it does not have to reload the whole library to see new genres.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { loadGenreFieldsForUser } from "@/lib/genre/api";

async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();
  const fields = await loadGenreFieldsForUser(session.user.id);
  return NextResponse.json(Object.fromEntries(fields));
}

export const GET = apiHandler(handleGET);
