import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";
import { createCachedSearch, getCatalogAdapter, parseCatalogQuery, serializeCatalogPage } from "@/lib/catalog/search";
import { CatalogSourceError } from "@/lib/catalog/types";
import { createRateLimiter } from "@/lib/rateLimit";

/** A person browsing a catalog searches a lot, but a loop or a script shouldn't be able to spend the free tier's monthly request cap. In memory, per server instance. */
const limiter = createRateLimiter({ max: 60, windowMs: 10 * 60 * 1000 });
const cachedSearch = createCachedSearch();

/**
 * GET /api/catalog/search?q=&tags=&speed=&vocal=&minDuration=&maxDuration=&limit=&offset=&source=
 *
 * Searches the free music catalog (Jamendo) from the server, so the client id never reaches the browser. Only tracks
 * whose license the app can use come back (CC0, public domain, CC BY; see lib/catalog/license.ts), each with its credit
 * line. Nothing is stored: a result is only a listing until the user adds it to their library.
 */
async function handleGET(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  if (!limiter.take(session.user?.id ?? session.user?.email ?? "anonymous")) {
    return jsonError(429, "Too many searches. Try again in a few minutes.");
  }

  const parsed = parseCatalogQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return jsonError(400, parsed.error);

  const adapter = getCatalogAdapter(parsed.value.source);
  if (!adapter) return jsonError(503, "The music catalog isn't set up on this server.");

  try {
    const page = await cachedSearch.search(adapter, parsed.value.query);
    return NextResponse.json(serializeCatalogPage(page));
  } catch (err) {
    if (err instanceof CatalogSourceError) {
      // The message never carries the request URL or the key (see CatalogSourceError); it is safe to log.
      console.warn(`[catalog] ${parsed.value.source} search failed: ${err.message}`);
      return jsonError(502, "The music catalog couldn't be reached right now.");
    }
    throw err;
  }
}

export const GET = apiHandler(handleGET);
