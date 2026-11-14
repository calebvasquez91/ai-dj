/**
 * Who may read the feedback inbox (app/(app)/admin/feedback). The owner's sign-in email(s), listed in
 * FEEDBACK_ADMIN_EMAILS (comma separated). Nothing else grants it, and with the variable unset nobody has it.
 *
 * One thing to know when choosing the address: sign-up does not verify email addresses. An address that already has an
 * account can't be registered again, so using the email you actually sign in to the app with is safe; an address nobody
 * has signed up with yet is not, since anyone could register it and become an admin. List only addresses that already
 * have an account.
 */

/** The addresses in a FEEDBACK_ADMIN_EMAILS value: trimmed, lower-cased, empty entries dropped. */
export function parseAdminEmails(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** True when `email` is exactly one of the configured admin addresses (compared case-insensitively, never as a substring). */
export function isFeedbackAdmin(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  return parseAdminEmails(env.FEEDBACK_ADMIN_EMAILS).includes(email.trim().toLowerCase());
}
