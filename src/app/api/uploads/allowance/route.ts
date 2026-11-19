// Tells the upload screen WHY a direct-to-storage upload was refused. The storage client turns any refusal of its token request into a
// generic "Failed to retrieve the client token", so on that error the page asks here: 429 with the "Upload limit reached" message when
// the account is over its daily limit, 200 otherwise. Same check the upload routes make (lib/uploadGuard.ts).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { uploadLimitResponse } from "@/lib/uploadGuard";

async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();
  return (await uploadLimitResponse(session.user.id)) ?? NextResponse.json({ ok: true });
}

export const GET = apiHandler(handleGET);
