// Pure mapping from "something threw inside a Route Handler" to the HTTP
// status + JSON message the client should get. Before this, any throw
// (a Prisma FK violation from a stale session user, a unique-constraint race,
// a dropped DB connection, malformed JSON...) escaped as Next's bare 500 with
// an empty body, so the UI could neither tell the user what went wrong nor
// distinguish "sign in again" from "try again".

export interface ApiErrorInfo {
  status: number;
  error: string;
}

interface PrismaLikeError {
  code?: unknown;
  meta?: { field_name?: unknown; constraint?: unknown; modelName?: unknown; target?: unknown } | null;
  name?: unknown;
  message?: unknown;
}

function asPrismaLike(err: unknown): PrismaLikeError | null {
  return err !== null && typeof err === "object" ? (err as PrismaLikeError) : null;
}

/**
 * Whether the error mentions a column/constraint name. Where Prisma puts that
 * differs by driver (the pg adapter nests it in an object under meta, the
 * built-in engine used a plain string), and the message always names the
 * constraint ("... on the constraint: `FxSound_userId_fkey`"), so check all.
 */
function mentions(err: PrismaLikeError, needle: string): boolean {
  let metaText = "";
  try {
    metaText = JSON.stringify(err.meta ?? "");
  } catch {
    // circular meta — fall through to the message
  }
  const message = typeof err.message === "string" ? err.message : "";
  return metaText.includes(needle) || message.includes(needle);
}

/** Prisma connection-level failures: the DB was unreachable/timed out, not that the request was wrong. */
const PRISMA_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028"]);

export function describeApiError(err: unknown): ApiErrorInfo {
  // `await request.json()` on a bad/empty body throws a SyntaxError.
  if (err instanceof SyntaxError) {
    return { status: 400, error: "Request body is not valid JSON." };
  }

  const p = asPrismaLike(err);
  const code = typeof p?.code === "string" ? p.code : null;

  if (p && code) {
    if (code === "P2002") return { status: 409, error: "That already exists." };
    if (code === "P2003") {
      // The session's user row is gone (account deleted, DB reset) — every
      // write that stamps userId fails its FK. That's an auth problem.
      if (mentions(p, "_userId_fkey") || mentions(p, "userId")) {
        return { status: 401, error: "Your session is no longer valid — please sign out and sign in again." };
      }
      return { status: 409, error: "A related item no longer exists." };
    }
    if (code === "P2025") return { status: 404, error: "Not found." };
    if (code === "P2000" || code === "P2006" || code === "P2007" || code === "P2020" || code === "P2023") {
      return { status: 400, error: "One of the submitted values is invalid." };
    }
    if (PRISMA_UNAVAILABLE_CODES.has(code)) {
      return { status: 503, error: "The database is temporarily unavailable — please try again." };
    }
  }

  if (p?.name === "PrismaClientInitializationError") {
    return { status: 503, error: "The database is temporarily unavailable — please try again." };
  }

  return { status: 500, error: "Something went wrong on our end." };
}
