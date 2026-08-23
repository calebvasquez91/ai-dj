import { prisma } from "@/lib/prisma";
import { toTrackApiResponse } from "@/lib/trackApi";
import type { Playlist } from "@/types/music";

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
  };
}
