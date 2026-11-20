-- Three columns on Track (model Track in schema.prisma) for the BPM and key that a song's own file tags carry (ID3 TBPM / TKEY, as BPM Supreme writes them).
--
-- They are kept apart from bpm / key / camelotKey on purpose. Those hold the app's own analysis of the song (measured the first time it plays) and
-- a song with a bpm is treated as already analysed: its beat grid, waveform and drop points are expected to be stored beside it. A tag BPM written
-- there would make a never-played song look analysed with none of that. These columns are only shown (the admin's Music catalog) and searched; the
-- mixing never reads them.
--
-- Additive and idempotent: it only adds three nullable columns, and does nothing if they exist. It changes no existing data. Run it once against the
-- database (the same one local dev, previews and production all use), BEFORE the code that reads the columns is deployed:
--
--   npx prisma db execute --file prisma/tag-bpm-key.sql
--
-- Not `prisma db push`: schema.prisma also declares a unique index on Playlist(userId, theme) that the live database does not have, and db push
-- would try to add it as well. The code already running keeps working with the columns there (it never selects them by name).

ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "tagBpm" DOUBLE PRECISION;
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "tagKey" TEXT;
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "tagCamelotKey" TEXT;
