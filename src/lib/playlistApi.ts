import { prisma } from "@/lib/prisma";
import { toTrackApiResponse } from "@/lib/trackApi";
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

/** Finds the current user's system "Spooky Music" playlist (identified by theme="spooky", not by name), creating it on first use. Idempotent — safe to call on every /api/playlists GET. */
export async function ensureSpookyPlaylist(userId: string) {
  const existing = await prisma.playlist.findFirst({ where: { userId, theme: "spooky" } });
  if (existing) return existing;
  return prisma.playlist.create({ data: { userId, name: "Spooky Music", theme: "spooky" } });
}

const playlistWithTracks = {
  tracks: {
    orderBy: { position: "asc" as const },
    include: { track: true },
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
    tracks: playlist.tracks.map((pt) => toTrackApiResponse(pt.track)),
    theme: playlist.theme ?? undefined,
  };
}

/** loadUserPlaylists + toPlaylistApiResponse, but also ensures the Spooky Music system playlist exists and unions in every spooky-tagged track the user hasn't explicitly added to it. The one extra read (all of the user's tracks) only happens here, not on every playlist load elsewhere in the app. */
export async function loadUserPlaylistsWithSpookyUnion(userId: string): Promise<Playlist[]> {
  await ensureSpookyPlaylist(userId);
  const [playlists, allTracks] = await Promise.all([
    loadUserPlaylists(userId),
    prisma.track.findMany({ where: { userId } }),
  ]);
  const spookyAutoTracks = allTracks.filter(hasSpookyTag);

  return playlists.map((playlist) => {
    const base = toPlaylistApiResponse(playlist);
    if (playlist.theme !== "spooky") return base;
    const explicitIds = new Set(base.tracks.map((t) => t.id));
    const autoTracks = spookyAutoTracks.filter((t) => !explicitIds.has(t.id)).map(toTrackApiResponse);
    return { ...base, tracks: [...base.tracks, ...autoTracks] };
  });
}
