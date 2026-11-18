-- The table behind the listening statistics on the Admin page (model PlayEvent in schema.prisma).
--
-- The app reports how long each song was played, every 30 seconds or so while music is playing: which account, which song, which
-- playlist it was played from (if any), and the seconds. Reports for the same song and playlist that keep coming are added into one row. The song's title, artist and genre and the playlist's name are copied into
-- the row, so the statistics survive a song or playlist being deleted later.
--
-- Additive and idempotent: it only creates a table, its indexes and foreign keys, and does nothing if they exist. It does not touch
-- any existing table. Run it once against the database (the same one local dev, previews and production all use):
--
--   npx prisma db execute --file prisma/play-stats.sql
--
-- Not `prisma db push`: schema.prisma also declares a unique index on Playlist(userId, theme) that the live database does not have,
-- and db push would try to add it as well. Until this table exists the recording call quietly does nothing and the statistics
-- page says so; the rest of the app is unaffected.

CREATE TABLE IF NOT EXISTS "PlayEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT,
    "playlistId" TEXT,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "genre" TEXT,
    "playlistName" TEXT,
    "seconds" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayEvent_pkey" PRIMARY KEY ("id")
);
-- For a database that already had the first version of this table.
ALTER TABLE "PlayEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "PlayEvent_userId_createdAt_idx" ON "PlayEvent"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "PlayEvent_userId_updatedAt_idx" ON "PlayEvent"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "PlayEvent_createdAt_idx" ON "PlayEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "PlayEvent_trackId_idx" ON "PlayEvent"("trackId");
CREATE INDEX IF NOT EXISTS "PlayEvent_playlistId_idx" ON "PlayEvent"("playlistId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlayEvent_userId_fkey') THEN
    ALTER TABLE "PlayEvent" ADD CONSTRAINT "PlayEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlayEvent_trackId_fkey') THEN
    ALTER TABLE "PlayEvent" ADD CONSTRAINT "PlayEvent_trackId_fkey"
      FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlayEvent_playlistId_fkey') THEN
    ALTER TABLE "PlayEvent" ADD CONSTRAINT "PlayEvent_playlistId_fkey"
      FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
