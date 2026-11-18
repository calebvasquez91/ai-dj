// Server-only. Keeps a line for every change the admin makes to a playlist that belongs to somebody else, so it can always be explained
// afterwards. Best effort: a failure here (the AdminAction table not created yet, a database hiccup) must never undo or block the change itself.
import { prisma } from "@/lib/prisma";

export type AdminPlaylistAction = "playlist.rename" | "playlist.delete" | "playlist.add-song" | "playlist.remove-song" | "playlist.reorder";

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
