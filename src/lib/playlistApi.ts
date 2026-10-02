import { prisma } from "@/lib/prisma";
import { PLAYLIST_TRACK_OMIT, toTrackSummary } from "@/lib/trackApi";
import type { Playlist } from "@/types/music";
import type { Track as PrismaTrack } from "@/generated/prisma/client";

/** Any track tagged with one of these (case-insensitive, Track.tagsJson) auto-joins the Spooky Music system playlist, alongside whatever tracks were explicitly added to it. */
const SPOOKY_TRACK_TAGS = ["halloween", "spooky", "horror", "dark", "eerie"];

function hasSpookyTag(track: Pick<PrismaTrack, "tagsJson">): boolean {
  if (!track.tagsJson) return false;
  try {
    const tags: unknown = JSON.parse(track.tagsJson);
    return Array.isArray(tags) && tags.some((t) => typeof t === "string" && SPOOKY_TRACK_TAGS.includes(t.toLowerCase()));
  } catch {
    return false;
  }
}

/** Finds the current user's system "Spooky Music" playlist (identified by theme="spooky", not by name), creating it on first use. Idempotent — safe to call on every /api/playlists GET. An upsert (not findFirst-then-create) so two concurrent calls — e.g. the app open in two tabs — can't race into two separate "Spooky Music" rows for the same user; relies on the @@unique([userId, theme]) constraint, which Postgres still allows multiple normal (theme=null) playlists under since NULL is never equal to NULL in a unique index. */
export async function ensureSpookyPlaylist(userId: string) {
  // This runs on every GET /api/playlists, and the row exists for every user
  // after the first call — a plain indexed read keeps the hot path from
  // issuing a write; the upsert (still race-safe) only runs the first time.
  const existing = await prisma.playlist.findUnique({ where: { userId_theme: { userId, theme: "spooky" } } });
  if (existing) return existing;
  return prisma.playlist.upsert({
    where: { userId_theme: { userId, theme: "spooky" } },
    update: {},
    create: { userId, name: "Spooky Music", theme: "spooky" },
  });
}

const playlistWithTracks = {
  tracks: {
    orderBy: { position: "asc" as const },
    include: { track: { omit: PLAYLIST_TRACK_OMIT } },
  },
};

export type PlaylistWithTracks = Awaited<ReturnType<typeof loadPlaylist>>;

export async function loadPlaylist(id: string) {
  return prisma.playlist.findUnique({ where: { id }, include: playlistWithTracks });
}

export async function loadUserPlaylists(userId: string) {
  return prisma.playlist.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: playlistWithTracks,
  });
}

export function toPlaylistApiResponse(playlist: NonNullable<PlaylistWithTracks>): Playlist {
  return {
    id: playlist.id,
    name: playlist.name,
    createdAt: playlist.createdAt.getTime(),
    tracks: playlist.tracks.map((pt) => toTrackSummary(pt.track)),
    theme: playlist.theme ?? undefined,
  };
}

/** loadUserPlaylists + toPlaylistApiResponse, but also ensures the Spooky Music system playlist exists and unions in every spooky-tagged track the user hasn't explicitly added to it. The one extra read (all of the user's *tagged* tracks — `tagsJson: { not: null }` filters the untagged majority out at the DB level) only happens here, not on every playlist load elsewhere in the app. Auto-unioned tracks are also listed separately in `autoIncludedTrackIds`, since they have no backing PlaylistTrack row — a plain "remove from playlist" on one of them would silently no-op server-side and have it reappear on the next load; the client uses this list to not offer that action for them in the first place. */
export async function loadUserPlaylistsWithSpookyUnion(userId: string): Promise<Playlist[]> {
  await ensureSpookyPlaylist(userId);
  const [playlists, taggedTracks] = await Promise.all([
    loadUserPlaylists(userId),
    prisma.track.findMany({ where: { userId, tagsJson: { not: null } }, omit: PLAYLIST_TRACK_OMIT }),
  ]);
  const spookyAutoTracks = taggedTracks.filter(hasSpookyTag);

  return playlists.map((playlist) => {
    const base = toPlaylistApiResponse(playlist);
    if (playlist.theme !== "spooky") return base;
    const explicitIds = new Set(base.tracks.map((t) => t.id));
    const autoTracks = spookyAutoTracks.filter((t) => !explicitIds.has(t.id)).map(toTrackSummary);
    return { ...base, tracks: [...base.tracks, ...autoTracks], autoIncludedTrackIds: autoTracks.map((t) => t.id) };
  });
}
