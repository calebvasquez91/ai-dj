// Server-only. Reads the listening statistics for the Admin page out of PlayEvent: hours per account, per genre, per playlist and per song,
// for all time or the last 7 / 30 days, for every account or one. Everything is summed in the database, not in the page.
import { prisma } from "@/lib/prisma";
import { foldGenres, rangeStart } from "@/lib/playStats";

export interface Entry {
  key: string;
  label: string;
  sub?: string;
  seconds: number;
}

export interface PlayStatsReport {
  /** Seconds played in the period, for the chosen account (or every account). */
  totalSeconds: number;
  /** Every account that played anything in the period, biggest first (always all accounts, so one can be picked). */
  accounts: (Entry & { id: string })[];
  genres: Entry[];
  playlists: Entry[];
  songs: Entry[];
  /** Seconds not played from a playlist (a song clicked in the library, a shuffle over the library). */
  outsidePlaylistSeconds: number;
}

export type PlayStatsResult = { ok: true; report: PlayStatsReport } | { ok: false; reason: "no-table" | "error" };

export function isMissingTable(err: unknown): boolean {
  const { code, message } = (err ?? {}) as { code?: unknown; message?: unknown };
  return code === "P2021" || (typeof message === "string" && /PlayEvent/.test(message) && /does not exist/i.test(message));
}

function accountLabel(u: { email: string; name: string | null }): string {
  return u.name ? `${u.name} (${u.email})` : u.email;
}

export async function loadPlayStats(opts: { days: 7 | 30 | null; accountId: string | null; now?: number }): Promise<PlayStatsResult> {
  const since = rangeStart(opts.days, opts.now);
  const period = since ? { createdAt: { gte: since } } : {};
  const scoped = { ...period, ...(opts.accountId ? { userId: opts.accountId } : {}) };
  try {
    const [byAccount, total, byGenre, byPlaylist, bySong, outside] = await Promise.all([
      prisma.playEvent.groupBy({ by: ["userId"], where: period, _sum: { seconds: true }, orderBy: { _sum: { seconds: "desc" } } }),
      prisma.playEvent.aggregate({ where: scoped, _sum: { seconds: true } }),
      prisma.playEvent.groupBy({ by: ["trackId", "genre"], where: scoped, _sum: { seconds: true } }),
      prisma.playEvent.groupBy({
        by: ["playlistId", "playlistName"],
        where: { ...scoped, playlistName: { not: null } },
        _sum: { seconds: true },
        orderBy: { _sum: { seconds: "desc" } },
        take: 10,
      }),
      prisma.playEvent.groupBy({
        by: ["trackId", "title", "artist"],
        where: scoped,
        _sum: { seconds: true },
        orderBy: { _sum: { seconds: "desc" } },
        take: 15,
      }),
      prisma.playEvent.aggregate({ where: { ...scoped, playlistName: null }, _sum: { seconds: true } }),
    ]);

    // A song's genre is read as it is NOW (classified or corrected after it was played still counts under the right genre).
    const listenedTrackIds = [...new Set(byGenre.flatMap((r) => (r.trackId ? [r.trackId] : [])))];
    const currentGenre = new Map<string, string | null>();
    try {
      for (const row of await prisma.trackGenre.findMany({ where: { trackId: { in: listenedTrackIds } }, select: { trackId: true, genre: true } })) {
        currentGenre.set(row.trackId, row.genre);
      }
    } catch {
      // no genre tables: the genre recorded when each song was played is used
    }

    const [users, playlists] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: byAccount.map((r) => r.userId) } }, select: { id: true, email: true, name: true } }),
      prisma.playlist.findMany({
        where: { id: { in: byPlaylist.flatMap((r) => (r.playlistId ? [r.playlistId] : [])) } },
        select: { id: true, user: { select: { email: true, name: true } } },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const ownerByPlaylist = new Map(playlists.map((p) => [p.id, accountLabel(p.user)]));

    return {
      ok: true,
      report: {
        totalSeconds: total._sum.seconds ?? 0,
        accounts: byAccount.map((r) => {
          const u = userById.get(r.userId);
          return { id: r.userId, key: r.userId, label: u ? accountLabel(u) : "(deleted account)", seconds: r._sum.seconds ?? 0 };
        }),
        genres: foldGenres(byGenre.map((r) => ({ trackId: r.trackId, genre: r.genre, seconds: r._sum.seconds ?? 0 })), currentGenre).map((g) => ({ key: g.label, label: g.label, seconds: g.seconds })),
        playlists: byPlaylist.map((r) => ({
          key: r.playlistId ?? r.playlistName ?? "?",
          label: r.playlistName ?? "(playlist)",
          sub: r.playlistId ? (ownerByPlaylist.get(r.playlistId) ?? undefined) : "deleted playlist",
          seconds: r._sum.seconds ?? 0,
        })),
        songs: bySong.map((r) => ({ key: r.trackId ?? `${r.title}|${r.artist}`, label: r.title, sub: r.artist, seconds: r._sum.seconds ?? 0 })),
        outsidePlaylistSeconds: outside._sum.seconds ?? 0,
      },
    };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "no-table" };
    console.error("[play stats] could not load:", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * All time, every account: the one number the Admin page's front card shows. Null when the table is not there (nothing is being
 * recorded yet); "error" for any other failure, so a database hiccup is not mistaken for missing setup.
 */
export async function totalListenedSeconds(): Promise<number | null | "error"> {
  try {
    const r = await prisma.playEvent.aggregate({ _sum: { seconds: true } });
    return r._sum.seconds ?? 0;
  } catch (err) {
    return isMissingTable(err) ? null : "error";
  }
}
