// Route Handler plumbing shared by every src/app/api/**/route.ts: consistent
// JSON error bodies, and a wrapper that turns any thrown error into a proper
// status + {error} response instead of Next's empty-body 500.
import { NextResponse } from "next/server";
import { describeApiError } from "@/lib/apiError";

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export const unauthorized = () => jsonError(401, "Not signed in.");
export const notFound = (what = "Not found.") => jsonError(404, what);

/**
 * Wraps a Route Handler so a throw never escapes as a bare 500. The original
 * error is still logged server-side (Vercel logs), the client gets JSON.
 */
export function apiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response> | Response
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      const { status, error } = describeApiError(err);
      if (status >= 500) console.error("[api] unhandled error:", err);
      else console.warn(`[api] ${status} from thrown error:`, err instanceof Error ? err.message : err);
      return jsonError(status, error);
    }
  };
}
