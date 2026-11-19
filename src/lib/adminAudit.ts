// Server-only. Keeps a line for every change the admin makes to a playlist that belongs to somebody else, so it can always be explained
// afterwards. Best effort: a failure here (the AdminAction table not created yet, a database hiccup) must never undo or block the change itself.
import { prisma } from "@/lib/prisma";

export type AdminPlaylistAction = "playlist.rename" | "playlist.delete" | "playlist.add-song" | "playlist.remove-song" | "playlist.reorder";
export type AdminLibraryAction = "library.delete-song";

/** Records the change when `actorId` is not the playlist's owner (the admin working on their own playlists is not worth a line). */
export async function recordAdminPlaylistAction(args: {
  actorId: string;
  action: AdminPlaylistAction;
  playlist: { id: string; name: string; userId: string };
  detail?: string;
}): Promise<void> {
  const { actorId, action, playlist, detail } = args;
  if (actorId === playlist.userId) return;
  try {
    const owner = await prisma.user.findUnique({ where: { id: playlist.userId }, select: { email: true } });
    await prisma.adminAction.create({
      data: {
        adminId: actorId,
        action,
        playlistId: playlist.id,
        playlistName: playlist.name,
        ownerId: playlist.userId,
        ownerEmail: owner?.email ?? null,
        detail: detail?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    console.warn("Could not log an admin change to a playlist (has prisma/admin-actions.sql been run?):", err);
  }
}

/**
 * Records that the admin deleted a song from the music library (for every account, for good). Always recorded, whoever added the song.
 * The log's playlist columns hold the song instead: playlistName is "Artist - Title", ownerId/ownerEmail are the account that added it.
 */
export async function recordAdminLibraryDelete(args: {
  actorId: string;
  track: { id: string; title: string; artist: string; userId: string };
}): Promise<void> {
  const { actorId, track } = args;
  try {
    const owner = await prisma.user.findUnique({ where: { id: track.userId }, select: { email: true } });
    await prisma.adminAction.create({
      data: {
        adminId: actorId,
        action: "library.delete-song" satisfies AdminLibraryAction,
        playlistId: null,
        playlistName: `${track.artist} - ${track.title}`.slice(0, 300),
        ownerId: track.userId,
        ownerEmail: owner?.email ?? null,
        detail: `track ${track.id}`,
      },
    });
  } catch (err) {
    console.warn("Could not log a song deleted from the library (has prisma/admin-actions.sql been run?):", err);
  }
}
