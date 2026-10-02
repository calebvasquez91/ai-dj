// Client-side wrapper for the store's "optimistic update, persist in the
// background" requests. The old `void fetch(...)` calls never looked at the
// response (a 500/401/404 left UI and DB silently diverged) and never caught
// a network failure (an unhandled promise rejection). This always resolves —
// never throws — with enough information for the caller to roll back and tell
// the user why.

export interface SyncResult {
  ok: boolean;
  /** HTTP status, or 0 when the request never got a response (offline, DNS, CORS...). */
  status: number;
  /** Human-readable reason, only meaningful when !ok — the server's JSON `error` when it sent one. */
  error: string;
}

export interface SyncOptions {
  /** Extra statuses to treat as success — e.g. 404 for a DELETE, where "already gone" is the desired end state. */
  okStatuses?: readonly number[];
}

function fallbackMessage(status: number): string {
  if (status === 0) return "Couldn't reach the server — check your connection.";
  if (status === 401) return "You're signed out — please sign in again.";
  if (status === 404) return "That item no longer exists.";
  if (status === 409) return "That conflicts with a newer change.";
  if (status >= 500) return "The server had a problem — please try again.";
  return `The server rejected the change (${status}).`;
}

export async function syncRequest(
  input: string,
  init?: RequestInit,
  options: SyncOptions = {}
): Promise<SyncResult> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, status: 0, error: fallbackMessage(0) };
  }
  if (res.ok || options.okStatuses?.includes(res.status)) return { ok: true, status: res.status, error: "" };

  let message = "";
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      message = (body as { error: string }).error;
    }
  } catch {
    // empty / non-JSON body (e.g. a proxy error page) — use the generic text
  }
  return { ok: false, status: res.status, error: message || fallbackMessage(res.status) };
}

/** JSON-body request init shorthand. */
export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
