// Server-only. The per-person side of the shared music library: each account's own must / do-not-play marks and hot cues, kept
// in TrackUserData (the songs themselves are shared, see prisma/shared-library.sql).
import { prisma } from "@/lib/prisma";
import type { UserTrackData } from "@/lib/trackApi";

/** Every song this person has set something on (the library lists thousands, but each person only sets a few). */
export async function loadUserTrackData(userId: string): Promise<Map<string, UserTrackData>> {
  const out = new Map<string, UserTrackData>();
  try {
    const rows = await prisma.trackUserData.findMany({ where: { userId } });
    for (const r of rows) out.set(r.trackId, { playPreference: r.playPreference, hotCueOverridesJson: r.hotCueOverridesJson });
  } catch (err) {
    // The table is created by prisma/shared-library.sql; until it is there nobody has marks, and the library still loads.
    console.warn("Could not read per-person track data (has prisma/shared-library.sql been run?):", err);
  }
  return out;
}

/** Sets or clears one or both of this person's own values for a song, and returns what they now have. A field left out is not touched. */
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
  return { playPreference: row.playPreference, hotCueOverridesJson: row.hotCueOverridesJson };
}
