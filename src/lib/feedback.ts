/**
 * The feedback pop-up's rules, as pure functions so they can be tested: what a submission may contain, and the email the
 * owner gets when someone sends one. The route (app/api/feedback) does the saving and sending; the pop-up
 * (components/FeedbackDialog.tsx) does the asking.
 */

export const FEEDBACK_MIN_RATING = 1;
export const FEEDBACK_MAX_RATING = 5;
export const FEEDBACK_MAX_COMMENT = 2000;
const MAX_PAGE_CHARS = 200;

/** What each star count means, for the pop-up to show under the stars (index = rating; 0 = none chosen yet). */
export const RATING_LABELS = ["", "Not great", "Could be better", "It's okay", "Pretty good", "Love it"] as const;

export interface FeedbackInput {
  rating: number;
  comment: string;
  /** A path inside the app ("/library"), or null. */
  page: string | null;
}

export type FeedbackParse = { ok: true; value: FeedbackInput } | { ok: false; error: string };

/** Control characters other than a newline or tab: never wanted in a comment, and the kind that breaks email headers. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** What a client may send: a whole-number rating from 1 to 5 and an optional comment up to 2,000 characters. Anything else is a 400. */
export function parseFeedbackBody(body: unknown): FeedbackParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "Send a rating and an optional comment." };
  const { rating, comment, page } = body as Record<string, unknown>;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < FEEDBACK_MIN_RATING || rating > FEEDBACK_MAX_RATING) {
    return { ok: false, error: "Pick a rating from 1 to 5 stars." };
  }
  let text = "";
  if (comment !== undefined && comment !== null) {
    if (typeof comment !== "string") return { ok: false, error: "The comment must be text." };
    text = comment.replace(CONTROL_CHARS, "").replace(/\r\n?/g, "\n").trim();
    if (text.length > FEEDBACK_MAX_COMMENT) return { ok: false, error: `Keep the comment under ${FEEDBACK_MAX_COMMENT} characters.` };
  }
  const cleanPage = typeof page === "string" && /^\/[^\s]*$/.test(page) && page.length <= MAX_PAGE_CHARS ? page : null;
  return { ok: true, value: { rating, comment: text, page: cleanPage } };
}

/** "★★★★☆" for 4. */
export function starString(rating: number): string {
  const n = Math.min(FEEDBACK_MAX_RATING, Math.max(0, Math.round(rating)));
  return "★".repeat(n) + "☆".repeat(FEEDBACK_MAX_RATING - n);
}

/** One line, no control characters or line breaks (an email header must not be splittable), capped in length. */
export function singleLine(text: string, max = 200): string {
  return text.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface FeedbackEmailInput {
  rating: number;
  comment: string;
  userEmail: string | null;
  userName: string | null;
  page: string | null;
  appVersion: string | null;
  userAgent: string | null;
  at: Date;
}

export interface FeedbackEmail {
  subject: string;
  text: string;
  html: string;
  /** Where Reply goes: the person's own address, so answering their feedback is one click. Null when we don't have a usable one. */
  replyTo: string | null;
}

const EMAIL_SHAPE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** The notification the owner receives. Everything from the user is escaped (HTML) or flattened (subject), never trusted. */
export function formatFeedbackEmail(input: FeedbackEmailInput): FeedbackEmail {
  const stars = starString(input.rating);
  const preview = singleLine(input.comment, 60);
  const subject = singleLine(`AI DJ feedback: ${stars} ${input.rating}/5${preview ? ` — ${preview}${input.comment.length > 60 ? "…" : ""}` : ""}`, 150);
  const who = [input.userName ? singleLine(input.userName, 80) : "", input.userEmail ? `<${singleLine(input.userEmail, 120)}>` : ""].filter(Boolean).join(" ") || "Unknown user";
  const details: [string, string][] = [
    ["From", who],
    ["Rating", `${stars}  ${input.rating} out of 5`],
    ["Page", input.page ?? "unknown"],
    ["App version", input.appVersion ?? "unknown"],
    ["Browser", input.userAgent ? singleLine(input.userAgent, 200) : "unknown"],
    ["Sent", input.at.toISOString()],
  ];
  const commentText = input.comment || "(no comment)";

  const text = [`${stars}  ${input.rating} out of 5`, "", commentText, "", "---", ...details.map(([k, v]) => `${k}: ${v}`)].join("\n");
  const rows = details.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("");
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">` +
    `<p style="font-size:22px;margin:0 0 8px;color:#e0a100">${escapeHtml(stars)} <span style="font-size:14px;color:#444">${input.rating} out of 5</span></p>` +
    `<p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(commentText)}</p>` +
    `<table style="font-size:13px;border-collapse:collapse">${rows}</table></div>`;

  const email = input.userEmail ? singleLine(input.userEmail, 254) : "";
  return { subject, text, html, replyTo: EMAIL_SHAPE.test(email) ? email : null };
}
