-- The tables behind genre classification (models TrackGenre, GenreJob, ProviderCache, ProviderRateLimit and GenreLog in
-- schema.prisma).
--
-- Additive and idempotent: it only creates tables, indexes and foreign keys, and does nothing for any that already exist.
-- It does not touch Track or any other existing table, so code that does not know about it keeps working. Run it once
-- against the database (the same one local dev, previews and production all use):
--
--   npx prisma db execute --file prisma/genre-tables.sql
--
-- Not `prisma db push`: schema.prisma also declares a unique index on Playlist(userId, theme) that the live database does
-- not have, and db push would try to add it as well (it fails if any user has two playlists with the same theme).
-- Until these tables exist the genre routes answer "not set up yet" and the rest of the app is unaffected.

CREATE TABLE IF NOT EXISTS "TrackGenre" (
    "trackId" TEXT NOT NULL,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'auto',
    "genre" TEXT,
    "subgenresJson" TEXT NOT NULL DEFAULT '[]',
    "moodsJson" TEXT NOT NULL DEFAULT '[]',
    "year" INTEGER,
    "explicit" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackGenre_pkey" PRIMARY KEY ("trackId")
);
-- For a database that already had an earlier version of this table.
ALTER TABLE "TrackGenre" ADD COLUMN IF NOT EXISTS "year" INTEGER;
ALTER TABLE "TrackGenre" ADD COLUMN IF NOT EXISTS "explicit" TEXT;
CREATE INDEX IF NOT EXISTS "TrackGenre_status_idx" ON "TrackGenre"("status");
CREATE INDEX IF NOT EXISTS "TrackGenre_genre_idx" ON "TrackGenre"("genre");

CREATE TABLE IF NOT EXISTS "GenreJob" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "GenreJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GenreJob_status_runAfter_priority_idx" ON "GenreJob"("status", "runAfter", "priority");
CREATE INDEX IF NOT EXISTS "GenreJob_trackId_idx" ON "GenreJob"("trackId");
-- At most one queued or running job per track (Prisma cannot express a partial index, so it lives only here).
CREATE UNIQUE INDEX IF NOT EXISTS "GenreJob_one_active_per_track" ON "GenreJob"("trackId") WHERE "status" IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS "ProviderCache" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderCache_pkey" PRIMARY KEY ("key")
);
CREATE INDEX IF NOT EXISTS "ProviderCache_provider_idx" ON "ProviderCache"("provider");
CREATE INDEX IF NOT EXISTS "ProviderCache_expiresAt_idx" ON "ProviderCache"("expiresAt");

CREATE TABLE IF NOT EXISTS "ProviderRateLimit" (
    "provider" TEXT NOT NULL,
    "lastRequestAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderRateLimit_pkey" PRIMARY KEY ("provider")
);

CREATE TABLE IF NOT EXISTS "GenreLog" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "genre" TEXT,
    "confidence" DOUBLE PRECISION,
    "sourcesJson" TEXT NOT NULL,
    "usedLlm" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenreLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GenreLog_trackId_idx" ON "GenreLog"("trackId");
CREATE INDEX IF NOT EXISTS "GenreLog_createdAt_idx" ON "GenreLog"("createdAt");

DO $$ BEGIN
  ALTER TABLE "TrackGenre" ADD CONSTRAINT "TrackGenre_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "GenreJob" ADD CONSTRAINT "GenreJob_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "GenreLog" ADD CONSTRAINT "GenreLog_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
