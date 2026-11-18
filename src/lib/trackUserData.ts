// Server-only. The per-person side of the shared music library: each account's own must / do-not-play marks and hot cues, kept
// in TrackUserData (the songs themselves are shared, see prisma/shared-library.sql).
import { prisma } from "@/lib/prisma";
import type { UserTrackData } from "@/lib/trackApi";

/**
 * True when a database error just means "the TrackUserData table is not there": prisma/shared-library.sql has not been run on
 * that database yet (a fresh preview database, say). That is the only failure that may be answered with "nobody has marks";
 * anything else (a timeout, a dropped connection) must surface, or Do-Not-Play marks would silently vanish and Shuffle Play
 * would play the songs somebody had excluded.
 */
export function isMissingTrackUserDataTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  const text = typeof message === "string" ? message : "";
  if (code === "P2021") return true; // Prisma: the table does not exist in the current database
  return /TrackUserData/.test(text) && /does not exist/i.test(text);
}

/** Every song this person has set something on (the library lists thousands, but each person only sets a few). */
export async function loadUserTrackData(userId: string): Promise<Map<string, UserTrackData>> {
  const out = new Map<string, UserTrackData>();
  try {
    const rows = await prisma.trackUserData.findMany({ where: { userId } });
    for (const r of rows) out.set(r.trackId, { playPreference: r.playPreference, hotCueOverridesJson: r.hotCueOverridesJson });
  } catch (err) {
    if (!isMissingTrackUserDataTable(err)) throw err;
    console.warn("Per-person track data is not set up yet (run prisma/shared-library.sql); nobody has marks until it is.");
  }
  return out;
}

/** One song's values for this person, or undefined when they have set nothing on it. One row is read, not all of theirs. */
export async function loadOneUserTrackData(userId: string, trackId: string): Promise<UserTrackData | undefined> {
  try {
    const row = await prisma.trackUserData.findUnique({ where: { userId_trackId: { userId, trackId } } });
    return row ? { playPreference: row.playPreference, hotCueOverridesJson: row.hotCueOverridesJson } : undefined;
  } catch (err) {
    if (!isMissingTrackUserDataTable(err)) throw err;
    return undefined;
  }
}

/**
 * Sets or clears one or both of this person's own values for a song, and returns what they now have. A field left out is not
 * touched. When that leaves the row with nothing in it, the row is removed rather than kept empty.
 */
export async function saveUserTrackData(
  userId: string,
  trackId: string,
  patch: { playPreference?: "must" | "do-not" | null; hotCueOverridesJson?: string | null },
): Promise<UserTrackData> {
  const row = await prisma.trackUserData.upsert({
    where: { userId_trackId: { userId, trackId } },
    create: { userId, trackId, ...patch },
    update: patch,
  });
  if (row.playPreference == null && row.hotCueOverridesJson == null) {
    // Only an empty row goes (the filter repeats the emptiness, so a concurrent write that just filled it is not lost).
    await prisma.trackUserData.deleteMany({ where: { userId, trackId, playPreference: null, hotCueOverridesJson: null } });
    return {};
  }
  return { playPreference: row.playPreference, hotCueOverridesJson: row.hotCueOverridesJson };
}
