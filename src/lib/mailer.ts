/**
 * Sends the feedback notification to the owner's Gmail. Server-only. Gmail's SMTP with an App Password (a 16-character
 * password made at myaccount.google.com/apppasswords, which needs 2-step verification on): no extra service, and the
 * account's real password is never used.
 *
 *   GMAIL_USER          the Gmail address the mail is sent from
 *   GMAIL_APP_PASSWORD  its App Password (spaces are ignored)
 *   FEEDBACK_TO_EMAIL   where notifications go; defaults to GMAIL_USER
 *
 * Without them nothing is sent (the route still keeps a copy in the database). Never throws: a failed send is logged
 * by its error code only (never the message, which can echo the login) and reported as false.
 *
 * Two dependency notes. nodemailer 10 is used because 8.x has published advisories; next-auth lists nodemailer as an
 * optional peer limited to ^7.0.7 || ^8.0.5, so package.json carries an `overrides` entry that makes next-auth accept
 * the root version (it only uses nodemailer for its email-login provider, which this app doesn't enable: if that is
 * ever turned on, test it against this version first). nodemailer 10 ships no types, and @types/nodemailer stops at
 * 8.x; the few calls used here (createTransport, sendMail) are unchanged between them.
 */
import nodemailer from "nodemailer";
import type { FeedbackEmail } from "@/lib/feedback";
import { withTimeout } from "@/lib/withTimeout";

export interface MailConfig {
  user: string;
  pass: string;
  to: string;
}

export function getMailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const user = env.GMAIL_USER?.trim();
  const pass = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) return null;
  return { user, pass, to: env.FEEDBACK_TO_EMAIL?.trim() || user };
}

/** The part of a nodemailer transport this module uses; a test passes its own. */
export interface MailTransport {
  sendMail(options: { from: string; to: string; replyTo?: string; subject: string; text: string; html: string }): Promise<unknown>;
}

const SMTP_TIMEOUT_MS = 8000;
/** The whole send (connect, log in, send) is given up on after this, however the pieces add up. */
export const MAIL_TOTAL_TIMEOUT_MS = 15_000;

function gmailTransport(config: MailConfig): MailTransport {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
}

/** What is safe to log about a failed send: the error's code and the SMTP response code, nothing from its message. */
function failureSummary(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown error";
  const { code, responseCode } = err as { code?: unknown; responseCode?: unknown };
  const parts = [typeof code === "string" ? code : null, typeof responseCode === "number" ? String(responseCode) : null].filter(Boolean);
  if (err instanceof Error && err.message.includes("timed out")) parts.push("timed out");
  return parts.length > 0 ? parts.join(" ") : "unknown error";
}

/** True when the owner was emailed. False when mail isn't set up or the send failed. */
export async function sendFeedbackMail(
  email: FeedbackEmail,
  { config = getMailConfig(), transport }: { config?: MailConfig | null; transport?: MailTransport } = {}
): Promise<boolean> {
  if (!config) return false;
  try {
    await withTimeout(
      (transport ?? gmailTransport(config)).sendMail({
        from: `"AI DJ feedback" <${config.user}>`,
        to: config.to,
        replyTo: email.replyTo ?? undefined,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      MAIL_TOTAL_TIMEOUT_MS,
      "Feedback email"
    );
    return true;
  } catch (err) {
    console.warn(`[feedback] notification email failed: ${failureSummary(err)}`);
    return false;
  }
}
