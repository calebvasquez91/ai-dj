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
 * without the credentials and reported as false.
 */
import nodemailer from "nodemailer";
import type { FeedbackEmail } from "@/lib/feedback";

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

function gmailTransport(config: MailConfig): MailTransport {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
}

/** True when the owner was emailed. False when mail isn't set up or the send failed. */
export async function sendFeedbackMail(
  email: FeedbackEmail,
  { config = getMailConfig(), transport }: { config?: MailConfig | null; transport?: MailTransport } = {}
): Promise<boolean> {
  if (!config) return false;
  try {
    await (transport ?? gmailTransport(config)).sendMail({
      from: `"AI DJ feedback" <${config.user}>`,
      to: config.to,
      replyTo: email.replyTo ?? undefined,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return true;
  } catch (err) {
    // The error can echo the SMTP login; log only its kind and message, never the config.
    console.warn("[feedback] notification email failed:", err instanceof Error ? err.message.replace(config.pass, "***") : "unknown error");
    return false;
  }
}
