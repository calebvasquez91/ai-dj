-- The Feedback table behind the in-app feedback pop-up (model Feedback in schema.prisma).
--
-- Additive and idempotent: it only creates the table, two indexes and a foreign key (cascading with the user), and does
-- nothing if they already exist. Run it once against the database:
--
--   npx prisma db execute --file prisma/feedback-table.sql
--
-- Not `prisma db push`: schema.prisma also declares a unique index on Playlist(userId, theme) that the live database does
-- not have, and db push would try to add it as well (it fails if any user has two playlists with the same theme).
-- Until this table exists the feedback route still emails the notification; it just can't keep a copy.

CREATE TABLE IF NOT EXISTS "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "page" TEXT,
    "appVersion" TEXT,
    "userAgent" TEXT,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Feedback_userId_idx" ON "Feedback"("userId");
CREATE INDEX IF NOT EXISTS "Feedback_createdAt_idx" ON "Feedback"("createdAt");

DO $$ BEGIN
  ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
