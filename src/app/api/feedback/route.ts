import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";
import { formatFeedbackEmail, parseFeedbackBody } from "@/lib/feedback";
import { sendFeedbackMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rateLimit";

/** The email is sent after the response goes out; give the whole invocation room for a slow SMTP server. */
export const maxDuration = 30;

/** A real submission is a few hundred characters (a comment is capped at 2,000); anything near this is not one. */
const MAX_BODY_CHARS = 8_000;
/** Someone sending feedback five times in an hour has said what they wanted; this stops a loop from filling the inbox. In memory, per server instance. */
const limiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
const MAX_USER_AGENT_CHARS = 300;

/**
 * Most notification emails sent in a day, however many accounts they come from. Sign-up is open, so the per-person limit
 * alone would let a script of fresh accounts flood the owner's inbox and use up Gmail's daily sending limit (which would
 * block the owner's own mail). Over the cap, feedback is still saved; it just isn't emailed. Counted from the table when
 * it exists, and per server instance in memory as well.
 */
export const FEEDBACK_MAX_EMAILS_PER_DAY = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const emailLimiter = createRateLimiter({ max: FEEDBACK_MAX_EMAILS_PER_DAY, windowMs: DAY_MS });

async function underDailyEmailCap(): Promise<boolean> {
  try {
    const sent = await prisma.feedback.count({ where: { emailedAt: { gte: new Date(Date.now() - DAY_MS) } } });
    if (sent >= FEEDBACK_MAX_EMAILS_PER_DAY) return false;
  } catch {
    // no table yet (or the database is down): the in-memory count below still applies
  }
  return emailLimiter.take("all");
}

/** The deployed build (the short commit Vercel sets), so a comment can be tied to what the person was running. */
function appVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local";
}

/**
 * POST /api/feedback { rating: 1-5, comment?: string, page?: "/path" }
 *
 * Keeps a copy in the database and emails the owner. With the copy saved the person is answered at once and the email
 * goes out afterwards (a slow mail server never holds the pop-up up). If the copy can't be saved (for instance the table
 * doesn't exist yet) the email is the only record, so it is awaited and the person only sees an error if it fails too.
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

  const userAgent = request.headers.get("user-agent")?.slice(0, MAX_USER_AGENT_CHARS) ?? null;
  const createdAt = new Date();

  let savedId: string | null = null;
  try {
    const saved = await prisma.feedback.create({ data: { userId, rating, comment, page, appVersion: appVersion(), userAgent, createdAt } });
    savedId = saved.id;
  } catch (err) {
    console.error("[feedback] could not save a copy:", err);
  }

  const email = formatFeedbackEmail({
    rating,
    comment,
    userEmail: session.user?.email ?? null,
    userName: session.user?.name ?? null,
    page,
    appVersion: appVersion(),
    userAgent,
    at: createdAt,
  });
  /** Emails the owner (within the daily cap) and notes that it did; never throws. */
  const notifyOwner = async (): Promise<boolean> => {
    try {
      if (!(await underDailyEmailCap())) {
        console.warn("[feedback] daily email cap reached: saved without emailing");
        return false;
      }
      const emailed = await sendFeedbackMail(email);
      if (emailed && savedId) {
        await prisma.feedback.update({ where: { id: savedId }, data: { emailedAt: new Date() } }).catch(() => {
          // the email was sent; failing to note that is not worth a fuss
        });
      }
      return emailed;
    } catch (err) {
      console.error("[feedback] notifying the owner failed:", err);
      return false;
    }
  };

  if (savedId) {
    after(notifyOwner);
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  if (!(await notifyOwner())) return jsonError(500, "Couldn't send your feedback. Please try again in a bit.");
  return NextResponse.json({ ok: true }, { status: 201 });
}

/**
 * GET /api/feedback: when this account last sent feedback ({ lastSentAt: ISO time | null }), so the pop-up isn't shown
 * again on a second device. Never an error to the caller: with no table (or a database problem) it says "none".
 */
async function handleGET() {
  const session = await auth();
  if (!session) return unauthorized();
  const userId = session.user?.id;
  if (!userId) return unauthorized();
  let lastSentAt: string | null = null;
  try {
    const latest = await prisma.feedback.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    lastSentAt = latest?.createdAt.toISOString() ?? null;
  } catch {
    // no table yet: treat as no feedback sent
  }
  return NextResponse.json({ lastSentAt }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = apiHandler(handlePOST);
export const GET = apiHandler(handleGET);
