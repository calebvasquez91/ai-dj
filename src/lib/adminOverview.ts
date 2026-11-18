/** The few numbers the Admin page shows next to each of its links. Server-only; every figure is optional so one missing table never blanks the page. */
import { prisma } from "@/lib/prisma";
import { totalListenedSeconds } from "@/lib/playStatsServer";

export interface AdminOverview {
  /** Messages in the feedback inbox. */
  feedbackCount: number | null;
  /** Songs in the shared library. */
  songs: number | null;
  /** Songs that have a genre. */
  classified: number | null;
  /** Songs waiting for somebody to confirm their genre. */
  needsReview: number | null;
  /** Playlists across every account. */
  playlists: number | null;
  /** Seconds of music played across every account, since recording started; null when the listening table does not exist yet. */
  listenedSeconds: number | null;
}

async function orNull(read: () => Promise<number>): Promise<number | null> {
  try {
    return await read();
  } catch {
    // A table that is not there (genre tables not created) or a database hiccup: show a dash, keep the page.
    return null;
  }
}

export async function loadAdminOverview(): Promise<AdminOverview> {
  const [feedbackCount, songs, classified, needsReview, playlists, listenedSeconds] = await Promise.all([
    orNull(() => prisma.feedback.count()),
    orNull(() => prisma.track.count({ where: { source: "local" } })),
    orNull(() => prisma.trackGenre.count({ where: { genre: { not: null } } })),
    orNull(() => prisma.trackGenre.count({ where: { status: "needs-review" } })),
    orNull(() => prisma.playlist.count()),
    totalListenedSeconds(),
  ]);
  return { feedbackCount, songs, classified, needsReview, playlists, listenedSeconds };
}

/** "1,715 of 3,038 songs have a genre", or a dash when either number could not be read. */
export function classifiedLine(o: Pick<AdminOverview, "classified" | "songs">): string {
  if (o.classified == null || o.songs == null) return "—";
  return `${o.classified.toLocaleString("en-US")} of ${o.songs.toLocaleString("en-US")} songs have a genre`;
}
