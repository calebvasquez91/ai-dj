import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { chatWithDj } from "@/lib/ai-chat";
import { sanitizeContext, sanitizeMessages } from "@/lib/chat";
import { apiHandler, unauthorized } from "@/lib/apiRoute";

interface ChatRequestBody {
  messages?: unknown;
  context?: unknown;
}

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => null)) as ChatRequestBody | null;
  // Bound the paid Claude prompt regardless of what the client sends (lib/chat.ts).
  const messages = sanitizeMessages(body?.messages);
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages must end with something from the user." }, { status: 400 });
  }
  const result = await chatWithDj(messages, sanitizeContext(body?.context));
  return NextResponse.json(result);
}

export const POST = apiHandler(handlePOST);
