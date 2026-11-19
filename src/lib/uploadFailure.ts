// Client-safe. The Vercel Blob client throws a generic "Failed to retrieve the client token" whenever the token route refuses (and drops the
// route's own message), so a daily-limit 429 would look like a broken upload. On that error, ask /api/uploads/allowance for the real
// reason and throw it instead; any other error, or an unhelpful answer, is passed on unchanged.

export async function explainBlobFailure(err: unknown): Promise<Error> {
  const original = err instanceof Error ? err : new Error(String(err));
  if (!/client\s+token/i.test(original.message)) return original;
  try {
    const res = await fetch("/api/uploads/allowance");
    if (res.ok) return original;
    const body = await res.json().catch(() => null);
    return typeof body?.error === "string" && body.error ? new Error(body.error) : original;
  } catch {
    return original;
  }
}
