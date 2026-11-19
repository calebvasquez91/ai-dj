// GET /api/radio/similar?artist=NAME: the artists Last.fm calls similar to one, for the seed radio's boost (lib/radio.ts). Cached and rate-limited like
// every Last.fm call; with no LASTFM_API_KEY (or on any failure) the answer is an empty list, never an error, so a radio just goes without.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, unauthorized } from "@/lib/apiRoute";
import { similarArtists } from "@/lib/curate/discover";
import { prismaCache, prismaRateStore } from "@/lib/genre/prismaServices";
import { PROVIDER_MIN_INTERVAL_MS, createRateLimiter } from "@/lib/genre/services";
import { userAgent } from "@/lib/genre/server";

const fetcher = (url: string, init?: RequestInit) => fetch(url, init);

async function handleGET(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const artist = (new URL(request.url).searchParams.get("artist") ?? "").trim().slice(0, 120);
  if (!artist) return NextResponse.json({ artists: [] });
  const found = await similarArtists(artist, {
    fetcher,
    cache: prismaCache(),
    limiter: createRateLimiter(PROVIDER_MIN_INTERVAL_MS, prismaRateStore()),
    userAgent: userAgent(),
    apiKey: () => process.env.LASTFM_API_KEY,
  });
  return NextResponse.json({ artists: found.map((a) => a.name) });
}

export const GET = apiHandler(handleGET);
