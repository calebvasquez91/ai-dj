import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";
import { formatFeedbackEmail, parseFeedbackBody } from "@/lib/feedback";
import { sendFeedbackMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";
import pkg from "../../../../package.json";

/** A real submission is a few hundred characters (a comment is capped at 2,000); anything near this is not one. */
const MAX_BODY_CHARS = 8_000;
/** Someone sending feedback five times in an hour has said what they wanted; this stops a loop from filling the inbox. In memory, per server instance. */
const limiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
const MAX_USER_AGENT_CHARS = 300;

/**
 * POST /api/feedback { rating: 1-5, comment?: string, page?: "/path" }
 *
 * Keeps a copy in the database and emails the owner. Either is enough to count as sent: if the table is missing or the
 * database is down the email still goes, and if mail isn't configured the copy is still kept. Only when both fail does
 * the person see an error.
 */
async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const userId = session.user?.id;
  if (!userId) return unauthorized();
  if (!limiter.take(userId)) return jsonError(429, "You've sent a lot of feedback just now. Thank you, please try again later.");

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) return jsonError(413, "That's too long to send.");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // falls through to the 400 below
  }
  const parsed = parseFeedbackBody(body);
  if (!parsed.ok) return jsonError(400, parsed.error);
  const { rating, comment, page } = parsed.value;

  const appVersion = pkg.version ?? null;
  const userAgent = request.headers.get("user-agent")?.slice(0, MAX_USER_AGENT_CHARS) ?? null;
  const createdAt = new Date();

  let savedId: string | null = null;
  try {
    const saved = await prisma.feedback.create({ data: { userId, rating, comment, page, appVersion, userAgent, createdAt } });
    savedId = saved.id;
  } catch (err) {
    console.error("[feedback] could not save a copy:", err);
  }

  const emailed = await sendFeedbackMail(
    formatFeedbackEmail({
      rating,
      comment,
      userEmail: session.user?.email ?? null,
      userName: session.user?.name ?? null,
      page,
      appVersion,
      userAgent,
      at: createdAt,
    })
  );
  if (savedId && emailed) {
    await prisma.feedback.update({ where: { id: savedId }, data: { emailedAt: new Date() } }).catch(() => {
      // the email was sent; failing to note that is not worth failing the request
    });
  }

  if (!savedId && !emailed) return jsonError(500, "Couldn't send your feedback. Please try again in a bit.");
  return NextResponse.json({ ok: true }, { status: 201 });
}

export const POST = apiHandler(handlePOST);
