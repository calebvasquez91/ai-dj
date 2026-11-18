// The limit on how many files one account may add in a day. Everything an account adds goes into the library every other account
// sees, sign-up is open, and only the admin can remove a file, so an unlimited uploader could flood the shared library and its
// storage. Pure: the server routes count what the account added in the last 24 hours (lib/uploadGuard.ts) and ask this.

export const DEFAULT_UPLOADS_PER_DAY = 300;
export const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The configured limit (MAX_UPLOADS_PER_DAY, a whole number of files), or the default when it is missing or not a sensible number. */
export function parseUploadCap(raw: string | undefined | null): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_UPLOADS_PER_DAY;
}

/** Whether an account that has added `recent` files in the window may add one more. */
export function uploadAllowance(recent: number, cap: number): { allowed: boolean; remaining: number } {
  const remaining = Math.max(0, cap - recent);
  return { allowed: remaining > 0, remaining };
}
