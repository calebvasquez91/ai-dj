-- The table behind the "Recent admin changes" list on the Admin page (model AdminAction in schema.prisma).
--
-- When the admin renames a playlist that belongs to another account, takes a song out of it, adds or moves songs, or deletes it, one row
-- says who did what to which playlist and when. The playlist's name and the owner's email are copied in, so the line still reads after
-- the playlist or the account is gone. It is not linked to the other tables on purpose.
--
-- Additive and idempotent: it only creates a table and an index, and does nothing if they exist. It does not touch any existing table.
-- Run it once against the database (the same one local dev, previews and production all use):
--
--   npx prisma db execute --file prisma/admin-actions.sql
--
-- Not `prisma db push`: schema.prisma also declares a unique index on Playlist(userId, theme) that the live database does not have, and
-- db push would try to add it as well. Until this table exists the admin's changes still work; they are just not logged.

CREATE TABLE IF NOT EXISTS "AdminAction" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "playlistId" TEXT,
    "playlistName" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerEmail" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AdminAction_createdAt_idx" ON "AdminAction"("createdAt");
