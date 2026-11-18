/**
 * Who may change a playlist: the account that made it, and the admin (who has full access to every account's playlists, so they can be
 * looked at, renamed, emptied and deleted from the Admin page). Nobody else. Reading and listing other accounts' playlists is done on
 * the Admin pages, which have their own admin check.
 */
import { isAdmin } from "@/lib/feedbackAdmin";

export function canManagePlaylist(ownerId: string, userId: string, env: Record<string, string | undefined> = process.env): boolean {
  return ownerId === userId || isAdmin(userId, env);
}
