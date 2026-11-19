// The limit on how many files one account may add in a day. Everything an account adds goes into the library every other account
// sees, sign-up is open, and only the admin can remove a file, so an unlimited uploader could flood the shared library and its
// storage. The risk is a stranger who has just registered, so a NEW account gets the tight limit; an account that has been around
// for a week gets a much higher one (a DJ importing a whole library must not be locked out). Pure: the server routes count what the
// account added in the last 24 hours (lib/uploadGuard.ts) and ask this.

/** Files per 24 hours for an account less than a week old. */
export const DEFAULT_UPLOADS_PER_DAY = 300;
/** Files per 24 hours for an account that is at least a week old. */
export const DEFAULT_ESTABLISHED_UPLOADS_PER_DAY = 5000;
/** How old an account has to be to count as established. */
export const ESTABLISHED_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;
export const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

function wholeNumber(raw: string | undefined | null, fallback: number): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/** The configured limit for a new account (MAX_UPLOADS_PER_DAY, a whole number of files), or the default when it is missing or not a sensible number. */
export function parseUploadCap(raw: string | undefined | null): number {
  return wholeNumber(raw, DEFAULT_UPLOADS_PER_DAY);
}

/** The configured limit for an established account (MAX_UPLOADS_PER_DAY_ESTABLISHED), or the default. */
export function parseEstablishedCap(raw: string | undefined | null): number {
  return wholeNumber(raw, DEFAULT_ESTABLISHED_UPLOADS_PER_DAY);
}

/** The most files this account may add in 24 hours, from how old it is. An established account never gets less than a new one. */
export function uploadCapFor(accountAgeMs: number | null, env: Record<string, string | undefined> = process.env): number {
  const newCap = parseUploadCap(env.MAX_UPLOADS_PER_DAY);
  if (accountAgeMs == null || accountAgeMs < ESTABLISHED_ACCOUNT_MS) return newCap;
  return Math.max(newCap, parseEstablishedCap(env.MAX_UPLOADS_PER_DAY_ESTABLISHED));
}

/** Whether an account that has added `recent` files in the window may add one more. */
export function uploadAllowance(recent: number, cap: number): { allowed: boolean; remaining: number } {
  const remaining = Math.max(0, cap - recent);
  return { allowed: remaining > 0, remaining };
}
