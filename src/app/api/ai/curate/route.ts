// "Vibe Code": a playlist request in words becomes a previewed playlist from the person's own library. The filtering,
// scoring and energy plan happen here, on local data (src/lib/curate); Claude only reads the request and refines the order
// and description, and anything it says is checked. Nothing is saved: the person previews it, then saves it as a normal
// playlist from the app.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadUserTrackData } from "@/lib/trackUserData";
import { prisma } from "@/lib/prisma";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";
import { PLAYLIST_TRACK_OMIT, toTrackSummary } from "@/lib/trackApi";
import { loadAllGenreFields } from "@/lib/genre/api";
import { prismaCache, prismaRateStore } from "@/lib/genre/prismaServices";
import { PROVIDER_MIN_INTERVAL_MS, createRateLimiter } from "@/lib/genre/services";
import { userAgent } from "@/lib/genre/server";
import { discoverSuggestions } from "@/lib/curate/discover";
import { parseRequestWithLlm } from "@/lib/curate/llmSpec";
import { refineWithClaude } from "@/lib/curate/llmRefine";
import { runCuration, type CurateRequestBody } from "@/lib/curate/run";
import { songListLoaderFor } from "@/lib/songListAccess";
import { loadSongListRows } from "@/lib/songListStore";
import { meanEnergy } from "@/lib/track-sequencing";
import type { Track } from "@/types/music";

export const maxDuration = 60;

const fetcher = (url: string, init?: RequestInit) => fetch(url, init);

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const userId = session.user.id;

  const body = (await request.json().catch(() => null)) as CurateRequestBody | null;
  if (!body || typeof body !== "object") return jsonError(400, "Invalid request body.");

  const result = await runCuration(body, {
    parseWithLlm: (text) => parseRequestWithLlm(text, { fetcher, apiKey: () => process.env.ANTHROPIC_API_KEY }),

    loadLibrary: async () => {
      // The library is shared, so a playlist can use any song; Must / Do-Not-Play marks are the asker's own.
      const [rows, genres, marks] = await Promise.all([
        prisma.track.findMany({ where: { source: "local" }, orderBy: { createdAt: "asc" }, omit: PLAYLIST_TRACK_OMIT }),
        loadAllGenreFields(),
        loadUserTrackData(userId),
      ]);
      const bpm = new Map(rows.map((r) => [r.id, r.bpm]));
      const tracks: Track[] = rows.map((r) => ({ ...toTrackSummary(r, marks.get(r.id)), ...(genres.get(r.id) ?? {}) }));
      return { tracks, bpmOf: (t) => bpm.get(t.id) ?? null };
    },

    // The waveform is the heavy column, so it is read only for the tracks that were chosen.
    loudnessOf: async (ids) => {
      const out = new Map<string, number | null>();
      if (ids.length === 0) return out;
      const rows = await prisma.track.findMany({ where: { id: { in: ids } }, select: { id: true, waveformPeaksJson: true } });
      for (const r of rows) {
        try {
          const peaks = r.waveformPeaksJson ? (JSON.parse(r.waveformPeaksJson) as number[]) : [];
          out.set(r.id, peaks.length > 0 ? meanEnergy(peaks) : null);
        } catch {
          out.set(r.id, null);
        }
      }
      return out;
    },

    refine: (text, preview) => refineWithClaude(text, preview),

    // The owner's own song list: suggestions from it are for the admin account only.
    loadSongList: songListLoaderFor(userId, loadSongListRows),

    discover: (seeds, libraryArtists) =>
      discoverSuggestions(seeds, libraryArtists, {
        fetcher,
        cache: prismaCache(),
        limiter: createRateLimiter(PROVIDER_MIN_INTERVAL_MS, prismaRateStore()),
        userAgent: userAgent(),
        apiKey: () => process.env.LASTFM_API_KEY,
      }),
  });

  if (result.kind === "error") return jsonError(result.status, result.error);
  return NextResponse.json(result);
}

export const POST = apiHandler(handlePOST);
