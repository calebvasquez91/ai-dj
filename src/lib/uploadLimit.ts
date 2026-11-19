// The limit on how many files one account may add in a day. Everything an account adds goes into the library every other account
// sees, sign-up is open, and only the admin can remove a file, so an unlimited uploader could flood the shared library and its
// storage. The risk is a stranger who has just registered, so a NEW account gets the tight limit. An ESTABLISHED account (a week old
// AND already holding a real library from before the last day) gets a higher one, so a DJ importing a whole library is not locked out;
// age alone is not enough, since anyone can sign up and wait. Pure: the server routes count what the account added in the last
// 24 hours and what it already had (lib/uploadGuard.ts) and ask this.

/** Files per 24 hours for a new account. */
export const DEFAULT_UPLOADS_PER_DAY = 300;
/** Files per 24 hours for an established account. */
export const DEFAULT_ESTABLISHED_UPLOADS_PER_DAY = 2000;
/** How old an account has to be to count as established... */
export const ESTABLISHED_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;
/** ...and how many files it must already have from before the last 24 hours. */
export const ESTABLISHED_MIN_FILES = 50;
export const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A whole number of files from a setting, or the fallback when it is missing or not a sensible number. */
export function parseCap(raw: string | undefined | null, fallback: number): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/** The limit for a new account (MAX_UPLOADS_PER_DAY). */
export function newAccountCap(env: Record<string, string | undefined> = process.env): number {
  return parseCap(env.MAX_UPLOADS_PER_DAY, DEFAULT_UPLOADS_PER_DAY);
}

/**
 * The most files this account may add in 24 hours. `accountAgeMs` is null for an account that cannot be found, and `priorFiles` is how
 * many songs and FX sounds it added before the last 24 hours. An established account never gets less than a new one.
 */
export function uploadCapFor(
  accountAgeMs: number | null,
  priorFiles: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const newCap = newAccountCap(env);
  const established = accountAgeMs != null && accountAgeMs >= ESTABLISHED_ACCOUNT_MS && priorFiles >= ESTABLISHED_MIN_FILES;
  if (!established) return newCap;
  return Math.max(newCap, parseCap(env.MAX_UPLOADS_PER_DAY_ESTABLISHED, DEFAULT_ESTABLISHED_UPLOADS_PER_DAY));
}

/** Whether an account that has added `recent` files in the window may add one more. */
export function uploadAllowance(recent: number, cap: number): { allowed: boolean; remaining: number } {
  const remaining = Math.max(0, cap - recent);
  return { allowed: remaining > 0, remaining };
}
