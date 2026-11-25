-- The SongListEntry table behind Vibe Code's "From your song list" suggestions (model SongListEntry in schema.prisma).
--
-- It holds the owner's own song list (title, artist, playlist, genre, year, tempo, key, energy, mood words, rating): music facts only, no recommender names and no
-- notes. The rows are put in by scripts/import-song-list.ts (a dry run unless given --apply); the suggestions are shown to the admin account only.
--
-- Additive and idempotent: it only creates the table and an index, and does nothing if they already exist. Run it once against the database (the same one local
-- dev, previews and production all use):
--
--   npx prisma db execute --file prisma/song-list.sql
--
-- Not `prisma db push`: schema.prisma also declares a unique index on Playlist(userId, theme) that the live database does not have, and db push would try to add
-- it as well. Until this table exists, and is filled, Vibe Code simply shows no list suggestions; the rest of the app is unaffected.

CREATE TABLE IF NOT EXISTS "SongListEntry" (
    "id" TEXT NOT NULL,
    "playlist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "genre" TEXT NOT NULL DEFAULT '',
    "subGenre" TEXT NOT NULL DEFAULT '',
    "year" INTEGER,
    "bpm" DOUBLE PRECISION,
    "camelot" TEXT,
    "energy" INTEGER,
    "moods" TEXT NOT NULL DEFAULT '',
    "explicit" BOOLEAN,
    "durationSec" INTEGER,
    CONSTRAINT "SongListEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SongListEntry_playlist_idx" ON "SongListEntry"("playlist");
