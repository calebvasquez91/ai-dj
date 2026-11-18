-- The table behind the shared music library (model TrackUserData in schema.prisma).
--
-- Every song is now visible to every account; what stays per person is the "must / do-not play" mark and the hot cues. They move
-- from the Track row (one value for everybody) to this table (one value per person and song).
--
-- Additive and idempotent: it creates one table, its indexes and foreign keys, and copies the marks and cues that already exist
-- onto the account that uploaded each song. It does not change or delete anything in Track, and running it twice is harmless.
-- Run it once against the database (the same one local dev, previews and production all use):
--
--   npx prisma db execute --file prisma/shared-library.sql
--
-- Not `prisma db push`: schema.prisma also declares a unique index on Playlist(userId, theme) that the live database does
-- not have, and db push would try to add it as well (it fails if any user has two playlists with the same theme).
-- Run it BEFORE the code that reads this table is deployed.

CREATE TABLE IF NOT EXISTS "TrackUserData" (
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "playPreference" TEXT,
    "hotCueOverridesJson" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackUserData_pkey" PRIMARY KEY ("userId", "trackId")
);
CREATE INDEX IF NOT EXISTS "TrackUserData_trackId_idx" ON "TrackUserData"("trackId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackUserData_userId_fkey') THEN
    ALTER TABLE "TrackUserData" ADD CONSTRAINT "TrackUserData_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackUserData_trackId_fkey') THEN
    ALTER TABLE "TrackUserData" ADD CONSTRAINT "TrackUserData_trackId_fkey"
      FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Keep what people already set: each existing mark / cue set becomes that uploader's own. A row that is already there is left alone.
INSERT INTO "TrackUserData" ("userId", "trackId", "playPreference", "hotCueOverridesJson")
SELECT "userId", "id", "playPreference", "hotCueOverridesJson"
FROM "Track"
WHERE "playPreference" IS NOT NULL OR "hotCueOverridesJson" IS NOT NULL
ON CONFLICT ("userId", "trackId") DO NOTHING;
